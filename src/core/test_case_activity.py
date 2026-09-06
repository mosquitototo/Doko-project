from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from core.models import Case, CaseExchange, CaseUserState, Comment, Customer


class CaseActivityTests(APITestCase):
    def setUp(self):
        self.users = [get_user_model().objects.create_user(username=f"reader-{i}", is_staff=True) for i in range(3)]
        self.customer = Customer.objects.create(name="Activity test")
        self.case = Case.objects.create(title="Activity test", customer=self.customer)

    def unread(self, user):
        self.client.force_authenticate(user)
        response = self.client.get("/api/cases/")
        self.assertEqual(response.status_code, 200)
        return next(row for row in response.data["results"] if str(row["id"]) == str(self.case.id))["has_recent_activity"]

    def mark(self, user, through=None):
        self.client.force_authenticate(user)
        return self.client.post(f"/api/cases/{self.case.id}/mark-viewed/", {"viewed_through": through} if through else {}, format="json")

    def test_own_comment_is_excluded_without_hiding_other_authors(self):
        self.assertFalse(self.unread(self.users[0]))
        Comment.objects.create(case=self.case, author=self.users[0], text="First")
        self.assertFalse(self.unread(self.users[0]))
        self.assertTrue(self.unread(self.users[1]))
        Comment.objects.create(case=self.case, author=self.users[1], text="Second")
        self.assertTrue(self.unread(self.users[1]))
        self.assertTrue(self.unread(self.users[0]))

    def test_reading_only_changes_the_current_users_state(self):
        Comment.objects.create(case=self.case, author=self.users[0], text="Unread")
        self.assertTrue(self.unread(self.users[1]))
        self.assertTrue(self.unread(self.users[2]))
        self.assertEqual(self.mark(self.users[1]).status_code, 200)
        self.assertFalse(self.unread(self.users[1]))
        self.assertTrue(self.unread(self.users[2]))
        self.assertEqual(CaseUserState.objects.count(), 1)

    def test_unread_activity_does_not_expire(self):
        comment = Comment.objects.create(case=self.case, author=self.users[0], text="Old unread")
        Comment.objects.filter(pk=comment.pk).update(created_at=timezone.now() - timezone.timedelta(days=10))
        self.assertTrue(self.unread(self.users[1]))

    def test_existing_event_types_remain_unchanged(self):
        for direction, raw, expected in (("outbound", {}, False), ("inbound", {}, True),
                                         ("outbound", {"kind": "auto_followup"}, True)):
            with self.subTest(direction=direction, raw=raw):
                exchange = CaseExchange.objects.create(case=self.case, direction=direction, raw=raw)
                self.assertEqual(self.unread(self.users[1]), expected)
                exchange.delete()
        self.case.title = "Changed title"
        self.case.save()
        self.assertFalse(self.unread(self.users[1]))
        Comment.objects.create(case=self.case, author=None, author_label="Catbot", text="Generated")
        self.assertTrue(self.unread(self.users[1]))

    def test_loading_cursor_does_not_clear_later_activity_or_move_backwards(self):
        self.client.force_authenticate(self.users[1])
        detail = self.client.get(f"/api/cases/{self.case.id}/")
        self.assertIn("activity_read_at", detail.data)
        cursor = detail.data["activity_read_at"]
        Comment.objects.create(case=self.case, author=self.users[0], text="Arrived during load")
        self.assertEqual(self.mark(self.users[1], cursor).status_code, 200)
        self.assertTrue(self.unread(self.users[1]))
        self.assertEqual(self.mark(self.users[1]).status_code, 200)
        self.assertFalse(self.unread(self.users[1]))
        self.mark(self.users[1], cursor)
        self.assertFalse(self.unread(self.users[1]))

    def test_invalid_cursor_does_not_mark_as_read(self):
        for cursor in ("invalid", "2099-01-01T00:00:00Z", "2026-01-01"):
            self.assertEqual(self.mark(self.users[1], cursor).status_code, 400)
        self.assertFalse(CaseUserState.objects.exists())

    def test_unauthorized_reader_cannot_mark_a_case(self):
        user = get_user_model().objects.create_user(username="no-access")
        self.assertIn(self.mark(user).status_code, (403, 404))
        self.assertFalse(CaseUserState.objects.exists())
