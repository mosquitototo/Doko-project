from unittest.mock import patch
from django.core.cache import caches
from django.test import SimpleTestCase, RequestFactory, override_settings
from django.http import HttpResponse
from rest_framework.test import APIRequestFactory
from rest_framework.request import Request
from rest_framework.parsers import JSONParser
from core.views_auth import AuthRateThrottle, PasswordResetRateThrottle


@override_settings(CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}, "security": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}})
class AuthThrottleTests(SimpleTestCase):
    def setUp(self):
        caches["default"].clear()
        caches["security"].clear()

    def request(self, username, forwarded="198.51.100.1"):
        raw = APIRequestFactory().post("/api/auth/login/", {"username": username, "password": "wrong"}, format="json", HTTP_X_FORWARDED_FOR=forwarded, REMOTE_ADDR="10.0.0.2")
        return Request(raw, parsers=[JSONParser()])

    def test_forwarded_header_rotation_does_not_reset_login_budget(self):
        decisions = [AuthRateThrottle().allow_request(self.request("same-user", f"198.51.100.{i}"), None) for i in range(12)]
        self.assertFalse(decisions[-1])

    def test_users_behind_one_proxy_have_separate_account_budgets(self):
        decisions = [AuthRateThrottle().allow_request(self.request(f"person-{i}"), None) for i in range(20)]
        self.assertTrue(all(decisions))

    def test_trusted_proxy_chain_is_explicit_and_untrusted_headers_are_ignored(self):
        from core.auth_throttling import client_address
        request = self.request("user", "198.51.100.4, 10.0.0.3")
        with override_settings(DOKO_TRUSTED_PROXY_CIDRS=[]):
            self.assertEqual(client_address(request), "10.0.0.2")
        with override_settings(DOKO_TRUSTED_PROXY_CIDRS=["10.0.0.0/24"]):
            self.assertEqual(client_address(request), "198.51.100.4")

    def test_admin_login_shares_api_account_budget_and_recovers(self):
        from core.auth_throttling import AdminLoginThrottleMiddleware
        middleware = AdminLoginThrottleMiddleware(lambda request: HttpResponse("ok"))
        with patch("core.auth_throttling.time.time", return_value=120):
            for _ in range(10):
                self.assertTrue(AuthRateThrottle().allow_request(self.request("admin"), None))
            request = RequestFactory().post("/admin/login/", {"username": "admin", "password": "wrong"})
            self.assertEqual(middleware(request).status_code, 429)
        with patch("core.auth_throttling.time.time", return_value=181):
            self.assertEqual(middleware(request).status_code, 200)

    def test_reset_header_rotation_does_not_reset_budget(self):
        decisions = []
        for i in range(7):
            raw = APIRequestFactory().post("/", {"uid": "MQ", "token": "invalid", "new_password": "x"}, format="json", HTTP_X_FORWARDED_FOR=f"198.51.100.{i}")
            decisions.append(PasswordResetRateThrottle().allow_request(Request(raw, parsers=[JSONParser()]), None))
        self.assertFalse(decisions[-1])
