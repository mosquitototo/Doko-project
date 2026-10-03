from django.contrib.auth import get_user_model
from django.core.cache import cache
from rest_framework.test import APITestCase


class AuthenticationInputTests(APITestCase):
    def test_invalid_json_shapes_return_validation_errors(self):
        for endpoint, payloads in (
            ("login", [[], ["x"], "text", 1, None, {"username": ["x"], "password": "x"}, {"username": 10**400, "password": "x"}, {"username": "x", "password": {"x": "y"}}]),
            ("password-reset/confirm", [[], "text", None, {"uid": ["x"], "token": "x", "new_password": "x"}, {"uid": "MQ", "token": 5, "new_password": "x"}, {"uid": "MQ", "token": "x", "new_password": ["x"]}]),
        ):
            for payload in payloads:
                with self.subTest(endpoint=endpoint, payload_type=type(payload).__name__):
                    cache.clear()
                    response = self.client.post(f"/api/auth/{endpoint}/", payload, format="json")
                    self.assertEqual(response.status_code, 400)

    def test_valid_login_preserves_password_whitespace_and_session(self):
        cache.clear()
        password = "  Valid-Password-8472!  "
        get_user_model().objects.create_user(username="valid-login", password=password)
        response = self.client.post("/api/auth/login/", {"username": "valid-login", "password": password}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/me/").status_code, 200)
