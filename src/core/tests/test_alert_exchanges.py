from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from threading import Event, current_thread

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connection, connections
from django.db.migrations.executor import MigrationExecutor
from django.db.models.query import QuerySet
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from core.models import Alert, Case, CaseExchange, CaseExchangeFollowup, CaseExchangeReplyQuickpart, Customer, CustomerAccess, Role, Permission, UserRole
from core.celerytasks import run_case_auto_followups


class AlertExchangeTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="exchange-admin", is_staff=True)
        self.client.force_authenticate(self.user)
        self.alert = Alert.objects.create(title="Alert discussion")
        self.case = Case.objects.create(title="Existing case")
        self.url = f"/api/alerts/{self.alert.pk}/exchanges/"

    def message(self, **kwargs):
        response = self.client.post(self.url, {"direction": "outbound", "body": "<script>literal</script>", **kwargs}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return CaseExchange.objects.get(pk=response.data["id"])

    def test_raw_messages_are_visible_before_merge_without_reimport_after_edit_or_delete(self):
        self.alert.raw = {"case_exchanges": [{"body": "<p>Original</p>", "message_id": "<original>", "references": ["<parent>"]}]}
        self.alert.save(update_fields=["raw"])
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        message = response.data[0]
        self.assertEqual(message["body"], "<p>Original</p>")
        self.assertEqual(message["references"], ["<parent>"])
        url = f"{self.url}{message['id']}/"
        self.assertEqual(self.client.patch(url, {"message_id": "<server-id>"}, format="json").status_code, 200)
        self.assertEqual(len(self.client.get(self.url).data), 1)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertEqual(self.client.get(self.url).data, [])
        from core.views import _materialize_alert_case_exchanges
        _materialize_alert_case_exchanges(case=self.case, alert=self.alert, actor=self.user)
        self.assertFalse(CaseExchange.objects.filter(alert=self.alert).exists())

    def test_nested_raw_messages_are_isolated_by_alert(self):
        for alert in (self.alert, Alert.objects.create(title="Other alert")):
            alert.raw = {"projections": {"case_exchanges": [{"external_id": "shared", "body": alert.title}]}}
            alert.save(update_fields=["raw"])
            response = self.client.get(f"/api/alerts/{alert.pk}/exchanges/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(len(response.data), 1)
            self.assertEqual(response.data[0]["body"], alert.title)

    def test_prepending_raw_message_does_not_hide_new_message(self):
        first = {"message_id": "<first>", "body": "First"}
        self.alert.raw = {"case_exchanges": [first]}
        self.alert.save(update_fields=["raw"])
        self.assertEqual(len(self.client.get(self.url).data), 1)
        self.alert.raw = {"case_exchanges": [{"message_id": "<second>", "body": "Second"}, first]}
        self.alert.save(update_fields=["raw"])
        response = self.client.get(self.url)
        self.assertEqual({message["message_id"] for message in response.data}, {"<first>", "<second>"})

    def test_raw_import_preserves_merge_events_and_unmerge_identity(self):
        from core.models import TimelineItem
        self.alert.raw = {"case_exchanges": [{"body": "Incoming", "message_id": "<incoming>"}]}
        self.alert.save(update_fields=["raw"])
        with self.captureOnCommitCallbacks() as callbacks:
            response = self.client.get(self.url)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(callbacks, [])
        message_id = response.data[0]["id"]
        for _ in range(2):
            response = self.client.post(f"/api/alerts/{self.alert.pk}/link/", {"case_id": str(self.case.pk)}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(CaseExchange.objects.filter(case=self.case).count(), 1)
            self.assertEqual(TimelineItem.objects.filter(case=self.case, type="case_exchange_created").count(), 1)
            response = self.client.post(f"/api/alerts/{self.alert.pk}/unmerge/", {}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(self.client.get(self.url).data[0]["id"], message_id)

    def test_standalone_crud_keeps_raw_body_and_stable_identity(self):
        message = self.message(message_id="<first>")
        self.assertEqual(message.alert_id, self.alert.pk)
        self.assertIsNone(message.case_id)
        self.assertEqual(self.client.get(self.url).data[0]["body"], "<script>literal</script>")
        url = f"{self.url}{message.pk}/"
        response = self.client.patch(url, {"message_id": "<server-id>", "body": "**literal**"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        message.refresh_from_db()
        self.assertEqual(message.message_id, "<server-id>")
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(CaseExchange.objects.filter(pk=message.pk).exists())

    def test_merge_unmerge_preserves_threads_and_case_messages(self):
        own = CaseExchange.objects.create(case=self.case, direction="inbound", body="case only", message_id="<duplicate>")
        message = self.message(message_id="<duplicate>")
        from core.views import _materialize_alert_case_exchanges
        self.alert.case = self.case
        self.alert.save(update_fields=["case"])
        _materialize_alert_case_exchanges(case=self.case, alert=self.alert, actor=self.user)
        response = self.client.post(f"/api/cases/{self.case.pk}/exchanges/", {"direction": "outbound", "body": "reply", "reply_to": str(message.pk)}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        reply = CaseExchange.objects.get(pk=response.data["id"])
        self.assertEqual(reply.alert_id, self.alert.pk)
        message.message_id = "<updated-by-soar>"
        message.save(update_fields=["message_id"])
        response = self.client.post(f"/api/alerts/{self.alert.pk}/unmerge/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        for item in (message, reply):
            item.refresh_from_db()
            self.assertIsNone(item.case_id)
            self.assertEqual(item.alert_id, self.alert.pk)
        own.refresh_from_db()
        self.assertEqual(own.case_id, self.case.pk)
        self.assertEqual(CaseExchange.objects.filter(case=self.case).count(), 1)

    def test_foreign_reply_parent_rejected_and_origin_not_writable(self):
        other = Alert.objects.create(title="Other")
        parent = CaseExchange.objects.create(alert=other, direction="inbound")
        response = self.client.post(self.url, {"direction": "outbound", "reply_to": str(parent.pk)}, format="json")
        self.assertEqual(response.status_code, 400)
        message = self.message(alert=str(other.pk), case=str(self.case.pk))
        self.assertEqual(message.alert_id, self.alert.pk)
        self.assertIsNone(message.case_id)

    def test_alert_followup_works_and_other_alert_reply_does_not_stop_it(self):
        message = self.message(message_id="<same>")
        other = Alert.objects.create(title="Other")
        quickpart = CaseExchangeReplyQuickpart.objects.create(name="Reminder", body="Reminder")
        cfg = CaseExchangeFollowup.objects.create(exchange=message, enabled=True, quickpart=quickpart, delay_value=1, delay_unit="minute")
        CaseExchangeFollowup.objects.filter(pk=cfg.pk).update(updated_at=timezone.now() - timezone.timedelta(minutes=2))
        CaseExchange.objects.create(alert=other, direction="inbound", references=["<same>"])
        run_case_auto_followups()
        reminder = CaseExchange.objects.get(reply_to=message)
        self.assertEqual(reminder.alert_id, self.alert.pk)
        self.assertIsNone(reminder.case_id)
        cfg.enabled = True
        cfg.last_triggered_at = None
        cfg.save()
        self.message(direction="inbound", references=["<same>"])
        cfg.refresh_from_db()
        self.assertFalse(cfg.enabled)

    def test_send_exposes_alert_uuid_without_inventing_case_uuid(self):
        with patch("core.views.dispatch_case_exchange_send", return_value={}) as send:
            response = self.client.post(self.url + "send/", {"body": "send", "direction": "outbound"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(send.call_args.args[0], self.alert)
        exchange = send.call_args.args[1]
        from core.views import dispatch_case_exchange_send
        dispatch_case_exchange_send(self.alert, exchange, self.user)
        exchange.refresh_from_db()
        self.assertEqual(exchange.raw["send_payload"]["alert_id"], str(self.alert.pk))
        self.assertIsNone(exchange.raw["send_payload"]["case_id"])

    def test_no_permission_cannot_read_or_write_alert_exchanges(self):
        message = self.message()
        user = get_user_model().objects.create_user(username="no-access")
        self.client.force_authenticate(user)
        self.assertIn(self.client.get(self.url).status_code, (403, 404))
        self.assertIn(self.client.patch(f"{self.url}{message.pk}/", {"body": "changed"}, format="json").status_code, (403, 404))

    def test_actual_merge_endpoints_keep_messages_across_remerge(self):
        message = self.message(message_id="<alert-message>")
        response = self.client.post(f"/api/alerts/{self.alert.pk}/escalate/", {}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.alert.refresh_from_db()
        message.refresh_from_db()
        self.assertEqual(message.case_id, self.alert.case_id)
        self.assertEqual(self.client.post(f"/api/alerts/{self.alert.pk}/unmerge/").status_code, 200)
        for _ in range(2):
            response = self.client.post(f"/api/alerts/{self.alert.pk}/link/", {"case_id": str(self.case.pk)}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(CaseExchange.objects.filter(alert=self.alert).count(), 1)
        message.refresh_from_db()
        self.assertEqual(message.case_id, self.case.pk)

    def test_unmerge_one_alert_leaves_other_alert_thread(self):
        first = self.message(message_id="<shared>")
        other = Alert.objects.create(title="Second", case=self.case)
        second = CaseExchange.objects.create(alert=other, case=self.case, direction="inbound", message_id="<shared>")
        response = self.client.post(f"/api/alerts/{self.alert.pk}/link/", {"case_id": str(self.case.pk)}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.client.post(f"/api/alerts/{self.alert.pk}/unmerge/")
        second.refresh_from_db()
        self.assertEqual(second.case_id, self.case.pk)
        self.assertEqual(self.client.get(self.url).data[0]["id"], str(first.pk))

    def test_generic_exchange_endpoint_updates_standalone_message(self):
        message = self.message()
        response = self.client.patch(f"/api/exchanges/{message.pk}/", {"message_id": "<remote-server-id>"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["id"], str(message.pk))

    def test_scoped_role_reads_alert_without_case_permission(self):
        customer = Customer.objects.create(name="Allowed")
        other_customer = Customer.objects.create(name="Denied")
        self.alert.customer = customer
        self.alert.save()
        message = self.message()
        other = Alert.objects.create(title="Other customer", customer=other_customer)
        user = get_user_model().objects.create_user(username="alert-reader")
        role = Role.objects.create(name="Alert reader")
        role.permissions.add(Permission.objects.get_or_create(code="alert.view")[0])
        UserRole.objects.create(user=user, role=role)
        CustomerAccess.objects.create(customer=customer, role=role)
        self.client.force_authenticate(user)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertEqual(self.client.get(f"{self.url}{message.pk}/").status_code, 200)
        self.assertIn(self.client.get(f"/api/alerts/{other.pk}/exchanges/").status_code, (403, 404))
        self.assertEqual(self.client.post(self.url, {"direction": "outbound"}, format="json").status_code, 403)
        self.assertEqual(self.client.get("/api/alerts/exchange-quickparts/").status_code, 200)

    def test_followup_configuration_keeps_same_id_after_merge_and_unmerge(self):
        message = self.message(message_id="<follow-source>")
        quickpart = CaseExchangeReplyQuickpart.objects.create(name="Reminder", body="Reminder")
        response = self.client.post(self.url + "followups/", {"exchange_ids": [str(message.pk)], "delay_value": 1, "delay_unit": "minute", "quickpart_id": str(quickpart.pk)}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        cfg = CaseExchangeFollowup.objects.get(exchange=message)
        self.client.post(f"/api/alerts/{self.alert.pk}/link/", {"case_id": str(self.case.pk)}, format="json")
        self.client.post(f"/api/alerts/{self.alert.pk}/unmerge/")
        cfg.refresh_from_db()
        self.assertTrue(cfg.enabled)
        self.assertEqual(cfg.exchange_id, message.pk)

    def test_reply_without_message_id_still_tracks_parent(self):
        message = self.message()
        reply = self.message(reply_to=str(message.pk))
        self.assertEqual(reply.reply_to_id, message.pk)

    def test_inbound_headers_reply_inherits_alert_origin(self):
        message = self.message(message_id="<parent>")
        self.client.post(f"/api/alerts/{self.alert.pk}/link/", {"case_id": str(self.case.pk)}, format="json")
        response = self.client.post(f"/api/cases/{self.case.pk}/exchanges/", {"direction": "inbound", "raw": {"headers": {"In-Reply-To": "<parent>"}}}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        reply = CaseExchange.objects.get(pk=response.data["id"])
        self.assertEqual(reply.alert_id, self.alert.pk)
        self.assertEqual(reply.reply_to_id, message.pk)

    def test_case_send_payload_keeps_existing_contract(self):
        from core.views import dispatch_case_exchange_send
        message = CaseExchange.objects.create(case=self.case, direction="outbound", body="body", message_id="<case-message>")
        dispatch_case_exchange_send(self.case, message, self.user)
        message.refresh_from_db()
        payload = message.raw["send_payload"]
        self.assertEqual(payload["case_id"], str(self.case.pk))
        self.assertNotIn("alert_id", payload)
        self.assertEqual(payload["id"], str(message.pk))
        self.assertEqual(payload["subject"], f"[Case ID#{self.case.case_number}]")

    def test_deleting_alert_preserves_its_messages_in_existing_case(self):
        message = self.message(message_id="<duplicate>")
        CaseExchange.objects.create(case=self.case, direction="inbound", message_id="<duplicate>")
        self.client.post(f"/api/alerts/{self.alert.pk}/link/", {"case_id": str(self.case.pk)}, format="json")
        self.alert.delete()
        message.refresh_from_db()
        self.assertIsNone(message.alert_id)
        self.assertEqual(message.case_id, self.case.pk)

    def test_deleting_case_preserves_surviving_alert_conversation(self):
        message = self.message()
        self.client.post(f"/api/alerts/{self.alert.pk}/link/", {"case_id": str(self.case.pk)}, format="json")
        native = CaseExchange.objects.create(case=self.case, direction="inbound")
        self.case.delete()
        message.refresh_from_db()
        self.assertIsNone(message.case_id)
        self.assertEqual(message.alert_id, self.alert.pk)
        self.assertFalse(CaseExchange.objects.filter(pk=native.pk).exists())

    def test_updating_stale_message_does_not_restore_unmerged_case(self):
        from core.serializers import CaseExchangeSerializer
        message = self.message()
        self.client.post(f"/api/alerts/{self.alert.pk}/link/", {"case_id": str(self.case.pk)}, format="json")
        message.refresh_from_db()
        serializer = CaseExchangeSerializer(message, data={"message_id": "<server-update>"}, partial=True)
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.client.post(f"/api/alerts/{self.alert.pk}/unmerge/")
        serializer.save()
        message.refresh_from_db()
        self.assertIsNone(message.case_id)
        self.assertEqual(message.message_id, "<server-update>")

    def test_automation_reply_follows_alert_after_unmerge(self):
        from core.services_automation import AutomationContext, _create_exchange_from_source
        source = self.message(direction="inbound", sender="sender@example.test")
        self.client.post(f"/api/alerts/{self.alert.pk}/link/", {"case_id": str(self.case.pk)}, format="json")
        source.refresh_from_db()
        reply = _create_exchange_from_source(case=self.case, source=source, action={"body": "Automatic reply", "send_mode": "save"}, ctx=AutomationContext(scope="case", target=self.case, event="case.exchange_inbound_received"))
        self.client.post(f"/api/alerts/{self.alert.pk}/unmerge/")
        reply.refresh_from_db()
        self.assertEqual(reply.alert_id, self.alert.pk)
        self.assertEqual(reply.reply_to_id, source.pk)
        self.assertIsNone(reply.case_id)

    def test_late_references_stop_followup_and_follow_alert_on_unmerge(self):
        source = self.message(message_id="<sent>")
        self.client.post(f"/api/alerts/{self.alert.pk}/link/", {"case_id": str(self.case.pk)}, format="json")
        quickpart = CaseExchangeReplyQuickpart.objects.create(name="Reminder", body="Reminder")
        cfg = CaseExchangeFollowup.objects.create(exchange=source, enabled=True, quickpart=quickpart)
        response = self.client.post(f"/api/cases/{self.case.pk}/exchanges/", {"direction": "inbound", "body": "Reply"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        reply_id = response.data["id"]
        response = self.client.patch(f"/api/exchanges/{reply_id}/", {"references": ["<sent>"]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        cfg.refresh_from_db()
        self.assertFalse(cfg.enabled)
        reply = CaseExchange.objects.get(pk=reply_id)
        self.assertEqual(reply.reply_to_id, source.pk)
        self.assertEqual(reply.alert_id, self.alert.pk)
        self.assertEqual(reply.origin_alert_uuid, self.alert.pk)
        self.assertEqual(self.client.post(f"/api/alerts/{self.alert.pk}/unmerge/").status_code, 200)
        reply.refresh_from_db()
        self.assertIsNone(reply.case_id)

    def test_corrected_in_reply_to_stops_only_correct_followup(self):
        first = CaseExchange.objects.create(case=self.case, direction="outbound", message_id="<first>")
        second = CaseExchange.objects.create(case=self.case, direction="outbound", message_id="<second>")
        response = self.client.post(f"/api/cases/{self.case.pk}/exchanges/", {"direction": "inbound", "raw": {"in_reply_to": "<first>"}}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        quickpart = CaseExchangeReplyQuickpart.objects.create(name="Reminder", body="Reminder")
        first_cfg = CaseExchangeFollowup.objects.create(exchange=first, enabled=True, quickpart=quickpart)
        second_cfg = CaseExchangeFollowup.objects.create(exchange=second, enabled=True, quickpart=quickpart)
        response = self.client.patch(f"/api/exchanges/{response.data['id']}/", {"raw": {"in_reply_to": "<second>"}, "references": ["<second>"]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        first_cfg.refresh_from_db()
        second_cfg.refresh_from_db()
        self.assertTrue(first_cfg.enabled)
        self.assertFalse(second_cfg.enabled)
        self.assertEqual(str(response.data["reply_to"]), str(second.pk))

    def test_unchanged_references_keep_parent_after_source_message_id_changes(self):
        source = self.message(message_id="<old>")
        reply = self.message(direction="inbound", references=["<old>"])
        source.message_id = "<new>"
        source.save(update_fields=["message_id"])
        response = self.client.patch(f"{self.url}{reply.pk}/", {"body": "Updated", "message_id": "<reply>", "references": ["<old>"]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        reply.refresh_from_db()
        self.assertEqual(reply.reply_to_id, source.pk)
        self.assertEqual(reply.alert_id, self.alert.pk)

    def test_late_references_collision_does_not_overwrite_messages(self):
        source = self.message(message_id="<sent>")
        existing = self.message(message_id="<duplicate>", body="Keep this")
        self.client.post(f"/api/alerts/{self.alert.pk}/link/", {"case_id": str(self.case.pk)}, format="json")
        reply = CaseExchange.objects.create(case=self.case, direction="inbound", message_id="<duplicate>")
        response = self.client.patch(f"/api/exchanges/{reply.pk}/", {"references": ["<sent>"]}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        reply.refresh_from_db()
        existing.refresh_from_db()
        self.assertIsNone(reply.alert_id)
        self.assertIsNone(reply.reply_to_id)
        self.assertEqual(reply.references, [])
        self.assertEqual(existing.body, "Keep this")

    def test_updated_references_cannot_link_self_or_another_alert(self):
        message = self.message(message_id="<self>")
        other = Alert.objects.create(title="Other")
        CaseExchange.objects.create(alert=other, direction="outbound", message_id="<foreign>")
        for reference in ("<self>", "<foreign>"):
            response = self.client.patch(f"{self.url}{message.pk}/", {"references": [reference]}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            message.refresh_from_db()
            self.assertIsNone(message.reply_to_id)
            self.assertEqual(message.alert_id, self.alert.pk)

    def test_alert_scoped_message_access_after_cross_customer_merge(self):
        allowed = Customer.objects.create(name="Allowed")
        other = Customer.objects.create(name="Other")
        self.alert.customer = allowed
        self.alert.case = self.case
        self.alert.save()
        self.case.customer = other
        self.case.save()
        message = CaseExchange.objects.create(case=self.case, alert=self.alert, direction="outbound")
        case_only = CaseExchange.objects.create(case=self.case, direction="outbound")
        user = get_user_model().objects.create_user(username="scoped-reader")
        role = Role.objects.create(name="Scoped reader")
        for code in ("alert.view", "alert.update"):
            role.permissions.add(Permission.objects.get_or_create(code=code)[0])
        UserRole.objects.create(user=user, role=role)
        CustomerAccess.objects.create(customer=allowed, role=role)
        self.client.force_authenticate(user)
        url = f"{self.url}{message.pk}/"
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.client.patch(url, {"body": "Updated"}, format="json").status_code, 200)
        self.assertIn(self.client.get(f"/api/exchanges/{message.pk}/").status_code, (403, 404))
        self.assertIn(self.client.patch(f"{self.url}{case_only.pk}/", {"body": "Forbidden"}, format="json").status_code, (403, 404))
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertTrue(CaseExchange.objects.filter(pk=case_only.pk).exists())

    def test_failed_automation_send_keeps_message_for_existing_callbacks(self):
        from core.services_automation import AutomationContext, _create_exchange_from_source
        source = CaseExchange.objects.create(case=self.case, direction="inbound", sender="sender@example.test")
        with patch("core.views.dispatch_case_exchange_send", side_effect=RuntimeError("SOAR unavailable")):
            with self.assertRaisesRegex(RuntimeError, "SOAR unavailable"):
                _create_exchange_from_source(case=self.case, source=source, action={"body": "Keep failed send", "send_mode": "send"}, ctx=AutomationContext(scope="case", target=self.case, event="case.exchange_inbound_received"))
        self.assertTrue(CaseExchange.objects.filter(case=self.case, reply_to=source, body="Keep failed send").exists())


class AlertExchangeConcurrencyTests(TransactionTestCase):
    def test_concurrent_alert_edit_preserves_import_state(self):
        from core.views import AlertRetrieveUpdateDestroyView
        user = get_user_model().objects.create_user(username="import-admin", is_staff=True)
        alert = Alert.objects.create(title="Original", raw={"case_exchanges": [{"body": "Incoming", "message_id": "<incoming>"}]})
        loaded = Event()
        resume = Event()
        original_update = AlertRetrieveUpdateDestroyView.perform_update

        def update(view, serializer):
            loaded.set()
            if not resume.wait(10):
                raise TimeoutError("Import did not complete")
            return original_update(view, serializer)

        def edit():
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(user)
                return client.patch(f"/api/alerts/{alert.pk}/", {"title": "Updated"}, format="json").status_code
            finally:
                connections.close_all()

        client = APIClient()
        client.force_authenticate(user)
        url = f"/api/alerts/{alert.pk}/exchanges/"
        with patch.object(AlertRetrieveUpdateDestroyView, "perform_update", update), ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(edit)
            try:
                self.assertTrue(loaded.wait(10))
                response = client.get(url)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(len(response.data), 1)
            finally:
                resume.set()
            self.assertEqual(pending.result(timeout=10), 200)
        self.assertEqual(client.delete(f"{url}{response.data[0]['id']}/").status_code, 204)
        self.assertEqual(client.get(url).data, [])

    def test_concurrent_header_change_cannot_leave_stale_reply_target(self):
        user = get_user_model().objects.create_user(username="header-admin", is_staff=True)
        case = Case.objects.create(title="Concurrent headers")
        first = CaseExchange.objects.create(case=case, direction="outbound", message_id="<first>")
        CaseExchange.objects.create(case=case, direction="outbound", message_id="<second>")
        reply = CaseExchange.objects.create(case=case, direction="inbound", reply_to=first, raw={"in_reply_to": "<first>"}, references=["<first>"])
        resolved = Event()
        resume = Event()
        select_for_update = QuerySet.select_for_update

        def lock(queryset, *args, **kwargs):
            if queryset.model is CaseExchange and current_thread().name.startswith("reference-update"):
                resolved.set()
                if not resume.wait(10):
                    raise TimeoutError("Header update did not complete")
            return select_for_update(queryset, *args, **kwargs)

        def update_references():
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(user)
                return client.patch(f"/api/exchanges/{reply.pk}/", {"references": ["<second>"]}, format="json").status_code
            finally:
                connections.close_all()

        with patch.object(QuerySet, "select_for_update", lock), ThreadPoolExecutor(max_workers=1, thread_name_prefix="reference-update") as pool:
            pending = pool.submit(update_references)
            try:
                self.assertTrue(resolved.wait(10))
                client = APIClient()
                client.force_authenticate(user)
                self.assertEqual(client.patch(f"/api/exchanges/{reply.pk}/", {"raw": {}}, format="json").status_code, 200)
            finally:
                resume.set()
            self.assertEqual(pending.result(timeout=10), 400)
        reply.refresh_from_db()
        self.assertEqual(reply.raw, {})
        self.assertEqual(reply.references, ["<first>"])
        self.assertEqual(reply.reply_to_id, first.pk)

    def test_concurrent_reference_update_cannot_mix_alert_origins(self):
        from core.views import _exchange_parent_fields
        user = get_user_model().objects.create_user(username="concurrent-admin", is_staff=True)
        case = Case.objects.create(title="Concurrent updates")
        first_alert = Alert.objects.create(title="First", case=case)
        second_alert = Alert.objects.create(title="Second", case=case)
        CaseExchange.objects.create(case=case, alert=first_alert, direction="outbound", message_id="<first>")
        second = CaseExchange.objects.create(case=case, alert=second_alert, direction="outbound", message_id="<second>")
        reply = CaseExchange.objects.create(case=case, direction="inbound")
        resolved = Event()
        resume = Event()

        def resolve(target, payload, **kwargs):
            result = _exchange_parent_fields(target, payload, **kwargs)
            if payload.get("references") == ["<first>"]:
                resolved.set()
                if not resume.wait(10):
                    raise TimeoutError("Concurrent update did not complete")
            return result

        def update_first():
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(user)
                return client.patch(f"/api/exchanges/{reply.pk}/", {"references": ["<first>"]}, format="json").status_code
            finally:
                connections.close_all()

        with patch("core.views._exchange_parent_fields", side_effect=resolve), ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(update_first)
            try:
                self.assertTrue(resolved.wait(10))
                client = APIClient()
                client.force_authenticate(user)
                response = client.patch(f"/api/exchanges/{reply.pk}/", {"references": ["<second>"]}, format="json")
                self.assertEqual(response.status_code, 200, response.data)
            finally:
                resume.set()
            self.assertEqual(pending.result(timeout=10), 400)
        reply.refresh_from_db()
        self.assertEqual(reply.alert_id, second_alert.pk)
        self.assertEqual(reply.origin_alert_uuid, second_alert.pk)
        self.assertEqual(reply.reply_to_id, second.pk)
        self.assertEqual(reply.references, ["<second>"])


class AlertExchangeMigrationTests(TransactionTestCase):
    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()

    def test_projection_upgrade_remembers_old_import_before_deletion(self):
        old_target = [("core", "0049_alert_exchanges")]
        executor = MigrationExecutor(connection)
        executor.migrate(old_target)
        apps = executor.loader.project_state(old_target).apps
        OldAlert = apps.get_model("core", "Alert")
        OldCase = apps.get_model("core", "Case")
        OldExchange = apps.get_model("core", "CaseExchange")
        case = OldCase.objects.create(title="Previously merged")
        alert = OldAlert.objects.create(title="Old alert", case=case, raw={"case_exchanges": [{"body": "Keep raw", "message_id": "<original>"}]})
        message = OldExchange.objects.create(case=case, alert=alert, origin_alert_uuid=alert.pk, direction="inbound", body="Keep raw", message_id="<updated>", raw={"alert_exchange": {"source_alert_id": str(alert.pk), "projection_key": "0", "external_id": ""}})
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        user = get_user_model().objects.create_user(username="migration-admin", is_staff=True)
        client = APIClient()
        client.force_authenticate(user)
        response = client.delete(f"/api/exchanges/{message.pk}/")
        self.assertEqual(response.status_code, 204)
        response = client.get(f"/api/alerts/{alert.pk}/exchanges/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])
        self.assertEqual(Alert.objects.get(pk=alert.pk).raw, {"case_exchanges": [{"body": "Keep raw", "message_id": "<original>"}]})

    def test_projection_upgrade_keeps_new_message_prepended_to_old_raw(self):
        old_target = [("core", "0049_alert_exchanges")]
        executor = MigrationExecutor(connection)
        executor.migrate(old_target)
        apps = executor.loader.project_state(old_target).apps
        OldAlert = apps.get_model("core", "Alert")
        OldCase = apps.get_model("core", "Case")
        OldExchange = apps.get_model("core", "CaseExchange")
        case = OldCase.objects.create(title="Previously merged")
        alert = OldAlert.objects.create(title="Old alert", case=case, raw={"case_exchanges": [{"body": "New", "message_id": "<new>"}, {"body": "Old", "message_id": "<old>"}]})
        message = OldExchange.objects.create(case=case, alert=alert, origin_alert_uuid=alert.pk, direction="inbound", body="Old", message_id="<old>", raw={"alert_exchange": {"source_alert_id": str(alert.pk), "projection_key": "0", "external_id": ""}})
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        user = get_user_model().objects.create_user(username="migration-admin", is_staff=True)
        client = APIClient()
        client.force_authenticate(user)
        response = client.get(f"/api/alerts/{alert.pk}/exchanges/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual({item["message_id"] for item in response.data}, {"<new>", "<old>"})
        self.assertTrue(CaseExchange.objects.filter(pk=message.pk).exists())

    def test_upgrade_preserves_messages_and_attributes_only_related_descendants(self):
        old_target = [("core", "0048_case_alert_catalog_severity")]
        new_target = [("core", "0049_alert_exchanges")]
        executor = MigrationExecutor(connection)
        executor.migrate(old_target)
        try:
            apps = executor.loader.project_state(old_target).apps
            OldCase = apps.get_model("core", "Case")
            OldAlert = apps.get_model("core", "Alert")
            OldExchange = apps.get_model("core", "CaseExchange")
            case = OldCase.objects.create(title="Existing case")
            alert = OldAlert.objects.create(title="Original alert", case=case)
            source = OldExchange.objects.create(case=case, direction="inbound", body="<b>unchanged</b>", message_id="<source>", raw={"alert_exchange": {"source_alert_id": str(alert.pk)}})
            reply = OldExchange.objects.create(case=case, direction="outbound", message_id="<reply>", raw={"headers": {"In-Reply-To": "<source>"}})
            followup = OldExchange.objects.create(case=case, direction="outbound", raw={"kind": "auto_followup", "source_exchange_id": str(reply.pk)})
            native = OldExchange.objects.create(case=case, direction="inbound", body="Case-only message")
            unusual = OldExchange.objects.create(case=case, direction="inbound", raw=["alert_exchange"])
            automatic = OldExchange.objects.create(case=case, direction="outbound", raw={"kind": "automation_rule", "source_exchange_id": str(followup.pk)})
            executor = MigrationExecutor(connection)
            executor.migrate(new_target)
            Exchange = executor.loader.project_state(new_target).apps.get_model("core", "CaseExchange")
            self.assertEqual(Exchange.objects.count(), 6)
            for original in (source, reply, followup, automatic):
                upgraded = Exchange.objects.get(pk=original.pk)
                self.assertEqual(upgraded.alert_id, alert.pk)
                self.assertEqual(upgraded.origin_alert_uuid, alert.pk)
                self.assertEqual(upgraded.case_id, case.pk)
                self.assertEqual(upgraded.body, original.body)
                self.assertEqual(upgraded.raw, original.raw)
                self.assertEqual(upgraded.created_at, original.created_at)
            self.assertEqual(Exchange.objects.get(pk=reply.pk).reply_to_id, source.pk)
            self.assertEqual(Exchange.objects.get(pk=followup.pk).reply_to_id, reply.pk)
            self.assertIsNone(Exchange.objects.get(pk=native.pk).alert_id)
            self.assertEqual(Exchange.objects.get(pk=unusual.pk).raw, ["alert_exchange"])
            self.assertEqual(Exchange.objects.get(pk=automatic.pk).reply_to_id, followup.pk)
            executor = MigrationExecutor(connection)
            executor.migrate(old_target)
            restored = executor.loader.project_state(old_target).apps.get_model("core", "CaseExchange")
            self.assertEqual(restored.objects.count(), 6)
            self.assertEqual(restored.objects.get(pk=source.pk).body, "<b>unchanged</b>")
        finally:
            executor = MigrationExecutor(connection)
            executor.migrate(executor.loader.graph.leaf_nodes())

    def test_rollback_refuses_to_drop_standalone_alert_messages(self):
        alert = Alert.objects.create(title="Standalone")
        message = CaseExchange.objects.create(alert=alert, direction="outbound", body="Keep me")
        with self.assertRaisesRegex(RuntimeError, "standalone alert exchanges"):
            MigrationExecutor(connection).migrate([("core", "0048_case_alert_catalog_severity")])
        message.refresh_from_db()
        self.assertEqual(message.body, "Keep me")
        self.assertEqual(message.alert_id, alert.pk)

    def test_rollback_refuses_case_message_id_collisions(self):
        case = Case.objects.create(title="Shared")
        alert = Alert.objects.create(title="Merged", case=case)
        CaseExchange.objects.create(case=case, direction="inbound", message_id="<duplicate>")
        CaseExchange.objects.create(case=case, alert=alert, direction="inbound", message_id="<duplicate>")
        with self.assertRaisesRegex(RuntimeError, "duplicate message IDs"):
            MigrationExecutor(connection).migrate([("core", "0048_case_alert_catalog_severity")])
        self.assertEqual(CaseExchange.objects.filter(case=case).count(), 2)
