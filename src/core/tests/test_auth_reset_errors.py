from django.contrib.auth import get_user_model
from django.contrib.auth.tokens import default_token_generator
from django.core.cache import cache
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from knox.models import AuthToken
from rest_framework.test import APITestCase


class ResetLinkErrorTests(APITestCase):
    def setUp(self):
        cache.clear()
        self.user = get_user_model().objects.create_user(username="reset-user", password="Original-Password-8472!")
        self.url = "/api/auth/password-reset/confirm/"

    def payload(self, uid=None, token="invalid"):
        return {"uid": urlsafe_base64_encode(force_bytes(uid or self.user.pk)), "token": token, "new_password": "Replacement-Password-8472!"}

    def test_invalid_user_token_and_inactive_user_have_identical_errors(self):
        missing = self.client.post(self.url, self.payload(self.user.pk + 1000), format="json")
        invalid = self.client.post(self.url, self.payload(), format="json")
        self.user.is_active = False
        self.user.save()
        inactive = self.client.post(self.url, self.payload(token=default_token_generator.make_token(self.user)), format="json")
        self.assertEqual([missing.status_code, invalid.status_code, inactive.status_code], [400, 400, 400])
        self.assertEqual(missing.data, invalid.data)
        self.assertEqual(missing.data, inactive.data)

    def test_valid_reset_revokes_tokens_and_cannot_be_reused(self):
        AuthToken.objects.create(user=self.user)
        payload = self.payload(token=default_token_generator.make_token(self.user))
        self.assertEqual(self.client.post(self.url, payload, format="json").status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(payload["new_password"]))
        self.assertFalse(AuthToken.objects.filter(user=self.user).exists())
        self.assertEqual(self.client.post(self.url, payload, format="json").status_code, 400)
