from django.test import TestCase
from django.utils import timezone
from django.contrib.auth import get_user_model
from unittest.mock import patch
from rest_framework.test import APIRequestFactory, force_authenticate
from core.models import Case, CaseExchange, CaseExchangeFollowup, CaseExchangeReplyQuickpart
from core.celerytasks import run_case_auto_followups
from core.views import dispatch_case_exchange_send, CaseExchangeFollowupBulkView


class ExchangeFollowupTests(TestCase):
    def setUp(self):
        self.case = Case.objects.create(title="Follow-up case")
        self.quickpart = CaseExchangeReplyQuickpart.objects.create(name="Reminder", body="Reminder body")

    def source(self, message_id, action="save", due=True):
        source = CaseExchange.objects.create(case=self.case, direction="outbound", message_id=message_id,
                                             references=["<original>"], to=["recipient@example.test"])
        if due:
            CaseExchange.objects.filter(pk=source.pk).update(created_at=timezone.now() - timezone.timedelta(hours=2))
            source.refresh_from_db()
        cfg = CaseExchangeFollowup.objects.create(exchange=source, quickpart=self.quickpart, enabled=True,
                                                  delay_value=1, delay_unit="hour", action=action)
        if due:
            CaseExchangeFollowup.objects.filter(pk=cfg.pk).update(updated_at=source.created_at)
            cfg.refresh_from_db()
        return source, cfg

    def activate(self, source):
        user = get_user_model().objects.create_user(username="followup-admin", is_staff=True)
        request = APIRequestFactory().post("/", {
            "exchange_ids": [str(source.pk)], "enabled": True,
            "delay_value": 20, "delay_unit": "minute",
            "quickpart_id": str(self.quickpart.pk), "action": "save",
        }, format="json")
        force_authenticate(request, user=user)
        response = CaseExchangeFollowupBulkView.as_view()(request, case_id=str(self.case.pk))
        self.assertEqual(response.status_code, 200)

    def test_old_message_waits_from_activation_and_triggers_only_once(self):
        source, cfg = self.source("<old-message>")
        activated_at = timezone.now()
        with patch("django.utils.timezone.now", return_value=activated_at):
            self.activate(source)
        for minutes in (0, 19):
            with patch("django.utils.timezone.now", return_value=activated_at + timezone.timedelta(minutes=minutes)):
                run_case_auto_followups()
            self.assertFalse(CaseExchange.objects.filter(raw__source_exchange_id=str(source.pk)).exists())
        with patch("django.utils.timezone.now", return_value=activated_at + timezone.timedelta(minutes=20)):
            run_case_auto_followups()
            run_case_auto_followups()
        self.assertEqual(CaseExchange.objects.filter(raw__source_exchange_id=str(source.pk)).count(), 1)

    def test_reactivation_preserves_previous_reminder_and_starts_new_cycle(self):
        source, cfg = self.source("<reactivated>")
        run_case_auto_followups()
        previous = CaseExchange.objects.get(raw__source_exchange_id=str(source.pk))
        activated_at = timezone.now()
        with patch("django.utils.timezone.now", return_value=activated_at):
            self.activate(source)
            run_case_auto_followups()
        cfg.refresh_from_db()
        self.assertTrue(cfg.enabled)
        self.assertIsNone(cfg.last_triggered_at)
        self.assertEqual(CaseExchange.objects.filter(raw__source_exchange_id=str(source.pk)).count(), 1)
        with patch("django.utils.timezone.now", return_value=activated_at + timezone.timedelta(minutes=20)):
            run_case_auto_followups()
            run_case_auto_followups()
        self.assertTrue(CaseExchange.objects.filter(pk=previous.pk).exists())
        self.assertEqual(CaseExchange.objects.filter(raw__source_exchange_id=str(source.pk)).count(), 2)

    def test_reply_after_reactivation_cancels_new_cycle(self):
        source, cfg = self.source("<answered-reactivation>")
        run_case_auto_followups()
        self.activate(source)
        CaseExchange.objects.create(case=self.case, direction="inbound", raw={"in_reply_to": source.message_id})
        with patch("django.utils.timezone.now", return_value=timezone.now() + timezone.timedelta(minutes=21)):
            run_case_auto_followups()
        cfg.refresh_from_db()
        self.assertFalse(cfg.enabled)
        self.assertEqual(CaseExchange.objects.filter(raw__source_exchange_id=str(source.pk)).count(), 1)

    def test_case_update_does_not_postpone_followup(self):
        source, cfg = self.source("<case-updated>")
        activation_time = cfg.updated_at
        self.case.title = "Updated case"
        self.case.save()
        cfg.refresh_from_db()
        self.assertEqual(cfg.updated_at, activation_time)
        run_case_auto_followups()
        self.assertTrue(CaseExchange.objects.filter(raw__source_exchange_id=str(source.pk)).exists())

    def test_followup_targets_selected_message_and_marks_send_output(self):
        source, cfg = self.source("<sent-message>", action="send")
        run_case_auto_followups()
        reminder = CaseExchange.objects.get(raw__source_exchange_id=str(source.id))
        self.assertEqual(reminder.references, ["<original>", "<sent-message>"])
        payload = reminder.raw["send_payload"]
        self.assertEqual(payload["in_reply_to"], "<sent-message>")
        self.assertEqual(payload["headers"]["In-Reply-To"], "<sent-message>")
        self.assertIs(payload["is_followup"], True)
        self.assertEqual(payload["body"], "Reminder body")
        run_case_auto_followups()
        self.assertEqual(CaseExchange.objects.filter(raw__source_exchange_id=str(source.id)).count(), 1)

    def test_regular_send_has_false_flag(self):
        source, _ = self.source("<sent-message>")
        dispatch_case_exchange_send(self.case, source, None)
        self.assertIs(source.raw["send_payload"]["is_followup"], False)

    def test_unrelated_inbound_does_not_cancel_followups(self):
        source, cfg = self.source("<sent-message>")
        CaseExchange.objects.create(case=self.case, direction="inbound", references=["<unrelated>"])
        run_case_auto_followups()
        self.assertTrue(CaseExchange.objects.filter(raw__source_exchange_id=str(source.id)).exists())

    def test_reply_cancels_only_its_target_before_due_time(self):
        first, first_cfg = self.source("<first>", due=False)
        second, second_cfg = self.source("<second>", due=False)
        CaseExchange.objects.create(case=self.case, direction="inbound", references=["<original>", "<first>"], raw={"in_reply_to": "<second>"})
        first_cfg.refresh_from_db()
        second_cfg.refresh_from_db()
        self.assertTrue(first_cfg.enabled)
        self.assertFalse(second_cfg.enabled)

    def test_last_reference_identifies_parent_not_all_ancestors(self):
        first, first_cfg = self.source("<first>", due=False)
        second, second_cfg = self.source("<second>", due=False)
        CaseExchange.objects.create(case=self.case, direction="inbound", references=["<first>", "<second>"])
        first_cfg.refresh_from_db()
        second_cfg.refresh_from_db()
        self.assertTrue(first_cfg.enabled)
        self.assertFalse(second_cfg.enabled)

    def test_missing_source_id_does_not_reply_to_ancestor(self):
        source, _ = self.source("", action="send")
        run_case_auto_followups()
        reminder = CaseExchange.objects.get(raw__source_exchange_id=str(source.id))
        self.assertEqual(reminder.raw["send_payload"]["in_reply_to"], "")
        self.assertNotIn("In-Reply-To", reminder.raw["send_payload"]["headers"])

    def test_legacy_case_followup_uses_last_outbound_id(self):
        source, cfg = self.source("<sent-message>")
        cfg.delete()
        self.case.auto_followup_enabled = True
        self.case.auto_followup_delay_value = 1
        self.case.auto_followup_quickpart = self.quickpart
        self.case.save()
        run_case_auto_followups()
        reminder = CaseExchange.objects.get(raw__source_exchange_id=str(source.id))
        self.assertEqual(reminder.references, ["<original>", "<sent-message>"])
        self.assertEqual(reminder.raw["in_reply_to"], "<sent-message>")

    def test_save_only_keeps_recipients_without_dispatch_and_deduplicates_parent(self):
        source, _ = self.source("<sent-message>")
        source.references = ["<original>", "<sent-message>"]
        source.cc = ["copy@example.test"]
        source.bcc = ["hidden@example.test"]
        source.save()
        run_case_auto_followups()
        reminder = CaseExchange.objects.get(raw__source_exchange_id=str(source.id))
        self.assertEqual(reminder.references, ["<original>", "<sent-message>"])
        self.assertEqual(reminder.to, source.to)
        self.assertEqual(reminder.cc, source.cc)
        self.assertEqual(reminder.bcc, source.bcc)
        self.assertNotIn("send_payload", reminder.raw)

    def test_in_reply_to_header_takes_precedence_and_accepts_bracket_variants(self):
        source, cfg = self.source("<sent-message>", due=False)
        CaseExchange.objects.create(case=self.case, direction="inbound", references=["<unrelated>"], raw={"headers": {"in-reply-to": "sent-message"}})
        cfg.refresh_from_db()
        self.assertFalse(cfg.enabled)

    def test_reply_in_other_case_does_not_cancel(self):
        source, cfg = self.source("<sent-message>", due=False)
        other = Case.objects.create(title="Other case")
        CaseExchange.objects.create(case=other, direction="inbound", references=["<sent-message>"])
        cfg.refresh_from_db()
        self.assertTrue(cfg.enabled)

    def test_unthreaded_message_does_not_cancel(self):
        source, cfg = self.source("<sent-message>", due=False)
        CaseExchange.objects.create(case=self.case, direction="inbound", body="Unrelated message")
        cfg.refresh_from_db()
        self.assertTrue(cfg.enabled)

    def test_worker_catches_reply_imported_without_save_signal(self):
        source, cfg = self.source("<sent-message>")
        CaseExchange.objects.bulk_create([CaseExchange(case=self.case, direction="inbound", references=["<sent-message>"])])
        run_case_auto_followups()
        cfg.refresh_from_db()
        self.assertFalse(cfg.enabled)
        self.assertFalse(CaseExchange.objects.filter(raw__source_exchange_id=str(source.id)).exists())
