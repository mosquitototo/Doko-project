from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db import connections
from django.test import TransactionTestCase
from rest_framework.test import APIClient, APITestCase

from core.models import AIProvider, ChatRun, ChatSession


class InteractiveChatLimitTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="chat-limit", is_staff=True)
        self.client.force_authenticate(self.user)
        AIProvider.objects.create(name="Local test", code="local", base_url="http://llm.test", is_enabled=True, is_default=True)
        self.task = patch("core.views_chat.execute_chat_run_task.delay")
        self.task.start().return_value.id = "test-task"
        self.addCleanup(self.task.stop)

    def submit(self, message="Analyse", session=None, request_id="first"):
        session = session or ChatSession.objects.create(user=self.user, client_tab_id="tab")
        return self.client.post(f"/api/chat/sessions/{session.id}/runs", {
            "client_tab_id": "tab", "request_id": request_id, "message": message, "page_type": "global"
        }, format="json")

    def test_four_active_generations_across_sessions_then_release(self):
        for _ in range(4):
            self.assertEqual(self.submit().status_code, 201)
        self.assertEqual(self.submit().status_code, 429)
        for state in ("completed", "failed", "cancelled"):
            run = ChatRun.objects.filter(status="queued").first()
            run.status = state
            run.save()
            self.assertEqual(self.submit().status_code, 201)

    def test_twenty_per_minute_includes_finished_runs_and_recovers(self):
        for _ in range(20):
            self.assertEqual(self.submit().status_code, 201)
            ChatRun.objects.update(status="completed")
        response = self.submit()
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)
        ChatRun.objects.update(created_at=timezone.now() - timedelta(seconds=61))
        self.assertEqual(self.submit().status_code, 201)

    def test_commands_and_other_users_are_not_blocked_by_prompt_quota(self):
        for _ in range(4):
            self.assertEqual(self.submit().status_code, 201)
        self.assertEqual(self.submit("/user_activity toto").status_code, 201)
        self.user = get_user_model().objects.create_user(username="other-chat", is_staff=True)
        self.client.force_authenticate(self.user)
        self.assertEqual(self.submit().status_code, 201)

    def test_duplicate_request_is_not_charged_again(self):
        session = ChatSession.objects.create(user=self.user, client_tab_id="tab")
        first = self.submit(session=session)
        self.assertEqual(first.status_code, 201)
        for _ in range(3):
            self.assertEqual(self.submit().status_code, 201)
        repeated = self.submit(session=session)
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(first.data["id"], repeated.data["id"])


class ConcurrentChatLimitTests(TransactionTestCase):
    def test_parallel_requests_cannot_exceed_four_slots(self):
        user = get_user_model().objects.create_user(username="parallel-chat", is_staff=True)
        AIProvider.objects.create(name="Local parallel test", code="parallel", base_url="http://llm.test", is_enabled=True, is_default=True)
        sessions = [ChatSession.objects.create(user=user, client_tab_id=str(i)) for i in range(6)]
        barrier = Barrier(6)
        def submit(session):
            try:
                client = APIClient()
                client.force_authenticate(user)
                barrier.wait(timeout=10)
                return client.post(f"/api/chat/sessions/{session.id}/runs", {
                    "client_tab_id": session.client_tab_id, "request_id": "one", "message": "Analyse", "page_type": "global"
                }, format="json").status_code
            finally:
                connections.close_all()
        with patch("core.views_chat.execute_chat_run_task.delay") as delay:
            delay.return_value.id = "parallel-task"
            with ThreadPoolExecutor(max_workers=6) as pool:
                statuses = list(pool.map(submit, sessions))
        self.assertEqual(sorted(statuses), [201, 201, 201, 201, 429, 429])
        self.assertEqual(ChatRun.objects.count(), 4)
