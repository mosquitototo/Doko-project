from datetime import date
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from core.models import Event, TimelineItem, Comment, Attachment

User = get_user_model()


class TicketingAPITests(APITestCase):
    def setUp(self):
        self.user_a = User.objects.create_user(username="usera", password="pass12345")
        self.user_b = User.objects.create_user(username="userb", password="pass12345")

        # Token A
        res = self.client.post("/api/auth/token/", {"username": "usera", "password": "pass12345"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.token_a = res.data["token"]

        # Token B
        res = self.client.post("/api/auth/token/", {"username": "userb", "password": "pass12345"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.token_b = res.data["token"]

    def auth_a(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token_a}")

    def auth_b(self):
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {self.token_b}")

    def test_create_event_creates_timeline_item_with_actor(self):
        self.auth_a()

        res = self.client.post(
            "/api/events/",
            {"title": "Ticket 1", "description": "Desc", "status": "open"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        event_id = res.data["id"]

        event = Event.objects.get(id=event_id)
        self.assertEqual(event.owner, self.user_a)

        tqs = TimelineItem.objects.filter(event=event, type="event_created")
        self.assertTrue(tqs.exists())
        t = tqs.latest("created_at")
        self.assertEqual(t.actor, self.user_a)

    def test_owner_only_access(self):
        self.auth_a()
        res = self.client.post("/api/events/", {"title": "Secret", "description": "", "status": "open"}, format="json")
        self.assertEqual(res.status_code, 201)
        event_id = res.data["id"]

        self.auth_b()
        res = self.client.get(f"/api/events/{event_id}/")
        self.assertIn(res.status_code, [403, 404])

    def test_status_change_logs_timeline(self):
        self.auth_a()
        res = self.client.post("/api/events/", {"title": "T", "description": "", "status": "open"}, format="json")
        event_id = res.data["id"]

        res = self.client.patch(f"/api/events/{event_id}/", {"status": "in_progress"}, format="json")
        self.assertEqual(res.status_code, 200)

        event = Event.objects.get(id=event_id)
        self.assertEqual(event.status, "in_progress")

        log = TimelineItem.objects.filter(event=event, type="status_changed").latest("created_at")
        self.assertEqual(log.actor, self.user_a)
        self.assertIn("open", log.text)
        self.assertIn("in_progress", log.text)

    def test_comment_add_creates_timeline(self):
        self.auth_a()
        res = self.client.post("/api/events/", {"title": "T", "description": "", "status": "open"}, format="json")
        event_id = res.data["id"]

        res = self.client.post(
            f"/api/events/{event_id}/comments/",
            {"text": "Hello"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        comment_id = res.data["id"]

        comment = Comment.objects.get(id=comment_id)
        self.assertEqual(comment.author, self.user_a)

        event = Event.objects.get(id=event_id)
        log = TimelineItem.objects.filter(event=event, type="comment_added").latest("created_at")
        self.assertEqual(log.actor, self.user_a)

    def test_attachment_add_and_delete_creates_timeline(self):
        self.auth_a()
        res = self.client.post("/api/events/", {"title": "T", "description": "", "status": "open"}, format="json")
        event_id = res.data["id"]

        uploaded = SimpleUploadedFile("test.txt", b"hello", content_type="text/plain")
        res = self.client.post(
            f"/api/events/{event_id}/attachments/",
            {"file": uploaded},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201)
        attach_id = res.data["id"]

        event = Event.objects.get(id=event_id)
        log_add = TimelineItem.objects.filter(event=event, type="attachment_added").latest("created_at")
        self.assertEqual(log_add.actor, self.user_a)

        res = self.client.delete(f"/api/attachments/{attach_id}/")
        self.assertIn(res.status_code, [204, 200])

        log_del = TimelineItem.objects.filter(event=event, type="attachment_deleted").latest("created_at")
        self.assertEqual(log_del.actor, self.user_a)
