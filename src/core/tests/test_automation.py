from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from core.models import (
    AutomationExecutionLog,
    AuditLogRetentionSettings,
    AutomationRule,
    Alert,
    AlertComment,
    Case,
    CaseExchange,
    CaseExchangeReplyQuickpart,
    Comment,
    Customer,
    Hunt,
    InvestigationTemplate,
    SOARProvider,
    WorkbookInstance,
    WorkbookInstanceItem,
    WorkbookTemplate,
    WorkbookTemplateItem,
)
from core.serializers_settings import AutomationRuleSerializer
from core.celerytasks import (
    purge_audit_logs,
    run_automation_investigation_template_action_task,
)
from core.services_automation import (
    run_automation_rules_for_event,
    run_scheduled_automation_rules,
)


User = get_user_model()


class AutomationRegressionTests(APITestCase):
    def setUp(self):
        self.customer = Customer.objects.create(name="Automation customer")
        self.admin = User.objects.create_user(
            username="automation-regression-admin",
            password="StrongPass-AutomationRegression!",
            is_staff=True,
        )

    def test_exchange_event_executes_matching_automation_rule(self):
        case = Case.objects.create(title="Exchange automation", customer=self.customer)
        AutomationRule.objects.create(
            name="Inbound Exchange rule",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {
                        "field": "event",
                        "operator": "EQUAL",
                        "value": "case.exchange_inbound_received",
                    }
                ],
            },
            actions=[{"type": "add_comment", "body": "Inbound Exchange received"}],
        )
        self.client.force_authenticate(self.admin)

        response = self.client.post(
            f"/api/cases/{case.id}/exchanges/",
            {
                "direction": "inbound",
                "channel": "email",
                "subject": "Inbound message",
                "body": "Message body",
                "sender": "sender@example.test",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue(
            Comment.objects.filter(
                case=case,
                author_label="Doko Automation",
                text="Inbound Exchange received",
            ).exists()
        )
        log = AutomationExecutionLog.objects.get(trigger="case.exchange_inbound_received")
        self.assertEqual(log.status, AutomationExecutionLog.Status.SUCCESS)
        self.assertEqual(log.context["data"]["exchange"]["id"], response.data["id"])
        self.assertNotIn("body", log.context["data"]["exchange"])

    def test_failed_run_once_rule_can_run_again_after_configuration_is_fixed(self):
        case = Case.objects.create(title="Retry automation", customer=self.customer)
        rule = AutomationRule.objects.create(
            name="Retry failed rule",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "case.updated"}
                ],
            },
            actions=[{"type": "change_owner", "value": 999999}],
            run_once_per_target=True,
        )

        first_logs = run_automation_rules_for_event(
            scope="case",
            target=case,
            event="case.updated",
            rule_ids=[rule.id],
        )
        self.assertEqual(first_logs[0].status, AutomationExecutionLog.Status.FAILED)

        rule.actions = [{"type": "add_comment", "body": "Retry succeeded"}]
        rule.save(update_fields=["actions", "updated_at"])
        second_logs = run_automation_rules_for_event(
            scope="case",
            target=case,
            event="case.updated",
            rule_ids=[rule.id],
        )

        self.assertEqual(len(second_logs), 1)
        self.assertEqual(second_logs[0].status, AutomationExecutionLog.Status.SUCCESS)
        self.assertTrue(Comment.objects.filter(case=case, text="Retry succeeded").exists())

    def test_multi_action_status_uses_actual_success_and_failure_counts(self):
        case = Case.objects.create(title="Partial automation", customer=self.customer)
        partial_rule = AutomationRule.objects.create(
            name="Partial result",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "case.updated"}
                ],
            },
            actions=[
                {"type": "change_owner", "value": 999999},
                {"type": "add_comment", "body": "Second action succeeded"},
            ],
        )
        failed_rule = AutomationRule.objects.create(
            name="Failed result",
            scope="case",
            conditions=partial_rule.conditions,
            actions=[
                {"type": "change_owner", "value": 999998},
                {"type": "change_owner", "value": 999999},
            ],
        )

        partial_log = run_automation_rules_for_event(
            scope="case",
            target=case,
            event="case.updated",
            rule_ids=[partial_rule.id],
        )[0]
        failed_log = run_automation_rules_for_event(
            scope="case",
            target=case,
            event="case.updated",
            rule_ids=[failed_rule.id],
        )[0]

        self.assertEqual(partial_log.status, AutomationExecutionLog.Status.PARTIAL_SUCCESS)
        self.assertEqual(failed_log.status, AutomationExecutionLog.Status.FAILED)

    def test_remote_soar_failure_marks_automation_action_failed(self):
        provider = SOARProvider.objects.create(
            name="Failed SOAR",
            code="failed-automation-soar",
            provider_kind="generic_http",
            base_url="https://soar.example.test",
            auth_type="none",
        )
        template = InvestigationTemplate.objects.create(
            code="failed-automation-template",
            name="Failed automation template",
            entity_type="ip",
            target_kind="single",
            soar_provider=provider,
            remote_template_code="failed-template",
        )
        case = Case.objects.create(title="Failed SOAR automation", customer=self.customer)
        rule = AutomationRule.objects.create(
            name="Failed SOAR result",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "case.updated"}
                ],
            },
            actions=[
                {
                    "type": "run_investigation_template",
                    "template_id": str(template.id),
                    "target_source": "manual",
                    "target_type": "ip",
                    "target_value": "203.0.113.10",
                }
            ],
        )

        with patch(
            "core.services_automation.SOARService.launch_execution",
            return_value={"status": "failed", "external_run_id": "remote-failure"},
        ), patch(
            "core.services_automation.SOARService.collect_result",
            return_value={"status": "failed", "message": "Remote execution failed"},
        ):
            log = run_automation_rules_for_event(
                scope="case",
                target=case,
                event="case.updated",
                rule_ids=[rule.id],
            )[0]

        self.assertEqual(log.status, AutomationExecutionLog.Status.FAILED)
        self.assertEqual(log.actions_results[0]["status"], "failed")

    def test_async_investigation_is_dispatched_only_after_parent_log_is_persisted(self):
        provider = SOARProvider.objects.create(
            name="Queued SOAR",
            code="queued-automation-soar",
            provider_kind="generic_http",
            base_url="https://soar.example.test",
            auth_type="none",
        )
        template = InvestigationTemplate.objects.create(
            code="queued-automation-template",
            name="Queued automation template",
            entity_type="ip",
            target_kind="single",
            soar_provider=provider,
            remote_template_code="queued-template",
        )
        case = Case.objects.create(title="Queued SOAR automation", customer=self.customer)
        rule = AutomationRule.objects.create(
            name="Queued SOAR result",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "case.updated"}
                ],
            },
            actions=[
                {
                    "type": "run_investigation_template",
                    "template_id": str(template.id),
                    "target_source": "manual",
                    "target_type": "ip",
                    "target_value": "203.0.113.11",
                    "post_result_comment": True,
                }
            ],
        )
        observed = {}

        def dispatch_after_save(*args, **kwargs):
            execution_log_id = kwargs["kwargs"]["execution_log_id"]
            parent = AutomationExecutionLog.objects.get(id=execution_log_id)
            observed["status"] = parent.status
            observed["action_status"] = parent.actions_results[0]["status"]

        with patch(
            "core.services_automation.transaction.on_commit",
            side_effect=lambda callback: callback(),
        ), patch(
            "core.celerytasks.run_automation_investigation_template_action_task.apply_async",
            side_effect=dispatch_after_save,
        ):
            log = run_automation_rules_for_event(
                scope="case",
                target=case,
                event="case.updated",
                rule_ids=[rule.id],
            )[0]

        self.assertEqual(log.status, AutomationExecutionLog.Status.RUNNING)
        self.assertEqual(observed, {"status": "running", "action_status": "queued"})

    def test_case_archive_status_keeps_archive_fields_consistent(self):
        case = Case.objects.create(title="Archive automation", customer=self.customer)
        archive_rule = AutomationRule.objects.create(
            name="Archive case",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "case.updated"}
                ],
            },
            actions=[{"type": "change_status", "value": "archived"}],
            run_once_per_target=False,
        )

        run_automation_rules_for_event(
            scope="case",
            target=case,
            event="case.updated",
            rule_ids=[archive_rule.id],
        )
        case.refresh_from_db()

        self.assertEqual(case.status, Case.Status.ARCHIVED)
        self.assertIsNotNone(case.archived_at)

        archive_rule.actions = [{"type": "change_status", "value": "open"}]
        archive_rule.save(update_fields=["actions", "updated_at"])
        run_automation_rules_for_event(
            scope="case",
            target=case,
            event="case.updated",
            rule_ids=[archive_rule.id],
        )
        case.refresh_from_db()

        self.assertEqual(case.status, Case.Status.OPEN)
        self.assertIsNone(case.archived_at)
        self.assertIsNotNone(case.unarchived_at)

    def test_alert_and_hunt_item_updates_emit_specific_automation_events(self):
        alert = Alert.objects.create(title="Alert item event", customer=self.customer)
        hunt = Hunt.objects.create(title="Hunt item event", customer=self.customer)
        self.client.force_authenticate(self.admin)

        with patch("core.views._run_automation_safely") as run_automation:
            alert_response = self.client.patch(
                f"/api/alerts/{alert.id}/",
                {"iocs": [{"key": "ip", "value": "203.0.113.40"}]},
                format="json",
            )
            hunt_response = self.client.patch(
                f"/api/hunts/{hunt.id}/",
                {"assets": [{"key": "hostname", "value": "host-40"}]},
                format="json",
            )

        self.assertEqual(alert_response.status_code, 200)
        self.assertEqual(hunt_response.status_code, 200)
        calls = [call.kwargs for call in run_automation.call_args_list]
        self.assertTrue(
            any(
                item.get("scope") == "alert"
                and item.get("event") == "alert.ioc_added"
                and item.get("data", {}).get("added_ioc", {}).get("value") == "203.0.113.40"
                for item in calls
            )
        )
        self.assertTrue(
            any(
                item.get("scope") == "hunt"
                and item.get("event") == "hunt.asset_added"
                and item.get("data", {}).get("added_asset", {}).get("value") == "host-40"
                for item in calls
            )
        )

    def test_scheduled_rule_runs_once_per_target_for_the_current_minute(self):
        case = Case.objects.create(title="Scheduled case", customer=self.customer)
        scheduled_time = timezone.localtime().strftime("%H:%M")
        AutomationRule.objects.create(
            name="Scheduled once per minute",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {
                        "field": "scheduled_time",
                        "operator": "EQUAL",
                        "value": scheduled_time,
                    }
                ],
            },
            actions=[{"type": "add_comment", "body": "Scheduled comment"}],
            run_once_per_target=False,
        )

        first = run_scheduled_automation_rules()
        second = run_scheduled_automation_rules()

        self.assertEqual(first["case"], 1)
        self.assertEqual(second["case"], 0)
        self.assertEqual(Comment.objects.filter(case=case, text="Scheduled comment").count(), 1)

    def test_scheduled_rule_detection_uses_condition_fields_not_text_values(self):
        Case.objects.create(title="scheduled_time marker", customer=self.customer)
        AutomationRule.objects.create(
            name="Text mentions scheduled field",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {
                        "field": "title",
                        "operator": "CONTAINS",
                        "value": "scheduled_time",
                    }
                ],
            },
            actions=[{"type": "add_comment", "body": "Should not run from scheduler"}],
        )

        result = run_scheduled_automation_rules()

        self.assertEqual(result["case"], 0)

    def test_rule_validation_rejects_empty_actions_and_incompatible_conditions(self):
        base = {
            "name": "Invalid rule",
            "scope": "case",
            "conditions": {
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "case.updated"}
                ],
            },
            "actions": [],
        }
        self.assertFalse(AutomationRuleSerializer(data=base).is_valid())

        base["actions"] = [{"type": "add_comment", "body": "Comment"}]
        base["conditions"] = {
            "operator": "AND",
            "children": [
                {"field": "title", "operator": "GREATER THAN", "value": "10"}
            ],
        }
        self.assertFalse(AutomationRuleSerializer(data=base).is_valid())

        base["conditions"] = {
            "operator": "AND",
            "children": [
                {"field": "ioc_count", "operator": "GREATER THAN", "value": "many"}
            ],
        }
        self.assertFalse(AutomationRuleSerializer(data=base).is_valid())

    def test_alert_rule_cannot_set_merged_status_without_linking_to_a_case(self):
        serializer = AutomationRuleSerializer(data={
            "name": "Unsafe merged status",
            "scope": "alert",
            "conditions": {
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "alert.updated"}
                ],
            },
            "actions": [{"type": "change_status", "value": "merged"}],
        })

        self.assertFalse(serializer.is_valid())

        alert = Alert.objects.create(title="Unlinked alert", customer=self.customer)
        legacy_rule = AutomationRule.objects.create(
            name="Legacy unsafe merged status",
            scope="alert",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "alert.updated"}
                ],
            },
            actions=[{"type": "change_status", "value": "merged"}],
        )
        log = run_automation_rules_for_event(
            scope="alert",
            target=alert,
            event="alert.updated",
            rule_ids=[legacy_rule.id],
        )[0]

        self.assertEqual(log.status, AutomationExecutionLog.Status.FAILED)
        alert.refresh_from_db()
        self.assertEqual(alert.status, Alert.Status.OPEN)

    def test_inactive_exchange_quickpart_does_not_fall_back_to_inline_body(self):
        case = Case.objects.create(title="Inactive quickpart", customer=self.customer)
        quickpart = CaseExchangeReplyQuickpart.objects.create(
            name="Inactive quickpart",
            body="Inactive body",
            is_active=False,
        )
        rule = AutomationRule.objects.create(
            name="Inactive quickpart rule",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "case.updated"}
                ],
            },
            actions=[{
                "type": "exchange_message",
                "quickpart_id": str(quickpart.id),
                "body": "Fallback body",
                "send_mode": "save",
            }],
        )

        log = run_automation_rules_for_event(
            scope="case",
            target=case,
            event="case.updated",
            rule_ids=[rule.id],
        )[0]

        self.assertEqual(log.status, AutomationExecutionLog.Status.FAILED)
        self.assertFalse(CaseExchange.objects.filter(case=case).exists())

    def test_reply_all_inbound_processes_every_exchange(self):
        case = Case.objects.create(title="Reply all", customer=self.customer)
        CaseExchange.objects.bulk_create([
            CaseExchange(
                case=case,
                direction="inbound",
                channel="email",
                subject=f"Inbound {index}",
                sender=f"sender{index}@example.test",
            )
            for index in range(21)
        ])
        rule = AutomationRule.objects.create(
            name="Reply every inbound Exchange",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "case.updated"}
                ],
            },
            actions=[{
                "type": "exchange_reply_all_inbound",
                "body": "Automated reply",
                "send_mode": "save",
            }],
        )

        log = run_automation_rules_for_event(
            scope="case",
            target=case,
            event="case.updated",
            rule_ids=[rule.id],
        )[0]

        self.assertEqual(log.status, AutomationExecutionLog.Status.SUCCESS)
        self.assertEqual(CaseExchange.objects.filter(case=case, direction="outbound").count(), 21)

    def test_reapplying_same_workbook_template_preserves_progress(self):
        case = Case.objects.create(title="Workbook progress", customer=self.customer)
        template = WorkbookTemplate.objects.create(name="Progress workbook")
        WorkbookTemplateItem.objects.create(template=template, label="Review", order=0)
        rule = AutomationRule.objects.create(
            name="Apply workbook",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "case.updated"}
                ],
            },
            actions=[{
                "type": "apply_workbook_template",
                "workbook_template_id": str(template.id),
            }],
            run_once_per_target=False,
        )

        run_automation_rules_for_event(
            scope="case",
            target=case,
            event="case.updated",
            rule_ids=[rule.id],
        )
        workbook = WorkbookInstance.objects.get(case=case)
        item = WorkbookInstanceItem.objects.get(instance=workbook)
        item.is_done = True
        item.save(update_fields=["is_done"])

        run_automation_rules_for_event(
            scope="case",
            target=case,
            event="case.updated",
            rule_ids=[rule.id],
        )

        self.assertTrue(WorkbookInstanceItem.objects.get(instance=workbook).is_done)

    def test_alert_link_transition_triggers_alert_updated_rules(self):
        case = Case.objects.create(title="Link target", customer=self.customer)
        alert = Alert.objects.create(title="Link source", customer=self.customer)
        AutomationRule.objects.create(
            name="Alert merged transition",
            scope="alert",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "status", "operator": "EQUAL", "value": "merged"}
                ],
            },
            actions=[{"type": "add_comment", "body": "Alert linked"}],
        )
        self.client.force_authenticate(self.admin)

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                f"/api/alerts/{alert.id}/link/",
                {"case_id": str(case.id)},
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(AlertComment.objects.filter(alert=alert, text="Alert linked").exists())

    def test_repeatable_exchange_rule_creates_one_message_per_execution(self):
        case = Case.objects.create(title="Repeatable Exchange", customer=self.customer)
        rule = AutomationRule.objects.create(
            name="Repeatable Exchange rule",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "case.updated"}
                ],
            },
            actions=[{
                "type": "exchange_message",
                "body": "One message per execution",
                "send_mode": "save",
            }],
            run_once_per_target=False,
        )

        for _ in range(2):
            run_automation_rules_for_event(
                scope="case",
                target=case,
                event="case.updated",
                rule_ids=[rule.id],
            )

        self.assertEqual(CaseExchange.objects.filter(case=case, direction="outbound").count(), 2)

    def test_async_investigation_completion_updates_parent_execution_log(self):
        case = Case.objects.create(title="Async completion", customer=self.customer)
        rule = AutomationRule.objects.create(
            name="Async completion rule",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "case.updated"}
                ],
            },
            actions=[{"type": "run_investigation_template"}],
        )
        log = AutomationExecutionLog.objects.create(
            rule=rule,
            scope="case",
            target_id=str(case.id),
            trigger="case.updated",
            matched=True,
            status=AutomationExecutionLog.Status.RUNNING,
            actions_results=[{
                "index": 0,
                "status": "queued",
                "result": {"queued": True},
            }],
        )

        with patch(
            "core.services_automation._run_investigation_template",
            return_value={
                "processed_item_keys": ["ioc:ip:203.0.113.50"],
                "runs": [{"result": {"sensitive": "value"}}],
            },
        ):
            result = run_automation_investigation_template_action_task.run(
                scope="case",
                target_id=str(case.id),
                event="case.updated",
                action={"type": "run_investigation_template"},
                execution_log_id=str(log.id),
                action_index=0,
            )

        log.refresh_from_db()
        self.assertEqual(result["status"], "success")
        self.assertEqual(log.status, AutomationExecutionLog.Status.SUCCESS)
        self.assertEqual(log.actions_results[0]["status"], "success")
        self.assertEqual(log.actions_results[0]["result"]["runs"], "[redacted]")

    def test_audit_retention_also_purges_old_automation_execution_logs(self):
        case = Case.objects.create(title="Old automation log", customer=self.customer)
        rule = AutomationRule.objects.create(
            name="Old log rule",
            scope="case",
            conditions={
                "operator": "AND",
                "children": [
                    {"field": "event", "operator": "EQUAL", "value": "case.updated"}
                ],
            },
            actions=[{"type": "add_comment", "body": "Old"}],
        )
        log = AutomationExecutionLog.objects.create(
            rule=rule,
            scope="case",
            target_id=str(case.id),
            trigger="case.updated",
            matched=True,
            status=AutomationExecutionLog.Status.SUCCESS,
            completed_at=timezone.now() - timezone.timedelta(days=3),
        )
        AutomationExecutionLog.objects.filter(id=log.id).update(
            started_at=timezone.now() - timezone.timedelta(days=3)
        )
        settings = AuditLogRetentionSettings.get_solo()
        settings.max_days = 1
        settings.save(update_fields=["max_days", "updated_at"])

        result = purge_audit_logs.run()

        self.assertEqual(result["deleted_automation_logs"], 1)
        self.assertFalse(AutomationExecutionLog.objects.filter(id=log.id).exists())

    def test_deferred_async_actions_keep_their_own_parent_log_ids(self):
        case = Case.objects.create(title="Deferred parent IDs", customer=self.customer)
        conditions = {
            "operator": "AND",
            "children": [
                {"field": "event", "operator": "EQUAL", "value": "case.updated"}
            ],
        }
        action = {
            "type": "run_investigation_template",
            "template_id": "00000000-0000-0000-0000-000000000001",
            "target_source": "manual",
            "target_type": "ip",
            "target_value": "203.0.113.60",
            "post_result_comment": True,
        }
        rules = [
            AutomationRule.objects.create(
                name=f"Deferred rule {index}",
                scope="case",
                conditions=conditions,
                actions=[action],
            )
            for index in range(2)
        ]
        callbacks = []

        with patch(
            "core.services_automation.transaction.on_commit",
            side_effect=callbacks.append,
        ), patch(
            "core.celerytasks.run_automation_investigation_template_action_task.apply_async"
        ) as apply_async:
            logs = run_automation_rules_for_event(
                scope="case",
                target=case,
                event="case.updated",
                rule_ids=[rule.id for rule in rules],
            )
            for callback in callbacks:
                callback()

        dispatched_log_ids = {
            call.kwargs["kwargs"]["execution_log_id"]
            for call in apply_async.call_args_list
        }
        self.assertEqual(dispatched_log_ids, {str(log.id) for log in logs})
