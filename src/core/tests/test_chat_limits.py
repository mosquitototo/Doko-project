import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.utils import timezone
from django.db import connections
from django.conf import settings
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient, APITestCase

from core.models import AIProvider, ChatRun, ChatSession, SOARProvider, InvestigationTemplate
from core import chat_limits


class IsolatedRateCounter:
    def isolate_rate_counter(self):
        prefix = "doko-test-chat-" + uuid.uuid4().hex + ":"
        key_patch = patch("core.chat_limits.RATE_KEY_PREFIX", prefix)
        key_patch.start()
        self.addCleanup(key_patch.stop)
        self.rate_client = chat_limits._rate_client(settings.CELERY_BROKER_URL)
        def cleanup():
            keys = list(self.rate_client.scan_iter(match=prefix + "*"))
            if keys:
                self.rate_client.delete(*keys)
        self.addCleanup(cleanup)


class InteractiveChatLimitTests(IsolatedRateCounter, APITestCase):
    def setUp(self):
        self.isolate_rate_counter()
        self.user = get_user_model().objects.create_user(username="chat-limit", is_staff=True)
        self.client.force_authenticate(self.user)
        AIProvider.objects.create(name="Local test", code="local", base_url="http://llm.test", is_enabled=True, is_default=True)
        self.task = patch("core.views_chat.execute_chat_run_task.delay")
        self.task.start().return_value.id = "test-task"
        self.addCleanup(self.task.stop)

    def submit(self, message="Analyse", session=None, request_id="first", **extra):
        session = session or ChatSession.objects.create(user=self.user, client_tab_id="tab")
        return self.client.post(f"/api/chat/sessions/{session.id}/runs", {
            "client_tab_id": "tab", "request_id": request_id, "message": message, "page_type": "global", **extra
        }, format="json")

    def test_waiting_prompts_remain_queued_instead_of_being_dropped(self):
        for _ in range(6):
            self.assertEqual(self.submit().status_code, 201)
        self.assertEqual(ChatRun.objects.filter(status="queued").count(), 6)

    def test_twenty_per_minute_includes_finished_runs_and_recovers(self):
        for _ in range(20):
            self.assertEqual(self.submit().status_code, 201)
            ChatRun.objects.update(status="completed")
        response = self.submit()
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)
        key = f"{chat_limits.RATE_KEY_PREFIX}{self.user.pk}"
        entries = self.rate_client.zrange(key, 0, -1)
        self.rate_client.zadd(key, {entry: timezone.now().timestamp() - 61 for entry in entries})
        self.assertEqual(self.submit().status_code, 201)

    def test_commands_and_other_users_are_not_blocked_by_prompt_quota(self):
        soar = SOARProvider.objects.create(name="SOAR", code="soar", base_url="http://soar.test", is_enabled=True)
        InvestigationTemplate.objects.create(name="Command", code="activity", chat_command="/user_activity", soar_provider=soar, is_enabled=True)
        for _ in range(20):
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

    def test_clear_does_not_reset_prompt_budget(self):
        for _ in range(20):
            session = ChatSession.objects.create(user=self.user, client_tab_id="tab")
            self.assertEqual(self.submit(session=session).status_code, 201)
            ChatRun.objects.update(status="completed")
            response = self.client.post(f"/api/chat/sessions/{session.id}/clear", {}, format="json")
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.submit().status_code, 429)

    def test_non_command_slash_text_and_unknown_commands_are_not_exempt(self):
        for _ in range(20):
            self.assertEqual(self.submit().status_code, 201)
            ChatRun.objects.update(status="completed")
        self.assertEqual(self.submit("/ Explain the alert").status_code, 429)
        self.assertEqual(self.submit("/unknown_command").status_code, 429)
        self.assertEqual(self.submit(template_code="unknown-template").status_code, 429)
        self.assertEqual(self.submit(chat_command="/unknown-command").status_code, 429)

    def test_worker_waits_for_a_free_slot_and_releases_it_on_failure(self):
        from celery.exceptions import Retry
        from core.celerytasks import execute_chat_run_task
        response = self.submit()
        self.assertEqual(response.status_code, 201)
        run_id = response.data["id"]
        with ExitStack() as stack:
            for _ in range(4):
                self.assertTrue(stack.enter_context(chat_limits.interactive_generation_slot(self.user.pk)))
            with patch("core.celerytasks.execute_chat_run") as execute:
                with self.assertRaises(Retry):
                    execute_chat_run_task.run(run_id)
                execute.assert_not_called()
        with patch("core.celerytasks.execute_chat_run", side_effect=RuntimeError("generation failed")):
            with self.assertRaisesRegex(RuntimeError, "generation failed"):
                execute_chat_run_task.run(run_id)
        with ExitStack() as stack:
            self.assertTrue(all(stack.enter_context(chat_limits.interactive_generation_slot(self.user.pk)) for _ in range(4)))

    @override_settings(DOKO_CHAT_MAX_CONCURRENT=1)
    def test_clear_during_generation_does_not_release_the_running_slot(self):
        from core.celerytasks import execute_chat_run_task
        session = ChatSession.objects.create(user=self.user, client_tab_id="tab")
        response = self.submit(session=session)
        def execute(run):
            cleared = self.client.post(f"/api/chat/sessions/{session.id}/clear", {}, format="json")
            self.assertEqual(cleared.status_code, 200)
            self.assertFalse(ChatRun.objects.filter(pk=run.pk).exists())
            with chat_limits.interactive_generation_slot(self.user.pk) as acquired:
                self.assertFalse(acquired)
        with patch("core.celerytasks.execute_chat_run", side_effect=execute):
            execute_chat_run_task.run(response.data["id"])
        with chat_limits.interactive_generation_slot(self.user.pk) as acquired:
            self.assertTrue(acquired)

    def test_counter_outage_returns_503_without_creating_a_run(self):
        from redis import RedisError
        with patch("core.chat_limits._rate_client", side_effect=RedisError("not available")):
            self.assertEqual(self.submit().status_code, 503)
        self.assertFalse(ChatRun.objects.exists())


class ConcurrentChatLimitTests(IsolatedRateCounter, TransactionTestCase):
    def setUp(self):
        self.isolate_rate_counter()

    @override_settings(DOKO_CHAT_PROMPTS_PER_MINUTE=4)
    def test_parallel_requests_cannot_exceed_rate_budget(self):
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

    def test_four_worker_slots_release_on_success_or_exception(self):
        barrier = Barrier(6)
        def reserve(unused):
            try:
                with chat_limits.interactive_generation_slot(1234) as acquired:
                    barrier.wait(timeout=10)
                    return acquired
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=6) as pool:
            self.assertEqual(sum(pool.map(reserve, range(6))), 4)
        with self.assertRaisesRegex(RuntimeError, "worker error"):
            with chat_limits.interactive_generation_slot(1234) as acquired:
                self.assertTrue(acquired)
                raise RuntimeError("worker error")
        with chat_limits.interactive_generation_slot(1234) as acquired:
            self.assertTrue(acquired)

    @override_settings(DOKO_CHAT_MAX_CONCURRENT=1)
    def test_lost_worker_connection_releases_slot_without_run_cleanup(self):
        from django.db import connection
        import psycopg
        real_connect = psycopg.connect
        opened = []
        def connect(**kwargs):
            conn = real_connect(**kwargs)
            opened.append(conn)
            return conn
        with patch("core.chat_limits.psycopg.connect", side_effect=connect):
            with chat_limits.interactive_generation_slot(1234) as acquired:
                self.assertTrue(acquired)
                pid = opened[0].execute("SELECT pg_backend_pid()").fetchone()[0]
                with chat_limits.interactive_generation_slot(1234) as second:
                    self.assertFalse(second)
                with connection.cursor() as cursor:
                    cursor.execute("SELECT pg_terminate_backend(%s, 5000)", [pid])
                    self.assertTrue(cursor.fetchone()[0])
                with chat_limits.interactive_generation_slot(1234) as recovered:
                    self.assertTrue(recovered)
