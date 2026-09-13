from django.test import SimpleTestCase
from pathlib import Path
import re
from unittest import skipUnless
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase
from core.models import (
    AIProvider, Alert, AlertComment, Case, Comment, Hunt, HuntJournalEntry,
    Task, TaskComment, Customer, ChatSession, ChatContextSnapshot, ChatRun, ChatGeneratedDraft,
    CaseExchange, CaseExchangeFollowup, CaseExchangeReplyQuickpart,
)
from core.reports_engine import render_report_html
from core.services_chat_posting import post_generated_draft

from core.serializers import (
    AlertCommentSerializer,
    CommentSerializer,
    HuntJournalEntrySerializer,
    TaskCommentSerializer,
    CaseExchangeCreateSerializer,
    CaseExchangeSerializer,
    CaseExchangeReplyQuickpartSerializer,
    AlertSerializer,
    CaseSerializer,
    HuntListSerializer,
    HuntDetailSerializer,
    TaskDetailSerializer,
)


@skipUnless((Path(__file__).resolve().parents[3] / "frontend/src/pages/settings/Reports.tsx").exists(), "Frontend sources required for sample template integration tests")
class SampleReportTemplateTests(SimpleTestCase):
    def render_sample(self, exchanges):
        source = (Path(__file__).resolve().parents[3] / "frontend/src/pages/settings/Reports.tsx").read_text()
        template = re.search(r"const defaultTemplateHtml = `([\s\S]*?)`;", source).group(1)
        return render_report_html(template, {
            "case": {"id": "sample-case", "case_number": 42, "title": "Test incident", "status": "open",
                     "severity": "high", "classification": "generic", "outcome": "unknown", "owner": None,
                     "customer": None, "subgroups": [], "created_at": None, "updated_at": None,
                     "description": "", "iocs": [], "assets": []},
            "workbook": None, "linked_alerts": [], "params": {}, "generated_at": None,
            "generated_by": None, "exchanges": exchanges,
        })

    def test_sample_includes_exchange_as_literal_text(self):
        rendered = self.render_sample([CaseExchange(direction="inbound", subject="Incoming message", body="<script>literal</script>\nsecond line")])
        self.assertIn("Incoming message", rendered)
        self.assertIn("&lt;script&gt;literal&lt;/script&gt;", rendered)
        self.assertNotIn("<script>", rendered)

    def test_sample_renders_without_optional_data(self):
        rendered = self.render_sample([])
        self.assertIn("Test incident", rendered)
        self.assertNotIn("<h2>Exchange</h2>", rendered)


class MarkdownContentTests(SimpleTestCase):
    def test_reports_do_not_interpret_html_in_markdown_comments(self):
        for model, field in ((Comment, "text"), (AlertComment, "text"), (HuntJournalEntry, "text"),
                             (TaskComment, "text"), (Case, "description"), (Alert, "description"),
                             (Hunt, "context"), (Hunt, "conclusion"), (Task, "description")):
            item = model(**{field: '<script>alert(1)</script>\n<div>literal</div>'})
            for suffix in ("", "|safe", "|nl2br|safe"):
                with self.subTest(model=model.__name__, field=field, suffix=suffix):
                    rendered = render_report_html("{{ item." + field + suffix + " }}", {"item": item})
                    self.assertNotIn("<script>", rendered)
                    self.assertNotIn("<div>", rendered)
                    self.assertIn("&lt;script&gt;", rendered)
                    self.assertNotIn("&amp;lt;", rendered)

    def test_markdown_fields_preserve_significant_whitespace(self):
        content = '    <script>literal</script>\n    line two  \n'
        for serializer_class, field in (
            (AlertSerializer, "description"),
            (CaseSerializer, "description"),
            (HuntListSerializer, "context"),
            (HuntDetailSerializer, "context"),
            (HuntDetailSerializer, "conclusion"),
            (TaskDetailSerializer, "description"),
            (AlertCommentSerializer, "text"),
            (CommentSerializer, "text"),
            (HuntJournalEntrySerializer, "text"),
            (TaskCommentSerializer, "text"),
        ):
            with self.subTest(serializer=serializer_class.__name__, field=field):
                serializer = serializer_class(data={field: content}, partial=True)
                self.assertTrue(serializer.is_valid(), serializer.errors)
                self.assertEqual(serializer.validated_data[field], content)

    def test_comment_validation_preserves_code_and_html_as_text(self):
        content = '```html\n<div data-value="x">literal</div>\n<script>alert(1)</script>\n```\n\n```python\nif a < b and c > d:\n    print("ok")\n```'
        for serializer_class in (
            AlertCommentSerializer,
            CommentSerializer,
            HuntJournalEntrySerializer,
            TaskCommentSerializer,
        ):
            with self.subTest(serializer=serializer_class.__name__):
                serializer = serializer_class(data={"text": content}, partial=True)
                self.assertTrue(serializer.is_valid(), serializer.errors)
                self.assertEqual(serializer.validated_data["text"], content)

    def test_exchange_preserves_raw_html_and_whitespace(self):
        content = '  <html>\r\n<body style="color:red"><script>alert(1)</script><img src="https://example.test/x">&amp; **literal**</body>\r\n</html>  \n'
        for serializer_class in (CaseExchangeCreateSerializer, CaseExchangeSerializer, CaseExchangeReplyQuickpartSerializer):
            with self.subTest(serializer=serializer_class.__name__):
                serializer = serializer_class(data={"body": content}, partial=True)
                self.assertTrue(serializer.is_valid(), serializer.errors)
                self.assertEqual(serializer.validated_data["body"], content)

    def test_reports_display_exchange_body_as_literal_text_even_with_safe_filter(self):
        item = CaseExchange(body='<script>alert(1)</script>\n<img src="https://example.test/x">')
        for suffix in ("", "|safe", "|nl2br|safe", "|trim|safe", "|replace('literal', 'text')|safe"):
            rendered = render_report_html("{{ item.body" + suffix + " }}", {"item": item})
            self.assertNotIn("<script>", rendered)
            self.assertNotIn("<img", rendered)
            self.assertIn("&lt;script&gt;", rendered)
            self.assertNotIn("&amp;lt;", rendered)


class MarkdownPersistenceTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="markdown-test", is_staff=True)
        self.customer = Customer.objects.create(name="Markdown test")
        self.client.force_authenticate(self.user)
        self.case = Case.objects.create(title="Markdown case", customer=self.customer)
        self.alert = Alert.objects.create(title="Markdown alert", customer=self.customer)
        self.hunt = Hunt.objects.create(title="Markdown hunt", customer=self.customer)
        self.task = Task.objects.create(title="Markdown task")
        self.task.customers.add(self.customer)

    def test_exchange_save_send_and_patch_preserve_raw_body_and_message_metadata(self):
        content = '  <html>\n<body><strong>Bonjour</strong><script>alert(1)</script><hr>&lt;p&gt;</body>\n</html>\n'
        for endpoint in ("exchanges/", "exchanges/send/"):
            with self.subTest(endpoint=endpoint):
                response = self.client.post(f"/api/cases/{self.case.id}/{endpoint}", {
                    "direction": "inbound", "channel": "email", "body": content,
                    "message_id": endpoint, "references": ["parent-id"],
                    "to": ["user@example.test"], "raw": {"in_reply_to": "parent-id"},
                }, format="json")
                self.assertEqual(response.status_code, 201, response.data)
                exchange = CaseExchange.objects.get(pk=response.data["id"])
                self.assertEqual(exchange.body, content)
                self.assertEqual(response.data["body"], content)
                self.assertEqual(exchange.references, ["parent-id"])
                if endpoint.endswith("send/"):
                    self.assertEqual(exchange.raw["send_payload"]["body"], content)
                    self.assertEqual(exchange.raw["send_payload"]["in_reply_to"], "parent-id")
                updated = content + '<a href="javascript:alert(1)">literal</a>  '
                response = self.client.patch(f"/api/exchanges/{exchange.id}/", {"body": updated}, format="json")
                self.assertEqual(response.status_code, 200, response.data)
                exchange.refresh_from_db()
                self.assertEqual(exchange.body, updated)
                self.assertEqual(exchange.message_id, endpoint)
                listing = self.client.get(f"/api/cases/{self.case.id}/exchanges/")
                self.assertEqual(next(x for x in listing.data if x["id"] == str(exchange.id))["body"], updated)

    def test_alert_import_preserves_raw_exchange_body(self):
        content = '<html>\n<script>literal</script><hr><br>\n</html>  '
        self.alert.raw = {"case_exchanges": [{"body": content, "message_id": "imported-id"}]}
        self.alert.save(update_fields=["raw"])
        response = self.client.post(f"/api/alerts/{self.alert.id}/link/", {"case_id": str(self.case.id)}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(CaseExchange.objects.get(case=self.case, message_id="imported-id").body, content)

    def test_quickpart_followup_and_automation_preserve_raw_body(self):
        from core.celerytasks import run_case_auto_followups
        from core.services_automation import AutomationContext, _create_exchange_from_source

        content = '  <html><script>literal</script><hr>&amp;</html>\n'
        response = self.client.post("/api/settings/case-exchange-reply-quickparts/", {"name": "Raw", "body": content}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        qp = CaseExchangeReplyQuickpart.objects.get(pk=response.data["id"])
        self.assertEqual(qp.body, content)
        source = CaseExchange.objects.create(case=self.case, direction="outbound", body="source", to=["user@example.test"])
        CaseExchange.objects.filter(pk=source.pk).update(created_at=timezone.now() - timezone.timedelta(hours=2))
        CaseExchangeFollowup.objects.create(exchange=source, quickpart=qp, enabled=True, delay_value=1, delay_unit="hour", action="send")
        run_case_auto_followups()
        followup = CaseExchange.objects.get(raw__source_exchange_id=str(source.id))
        self.assertEqual(followup.body, content)
        self.assertEqual(followup.raw["send_payload"]["body"], content)
        ctx = AutomationContext(scope="case", target=self.case, event="case.updated", actor=self.user)
        for action in ({"body": content, "send_mode": "save"}, {"quickpart_id": str(qp.id), "send_mode": "save"}):
            exchange = _create_exchange_from_source(case=self.case, source=source, action=action, ctx=ctx)
            self.assertEqual(exchange.body, content)

    def test_comment_api_round_trip_keeps_code(self):
        content = '```html\n<script>alert(1)</script>\n<div>{x}</div>\n```'
        for path, model in (
            (f"/api/cases/{self.case.id}/comments/", Comment),
            (f"/api/alerts/{self.alert.id}/comments/", AlertComment),
            (f"/api/hunts/{self.hunt.id}/journal/", HuntJournalEntry),
            (f"/api/tasks/{self.task.id}/comments/", TaskComment),
        ):
            with self.subTest(path=path):
                response = self.client.post(path, {"text": content}, format="json")
                self.assertEqual(response.status_code, 201, response.data)
                stored = model.objects.get(pk=response.data["id"])
                self.assertEqual(stored.text, content)
                self.assertEqual(response.data["text"], content)

    def test_catbot_posts_code_once_without_changing_it(self):
        provider = AIProvider.objects.create(name="Markdown test", code="markdown-test", base_url="http://127.0.0.1:1")
        session = ChatSession.objects.create(user=self.user, client_tab_id="markdown-test")
        snapshot = ChatContextSnapshot.objects.create(user=self.user, session=session)
        run = ChatRun.objects.create(user=self.user, session=session, snapshot=snapshot, provider=provider,
                                     request_id="markdown-test", client_tab_id="markdown-test", prompt="test")
        content = '```python\nif a < b and c > d:\n    print("ok")\n```\n<script>literal</script>'
        for target_type, target, model in (("case_comment", self.case, Comment),
                                          ("alert_comment", self.alert, AlertComment),
                                          ("hunt_note", self.hunt, HuntJournalEntry)):
            with self.subTest(target_type=target_type):
                draft = ChatGeneratedDraft.objects.create(run=run, target_type=target_type, target_id=str(target.id), content=content)
                post_generated_draft(user=self.user, draft=draft)
                draft.refresh_from_db()
                post_generated_draft(user=self.user, draft=draft)
                self.assertTrue(draft.is_posted)
                self.assertEqual(model.objects.count(), 1)
                self.assertEqual(model.objects.get().text, content)
