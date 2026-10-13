from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from core.models import AIProvider, ChatContextSnapshot, ChatMessage, ChatRun, ChatSession
from core.services_chat import _build_recent_conversation_history
from core.serializers_chat import ChatSessionSerializer


class PersonalConversationTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="conversation-owner", is_staff=True)
        self.other = get_user_model().objects.create_user(username="other-admin", is_staff=True)
        self.client.force_authenticate(self.user)
        self.session = ChatSession.objects.create(user=self.user, surface="dedicated", client_tab_id="tab", title="My conversation")
        self.contextual = ChatSession.objects.create(user=self.user, surface="contextual", client_tab_id="tab")
        self.provider = AIProvider.objects.create(name="Conversation provider", code="conversation", base_url="http://llm.test", is_default=True, is_enabled=True)

    def detail(self, session=None):
        return f"/api/chat/sessions/{(session or self.session).pk}"

    def make_run(self, state="completed"):
        snapshot = ChatContextSnapshot.objects.create(session=self.session, user=self.user)
        return ChatRun.objects.create(session=self.session, snapshot=snapshot, user=self.user, provider=self.provider, request_id=str(uuid4()), client_tab_id="tab", status=state)

    def test_dedicated_list_is_paginated_and_does_not_include_modal_or_other_users(self):
        for i in range(55):
            ChatSession.objects.create(user=self.user, surface="dedicated", client_tab_id="tab", title=str(i))
        ChatSession.objects.create(user=self.other, surface="dedicated", client_tab_id="tab", title="Private")
        first = self.client.get("/api/chat/sessions?surface=dedicated&offset=0")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(len(first.data["results"]), 50)
        self.assertEqual(first.data["next_offset"], 50)
        second = self.client.get("/api/chat/sessions?surface=dedicated&offset=50")
        self.assertEqual(len(second.data["results"]), 6)
        self.assertIsNone(second.data["next_offset"])
        self.assertTrue(all(x["surface"] == "dedicated" and x["title"] != "Private" for x in first.data["results"] + second.data["results"]))
        self.assertNotIn("messages", first.data["results"][0])
        self.assertIsInstance(self.client.get("/api/chat/sessions").data, list)

    def test_older_messages_remain_available(self):
        for i in range(105):
            ChatMessage.objects.create(session=self.session, role="user", content=f"Message {i}")
        first = self.client.get(self.detail())
        self.assertEqual(first.status_code, 200)
        self.assertEqual(len(first.data["messages"]), 100)
        older = self.client.get(self.detail(), {"before": first.data["older_cursor"]})
        self.assertEqual([x["content"] for x in older.data["messages"]], [f"Message {i}" for i in range(5)])
        self.assertIsNone(older.data["older_cursor"])
        self.assertEqual(ChatMessage.objects.filter(session=self.session).count(), 105)

    def test_other_admin_cannot_read_or_delete_conversation(self):
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(self.detail()).status_code, 404)
        self.assertEqual(self.client.delete(self.detail()).status_code, 404)
        self.assertTrue(ChatSession.objects.filter(pk=self.session.pk).exists())

    def test_logout_does_not_delete_conversations(self):
        ChatMessage.objects.create(session=self.session, role="user", content="Saved message")
        self.client.post("/api/auth/logout/")
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get(self.detail()).data["messages"][0]["content"], "Saved message")

    def test_rename_only_changes_own_dedicated_title(self):
        ChatMessage.objects.create(session=self.session, role="user", content="Keep this message")
        response = self.client.patch(self.detail(), {"title": "  New title  "}, format="json")
        self.assertEqual(response.status_code, 200)
        self.session.refresh_from_db()
        self.assertEqual(self.session.title, "New title")
        self.assertEqual(self.session.messages.get().content, "Keep this message")
        self.assertEqual(self.client.patch(self.detail(self.contextual), {"title": "No"}, format="json").status_code, 404)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.patch(self.detail(), {"title": "No"}, format="json").status_code, 404)

    def test_rename_rejects_invalid_titles(self):
        for title in ["", "   ", "x" * 256, None, ["Title"]]:
            self.assertEqual(self.client.patch(self.detail(), {"title": title}, format="json").status_code, 400)
        self.session.refresh_from_db()
        self.assertEqual(self.session.title, "My conversation")

    def test_first_prompt_preserves_custom_title(self):
        with patch("core.views_chat.execute_chat_run_task.delay") as task, patch("core.views_chat.reserve_prompt"):
            task.return_value.id = "test-task"
            response = self.client.post(f"{self.detail()}/runs", {"client_tab_id": "tab", "request_id": "custom-title", "message": "Question", "page_type": "global"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.session.refresh_from_db()
        self.assertEqual(self.session.title, "My conversation")

    def test_session_deleted_during_submission_returns_not_found(self):
        with patch("core.views_chat._create_limited_prompt_run", side_effect=ChatSession.DoesNotExist):
            response = self.client.post(f"{self.detail()}/runs", {"client_tab_id": "tab", "request_id": "deleted", "message": "Question"}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_delete_removes_records_without_creating_replacement_or_touching_modal(self):
        run = self.make_run()
        ChatMessage.objects.create(session=self.session, role="assistant", content="Answer")
        response = self.client.delete(self.detail())
        self.assertEqual(response.status_code, 204)
        self.assertFalse(ChatSession.objects.filter(pk=self.session.pk).exists())
        self.assertFalse(ChatRun.objects.filter(pk=run.pk).exists())
        self.assertFalse(ChatContextSnapshot.objects.filter(pk=run.snapshot_id).exists())
        self.assertFalse(ChatMessage.objects.exists())
        self.assertTrue(ChatSession.objects.filter(pk=self.contextual.pk).exists())
        self.assertEqual(self.client.delete(self.detail(self.contextual)).status_code, 404)

    def test_active_generation_prevents_deletion(self):
        self.make_run("running")
        self.assertEqual(self.client.delete(self.detail()).status_code, 409)
        self.assertTrue(ChatSession.objects.filter(pk=self.session.pk).exists())

    def test_response_finishing_during_detail_load_remains_recoverable(self):
        run = self.make_run("running")
        original = ChatSessionSerializer.get_active_run

        def finish_before_serializing(serializer, session):
            run.status = "completed"
            run.response_text = "Completed answer"
            run.save(update_fields=["status", "response_text"])
            ChatMessage.objects.create(session=session, role="assistant", content=run.response_text)
            return original(serializer, session)

        with patch.object(ChatSessionSerializer, "get_active_run", finish_before_serializing):
            response = self.client.get(self.detail())
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["active_run"] or any(message["content"] == "Completed answer" for message in response.data["messages"]))

    def test_history_only_uses_current_conversation_and_retains_twelve_message_limit(self):
        for i in range(15):
            ChatMessage.objects.create(session=self.session, role="user", content=str(i))
        ChatMessage.objects.create(session=self.contextual, role="user", content="Must not leak")
        history = _build_recent_conversation_history(self.make_run())
        self.assertEqual([x["content"] for x in history], [str(i) for i in range(3, 15)])

    def test_invalid_or_foreign_message_cursor_is_rejected(self):
        other_message = ChatMessage.objects.create(session=self.contextual, role="user", content="Other")
        self.assertEqual(self.client.get(self.detail(), {"before": "bad"}).status_code, 400)
        self.assertEqual(self.client.get(self.detail(), {"before": str(other_message.pk)}).status_code, 400)

    def test_first_prompt_names_dedicated_conversation_without_changing_modal(self):
        self.session.title = "New chat"
        self.session.save(update_fields=["title"])
        with patch("core.views_chat.execute_chat_run_task.delay") as task, patch("core.views_chat.reserve_prompt"):
            task.return_value.id = "test-task"
            response = self.client.post(f"{self.detail()}/runs", {"client_tab_id": "tab", "request_id": "first", "message": "A useful conversation title", "page_type": "global"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.session.refresh_from_db()
        self.assertEqual(self.session.title, "A useful conversation title")
