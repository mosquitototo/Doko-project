from django.test import SimpleTestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase
from core.models import (
    AIProvider, Alert, AlertComment, Case, Comment, Hunt, HuntJournalEntry,
    Task, TaskComment, Customer, ChatSession, ChatContextSnapshot, ChatRun, ChatGeneratedDraft,
)
from core.reports_engine import render_report_html
from core.services_chat_posting import post_generated_draft

from core.serializers import (
    AlertCommentSerializer,
    CommentSerializer,
    HuntJournalEntrySerializer,
    TaskCommentSerializer,
    CaseExchangeCreateSerializer,
    AlertSerializer,
    CaseSerializer,
    HuntListSerializer,
    HuntDetailSerializer,
    TaskDetailSerializer,
)


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

    def test_exchange_keeps_its_html_sanitization(self):
        serializer = CaseExchangeCreateSerializer()
        result = serializer.validate_body('<p>Message</p><script>alert(1)</script>')
        self.assertIn("<p>Message</p>", result)
        self.assertNotIn("<script>", result)


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
