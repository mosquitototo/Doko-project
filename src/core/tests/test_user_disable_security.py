from datetime import timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from knox.models import AuthToken
from rest_framework.test import APIClient, APITestCase

from core.models import Permission, Role, UserRole


class UserDisableSecurityTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username="security-admin", is_staff=True)
        self.target = User.objects.create_user(username="security-target")
        self.manager = User.objects.create_user(username="security-manager")
        self.role = Role.objects.create(name="Security user manager")
        for code in ("settings.access.users.manage", "settings.access.users.delete", "settings.access.roles.manage"):
            permission, _ = Permission.objects.get_or_create(code=code)
            self.role.permissions.add(permission)
        UserRole.objects.create(user=self.manager, role=self.role)
        self.client.force_authenticate(self.admin)

    def test_disable_deletes_all_target_tokens_and_reactivation_does_not_restore_them(self):
        first, raw = AuthToken.objects.create(user=self.target)
        AuthToken.objects.create(user=self.target, expiry=None)
        other, _ = AuthToken.objects.create(user=self.admin)
        authenticated = APIClient()
        authenticated.credentials(HTTP_AUTHORIZATION=f"Token {raw}")
        self.assertEqual(authenticated.get("/api/me/").status_code, 200)
        response = self.client.patch(f"/api/settings/users/{self.target.pk}/", {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(AuthToken.objects.filter(user=self.target).exists())
        self.assertTrue(AuthToken.objects.filter(pk=other.pk).exists())
        self.assertIn(authenticated.get("/api/me/").status_code, (401, 403))
        response = self.client.patch(f"/api/settings/users/{self.target.pk}/", {"is_active": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIn(authenticated.get("/api/me/").status_code, (401, 403))
        self.assertFalse(AuthToken.objects.filter(pk=first.pk).exists())

    def test_expired_tokens_are_rejected_for_enabled_users_but_valid_tokens_work(self):
        authenticated = APIClient()
        for expiry, accepted in ((timezone.now() - timedelta(seconds=1), False), (timezone.now() + timedelta(hours=1), True), (None, True)):
            token, raw = AuthToken.objects.create(user=self.target, expiry=None)
            token.expiry = expiry
            token.save(update_fields=["expiry"])
            authenticated.credentials(HTTP_AUTHORIZATION=f"Token {raw}")
            response = authenticated.get("/api/me/")
            self.assertEqual(response.status_code == 200, accepted)
            if not accepted:
                self.assertIn(response.status_code, (401, 403))
                self.assertFalse(AuthToken.objects.filter(pk=token.pk).exists())

    def test_only_an_admin_can_reactivate_a_disabled_administrator(self):
        disabled = get_user_model().objects.create_user(username="disabled-administrator", is_staff=True, is_active=False)
        self.client.force_authenticate(self.manager)
        url = f"/api/settings/users/{disabled.pk}/"
        self.assertEqual(self.client.patch(url, {"is_active": True}, format="json").status_code, 403)
        permission, _ = Permission.objects.get_or_create(code="settings.instance.manage")
        self.role.permissions.add(permission)
        self.assertEqual(self.client.patch(url, {"is_active": True}, format="json").status_code, 403)
        disabled.refresh_from_db()
        self.assertFalse(disabled.is_active)
        self.client.force_authenticate(self.admin)
        detail = self.client.get(url)
        self.assertTrue(detail.data["is_admin"])
        response = self.client.patch(url, {"is_active": True}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        disabled.refresh_from_db()
        self.assertTrue(disabled.is_active)
        self.assertTrue(disabled.is_staff)

    def test_user_manager_cannot_prepare_takeover_of_disabled_admin(self):
        disabled = get_user_model().objects.create_user(username="protected-disabled-admin", is_staff=True, is_active=False)
        original_password = disabled.password
        self.client.force_authenticate(self.manager)
        response = self.client.post(f"/api/settings/users/{disabled.pk}/reset-password/", {"password": "NewStrongPass-8472!"}, format="json")
        self.assertEqual(response.status_code, 403)
        response = self.client.post(f"/api/settings/users/{disabled.pk}/delete/", {}, format="json")
        self.assertEqual(response.status_code, 403)
        disabled.refresh_from_db()
        self.assertEqual(disabled.password, original_password)

    def test_cannot_issue_token_for_disabled_account(self):
        self.target.is_active = False
        self.target.save(update_fields=["is_active"])
        response = self.client.post(f"/api/settings/users/{self.target.pk}/api-tokens/", {}, format="json")
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(AuthToken.objects.filter(user=self.target).exists())

    def test_stale_authenticated_request_cannot_issue_token_after_disable(self):
        get_user_model().objects.filter(pk=self.target.pk).update(is_active=False)
        self.client.force_authenticate(self.target)
        response = self.client.post("/api/auth/api-tokens/", {}, format="json")
        self.assertIn(response.status_code, (400, 401, 403))
        self.assertFalse(AuthToken.objects.filter(user=self.target).exists())

    def test_invalid_disable_request_preserves_account_and_tokens(self):
        token, _ = AuthToken.objects.create(user=self.target)
        response = self.client.patch(f"/api/settings/users/{self.target.pk}/", {"is_active": False, "role_ids": [99999999]}, format="json")
        self.assertEqual(response.status_code, 400)
        self.target.refresh_from_db()
        self.assertTrue(self.target.is_active)
        self.assertTrue(AuthToken.objects.filter(pk=token.pk).exists())

    def test_active_user_edit_preserves_tokens(self):
        token, _ = AuthToken.objects.create(user=self.target)
        response = self.client.patch(f"/api/settings/users/{self.target.pk}/", {"email": "user@example.org"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(AuthToken.objects.filter(pk=token.pk).exists())

    def test_user_manager_can_still_disable_and_reactivate_regular_users(self):
        self.client.force_authenticate(self.manager)
        for enabled in (False, True):
            response = self.client.patch(f"/api/settings/users/{self.target.pk}/", {"is_active": enabled}, format="json")
            self.assertEqual(response.status_code, 200, response.data)
            self.target.refresh_from_db()
            self.assertEqual(self.target.is_active, enabled)

    def test_enabled_users_can_still_receive_and_create_tokens(self):
        response = self.client.post(f"/api/settings/users/{self.target.pk}/api-tokens/", {}, format="json")
        self.assertEqual(response.status_code, 201)
        raw = response.data["token"]
        authenticated = APIClient()
        authenticated.credentials(HTTP_AUTHORIZATION=f"Token {raw}")
        self.assertEqual(authenticated.get("/api/me/").status_code, 200)
        self.client.force_authenticate(self.target)
        response = self.client.post("/api/auth/api-tokens/", {"never_expire": True}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.data["expiry"])
        authenticated.credentials(HTTP_AUTHORIZATION=f"Token {response.data['token']}")
        self.assertEqual(authenticated.get("/api/me/").status_code, 200)
