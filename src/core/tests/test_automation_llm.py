from unittest.mock import patch
from django.test import TestCase
from django.contrib.auth import get_user_model
from core.models import AIProvider, Alert, AlertComment, AutomationRule, AutomationExecutionLog, Customer, ChatSession, Case, Comment
from core.services_automation import AutomationContext, execute_action


class AutomationLLMTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="automation-author", is_staff=True)
        self.customer = Customer.objects.create(name="Target customer")
        self.alert = Alert.objects.create(title="Target alert", description="Target evidence", customer=self.customer)
        self.rule = AutomationRule.objects.create(name="LLM", scope="alert", created_by=self.user,
                                                  conditions={"field": "event", "operator": "EQUAL", "value": "alert.created"},
                                                  actions=[{"type": "llm_comment", "prompt": "Analyse this alert"}])
        self.provider = AIProvider.objects.create(name="Default", base_url="http://llm.example.test", is_enabled=True, is_default=True, default_system_prompt="Custom system instruction")

    def test_action_queues_without_calling_llm(self):
        ctx = AutomationContext(scope="alert", target=self.alert, event="alert.created", rule=self.rule)
        with patch("core.services_llm.LLMService.generate") as generate:
            result = execute_action(ctx, self.rule.actions[0])
        self.assertTrue(result["queued"])
        self.assertEqual(result["_deferred_task"]["target_id"], str(self.alert.pk))
        generate.assert_not_called()

    def test_one_hundred_events_keep_one_hundred_queued_prompts(self):
        from core.services_automation import run_automation_rules_for_event
        with patch("core.services_automation._dispatch_async_automation_action") as dispatch, patch("core.services_llm.LLMService.generate") as generate:
            with self.captureOnCommitCallbacks(execute=True):
                for index in range(100):
                    alert = Alert.objects.create(title=f"Batch alert {index}", customer=self.customer)
                    run_automation_rules_for_event(scope="alert", event="alert.created", target=alert, actor=self.user)
        self.assertEqual(dispatch.call_count, 100)
        self.assertEqual(AutomationExecutionLog.objects.filter(rule=self.rule, status="running").count(), 100)
        generate.assert_not_called()

    def queued(self, target=None, prompt="Analyse this alert"):
        target = target or self.alert
        scope = "case" if isinstance(target, Case) else "alert"
        self.rule.scope = scope
        self.rule.save()
        log = AutomationExecutionLog.objects.create(rule=self.rule, scope=scope, target_id=str(target.pk),
            trigger=f"{scope}.created", matched=True, status="running",
            actions_results=[{"index": 0, "status": "queued", "result": {"queued": True}}])
        return log, dict(execution_log_id=str(log.id), action_index=0, scope=scope, target_id=str(target.pk),
                        customer_id=str(target.customer_id or ""), action={"type": "llm_comment", "prompt": prompt})

    def test_worker_uses_catbot_context_without_conversations_or_soar(self):
        from core.celerytasks import run_automation_llm_comment_task
        other = Customer.objects.create(name="Other tenant")
        Alert.objects.create(title="DO NOT SEND OTHER ALERT", customer=other)
        self.alert.iocs = [{"value": "indicator", "token": "DO NOT SEND SECRET"}]
        self.alert.save()
        log, kwargs = self.queued(prompt="/not-a-command explain the evidence")
        with patch("core.services_llm.LLMService.generate", return_value="**Analysis**\n<script>literal</script>") as generate, patch("core.services_soar.SOARService.execute_template") as soar:
            result = run_automation_llm_comment_task.run(**kwargs)
            duplicate = run_automation_llm_comment_task.run(**kwargs)
        self.assertEqual(result["status"], "success")
        self.assertEqual(duplicate["status"], "skipped")
        self.assertEqual(generate.call_count, 1)
        soar.assert_not_called()
        prompt = generate.call_args.kwargs["user_prompt"]
        self.assertIn("Target evidence", prompt)
        self.assertIn("indicator", prompt)
        self.assertIn("/not-a-command", prompt)
        self.assertNotIn("DO NOT SEND", prompt)
        self.assertIn("Custom system instruction", generate.call_args.kwargs["system_prompt"])
        self.assertEqual(AlertComment.objects.get(alert=self.alert).text, "**Analysis**\n<script>literal</script>")
        self.assertEqual(ChatSession.objects.count(), 0)
        log.refresh_from_db()
        self.assertEqual(log.status, "success")
        self.assertNotIn("Analysis", str(log.actions_results))

    def test_case_comment_is_posted_to_case_only(self):
        from core.celerytasks import run_automation_llm_comment_task
        case = Case.objects.create(title="Case evidence", customer=self.customer)
        log, kwargs = self.queued(case)
        with patch("core.services_llm.LLMService.generate", return_value="Case response"):
            self.assertEqual(run_automation_llm_comment_task.run(**kwargs)["status"], "success")
        self.assertEqual(Comment.objects.get(case=case).text, "Case response")
        self.assertFalse(AlertComment.objects.exists())

    def test_disabled_provider_fails_without_call_or_comment(self):
        from core.celerytasks import run_automation_llm_comment_task
        self.provider.is_enabled = False
        self.provider.save()
        log, kwargs = self.queued()
        with patch("core.services_llm.LLMService.generate") as generate:
            self.assertEqual(run_automation_llm_comment_task.run(**kwargs)["status"], "failed")
        generate.assert_not_called()
        self.assertFalse(AlertComment.objects.exists())

    def test_provider_error_is_not_leaked_or_posted(self):
        from core.celerytasks import run_automation_llm_comment_task
        log, kwargs = self.queued()
        with patch("core.services_llm.LLMService.generate", side_effect=RuntimeError("private prompt and secret")):
            self.assertEqual(run_automation_llm_comment_task.run(**kwargs)["status"], "failed")
        log.refresh_from_db()
        self.assertNotIn("private", log.error)
        self.assertFalse(AlertComment.objects.exists())

    def test_customer_change_during_generation_prevents_publication(self):
        from core.celerytasks import run_automation_llm_comment_task
        other = Customer.objects.create(name="Different customer")
        log, kwargs = self.queued()
        def generate(**unused):
            Alert.objects.filter(pk=self.alert.pk).update(customer=other)
            return "Old customer data"
        with patch("core.services_llm.LLMService.generate", side_effect=generate):
            self.assertEqual(run_automation_llm_comment_task.run(**kwargs)["status"], "failed")
        self.assertFalse(AlertComment.objects.exists())

    def test_deleted_author_does_not_block_authorized_automation(self):
        from core.celerytasks import run_automation_llm_comment_task
        self.rule.created_by = None
        self.rule.save()
        log, kwargs = self.queued()
        with patch("core.services_llm.LLMService.generate", return_value="Automatic response"):
            self.assertEqual(run_automation_llm_comment_task.run(**kwargs)["status"], "success")

    def test_validation_rejects_empty_prompt_and_hunt_scope(self):
        from core.serializers_settings import AutomationRuleSerializer
        for scope, prompt in [("alert", " "), ("hunt", "Analyse")]:
            ser = AutomationRuleSerializer(data={"name": "Invalid", "scope": scope,
                "actions": [{"type": "llm_comment", "prompt": prompt}]})
            self.assertFalse(ser.is_valid())

    def test_valid_action_serializes_for_alert_and_case(self):
        from core.serializers_settings import AutomationRuleSerializer
        for scope in ("alert", "case"):
            ser = AutomationRuleSerializer(data={"name": "Valid", "scope": scope,
                "conditions": {"field": "event", "operator": "EQUAL", "value": f"{scope}.created"},
                "actions": [{"type": "llm_comment", "prompt": "Explain this evidence"}]})
            self.assertTrue(ser.is_valid(), ser.errors)

    def test_empty_response_never_posts_comment(self):
        from core.celerytasks import run_automation_llm_comment_task
        log, kwargs = self.queued()
        with patch("core.services_llm.LLMService.generate", return_value=" "):
            self.assertEqual(run_automation_llm_comment_task.run(**kwargs)["status"], "failed")
        self.assertFalse(AlertComment.objects.exists())

    def test_mismatched_target_is_rejected_before_llm(self):
        from core.celerytasks import run_automation_llm_comment_task
        log, kwargs = self.queued()
        other = Alert.objects.create(title="Other object", customer=self.customer)
        kwargs["target_id"] = str(other.id)
        with patch("core.services_llm.LLMService.generate") as generate:
            self.assertEqual(run_automation_llm_comment_task.run(**kwargs)["status"], "failed")
        generate.assert_not_called()

    def test_disabled_rule_never_calls_llm(self):
        from core.celerytasks import run_automation_llm_comment_task
        log, kwargs = self.queued()
        self.rule.is_enabled = False
        self.rule.save()
        with patch("core.services_llm.LLMService.generate") as generate:
            self.assertEqual(run_automation_llm_comment_task.run(**kwargs)["status"], "failed")
        generate.assert_not_called()

    def test_real_rule_dispatches_after_commit_and_preserves_other_action(self):
        from core.services_automation import run_automation_rules_for_event
        self.rule.actions.append({"type": "add_comment", "body": "Existing action"})
        self.rule.save()
        with patch("core.celerytasks.run_automation_llm_comment_task.apply_async") as queue:
            with self.captureOnCommitCallbacks(execute=True):
                logs = run_automation_rules_for_event(scope="alert", target=self.alert, event="alert.created", actor=None)
        self.assertEqual(queue.call_count, 1)
        self.assertEqual(AlertComment.objects.get(alert=self.alert).text, "Existing action")
        self.assertEqual(logs[0].status, "running")
        self.assertEqual(queue.call_args.kwargs["kwargs"]["target_id"], str(self.alert.id))
