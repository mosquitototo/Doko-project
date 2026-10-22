from types import SimpleNamespace
from unittest.mock import Mock, patch
import json
import os
import socket

import requests

from django.test import SimpleTestCase

from core.models import AuditLog, InstanceSplunkHecSettings, queue_audit_log_splunk_hec_export
from core.crypto_secrets import SecretEncryptionError
from core.services_splunk_hec import send_payload_to_splunk_hec, test_splunk_hec_connection
from core.views_settings import _normalize_splunk_hec_payload, InstanceSplunkHecTestView, InstanceSplunkHecSettingsView


class SplunkHecSslTests(SimpleTestCase):
    def test_verification_defaults_to_enabled_and_is_public(self):
        settings = InstanceSplunkHecSettings()
        self.assertTrue(settings.verify_ssl)
        self.assertTrue(settings.to_public_dict()["verify_ssl"])

    def test_payload_distinguishes_omitted_and_explicit_verification(self):
        self.assertIsNone(_normalize_splunk_hec_payload({})["verify_ssl"])
        for value in (True, False):
            self.assertIs(_normalize_splunk_hec_payload({"verify_ssl": value})["verify_ssl"], value)
            self.assertIs(_normalize_splunk_hec_payload({"splunk_hec": {"verify_ssl": value}})["verify_ssl"], value)

    @patch("core.services_splunk_hec.build_outbound_proxies", return_value=None)
    @patch("core.services_splunk_hec.requests.post", return_value=Mock(status_code=200, json=lambda: {"code": 0, "text": "Success"}))
    def test_export_and_connection_test_use_requested_verification(self, post, proxies):
        for scheme in ("http", "https"):
            for verify in (True, False):
                settings = InstanceSplunkHecSettings(enabled=True, endpoint=f"{scheme}://hec.test:8088/services/collector", verify_ssl=verify)
                settings.set_token("test-token")
                send_payload_to_splunk_hec(settings, {"event": "test"})
                self.assertIs(post.call_args.kwargs["verify"], verify)
                self.assertEqual(post.call_args.args[0], settings.endpoint)
                ok, _ = test_splunk_hec_connection({"endpoint": settings.endpoint, "token": "test-token", "verify_ssl": verify})
                self.assertTrue(ok)
                self.assertIs(post.call_args.kwargs["verify"], verify)
        ok, _ = test_splunk_hec_connection({"endpoint": "https://hec.test/services/collector", "token": "test-token"})
        self.assertTrue(ok)
        self.assertIs(post.call_args.kwargs["verify"], True)

    @patch("core.views_settings.test_splunk_hec_connection", return_value=(True, "Connection successful."))
    @patch("core.views_settings.InstanceSplunkHecSettings.get_solo")
    def test_test_endpoint_uses_saved_setting_when_omitted(self, get_solo, send):
        settings = InstanceSplunkHecSettings(verify_ssl=False)
        get_solo.return_value = settings
        InstanceSplunkHecTestView().post(SimpleNamespace(data={}))
        self.assertIs(send.call_args.args[0]["verify_ssl"], False)
        InstanceSplunkHecTestView().post(SimpleNamespace(data={"verify_ssl": True}))
        self.assertIs(send.call_args.args[0]["verify_ssl"], True)

    @patch("core.views_settings.audit_event")
    @patch("core.views_settings.InstanceSplunkHecSettings.get_solo")
    def test_save_updates_verification_and_preserves_it_when_omitted(self, get_solo, audit):
        settings = InstanceSplunkHecSettings()
        settings.save = Mock()
        get_solo.return_value = settings
        view = InstanceSplunkHecSettingsView()
        for payload, expected in [({"verify_ssl": False}, False), ({}, False), ({"verify_ssl": True}, True)]:
            response = view._save(SimpleNamespace(data=payload, user=None))
            self.assertIs(settings.verify_ssl, expected)
            self.assertIs(response.data["verify_ssl"], expected)
        self.assertEqual(settings.save.call_count, 3)


class SplunkHecResponseTests(SimpleTestCase):
    def response(self, body, status=200):
        response = requests.Response()
        response.status_code = status
        response._content = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        return response

    def run_test(self, response=None, error=None, endpoint="https://hec.test:8088/custom", verify=False):
        with patch("core.services_splunk_hec.build_outbound_proxies", return_value=None), patch(
            "core.services_splunk_hec.requests.post", return_value=response, side_effect=error
        ) as post:
            result = test_splunk_hec_connection({"endpoint": endpoint, "token": "test-secret", "verify_ssl": verify})
            return result, post.call_args

    def test_url_is_used_exactly_without_requiring_a_collector_path(self):
        for endpoint in ("https://hec.test:8088", "http://hec.test:8088", "https://hec.test/custom/path?route=1"):
            result, call = self.run_test(self.response({"text": "Success", "code": 0}), endpoint=endpoint)
            self.assertTrue(result[0], result[1])
            self.assertEqual(call.args[0], endpoint)
            self.assertIs(call.kwargs["verify"], False)
            self.assertEqual(call.kwargs["headers"]["Authorization"], "Splunk test-secret")

    def test_http_success_without_a_valid_hec_success_is_rejected(self):
        for body in ("<html>test-secret</html>", [], None, {}, {"code": False}, {"code": "0"}, {"code": 4, "text": "test-secret"}):
            with self.subTest(body=body):
                result, _ = self.run_test(self.response(body))
                self.assertFalse(result[0])
                self.assertNotIn("test-secret", result[1])

    def test_accepted_capacity_warning_does_not_trigger_a_resend(self):
        result, _ = self.run_test(self.response({"code": 24, "text": "HEC queue is approaching its capacity limit"}))
        self.assertTrue(result[0], result[1])
        result, _ = self.run_test(self.response({"code": 26}, 429))
        self.assertFalse(result[0])
        self.assertIn("capacity", result[1])

    def test_health_status_is_not_event_acceptance(self):
        result, _ = self.run_test(self.response({"code": 17, "text": "HEC is healthy"}))
        self.assertFalse(result[0])

    def test_hec_rejection_explains_code_without_echoing_response_secrets(self):
        result, _ = self.run_test(self.response({"code": 7, "text": "test-secret"}, 400))
        self.assertFalse(result[0])
        self.assertIn("index", result[1].lower())
        self.assertIn("400", result[1])
        self.assertNotIn("test-secret", result[1])
        result, _ = self.run_test(self.response("test-secret", 502))
        self.assertFalse(result[0])
        self.assertIn("502", result[1])
        self.assertNotIn("test-secret", result[1])

    def test_network_errors_are_distinct_without_echoing_exception_secrets(self):
        for error, expected in (
            (requests.exceptions.SSLError("test-secret"), "TLS"),
            (requests.exceptions.ProxyError("test-secret"), "proxy"),
            (requests.exceptions.ConnectTimeout("test-secret"), "Connection timeout"),
            (requests.exceptions.ReadTimeout("test-secret"), "Response timeout"),
            (requests.exceptions.ConnectionError(socket.gaierror(-2, "test-secret")), "DNS"),
            (requests.exceptions.ConnectionError("test-secret"), "connection"),
            (requests.exceptions.InvalidSchema("test-secret"), "URL"),
        ):
            with self.subTest(error=type(error).__name__):
                result, _ = self.run_test(error=error)
                self.assertFalse(result[0])
                self.assertIn(expected, result[1])
                self.assertNotIn("test-secret", result[1])

    def test_acknowledgment_requirement_is_explicit_and_never_reported_as_success(self):
        for body, status in (({"code": 10, "text": "Data channel is missing"}, 400), ({"code": 0, "ackId": 0}, 200), ({"code": 25}, 200)):
            result, _ = self.run_test(self.response(body, status))
            self.assertFalse(result[0])
            self.assertIn("acknowledgment", result[1])

    def test_environment_proxy_is_preserved_without_exposing_credentials(self):
        with patch.dict(os.environ, {"HTTPS_PROXY": "http://user:test-secret@proxy.test:3128", "NO_PROXY": ""}, clear=True), patch(
            "core.services_splunk_hec.build_outbound_proxies", return_value=None
        ), patch("requests.sessions.Session.send", return_value=self.response({"code": 0})) as send:
            settings = InstanceSplunkHecSettings(enabled=True, endpoint="https://hec.test:8088/custom")
            settings.get_token = lambda: "test-token"
            send_payload_to_splunk_hec(settings, {"event": "test"})
            self.assertEqual(send.call_args.kwargs["proxies"]["https"], "http://user:test-secret@proxy.test:3128")

    @patch("core.services_splunk_hec.InstanceSplunkHecSettings.set_token", side_effect=SecretEncryptionError("test-secret"))
    def test_invalid_encryption_configuration_is_reported_without_secrets(self, set_token):
        ok, detail = test_splunk_hec_connection({"endpoint": "https://hec.test", "token": "test-token"})
        self.assertFalse(ok)
        self.assertIn("encryption", detail)
        self.assertNotIn("test-secret", detail)

    @patch("core.views_settings.InstanceSplunkHecSettings.get_solo")
    def test_saved_token_decryption_error_returns_safe_diagnostic(self, get_solo):
        settings = InstanceSplunkHecSettings()
        settings.get_token = Mock(side_effect=SecretEncryptionError("test-secret"))
        get_solo.return_value = settings
        response = InstanceSplunkHecTestView().post(SimpleNamespace(data={"endpoint": "https://hec.test"}))
        self.assertEqual(response.status_code, 400)
        self.assertIn("decrypt", response.data["detail"])
        self.assertNotIn("test-secret", response.data["detail"])

    @patch("core.celerytasks.send_audit_log_to_splunk_hec_task.apply_async", side_effect=RuntimeError("test-secret"))
    @patch("core.models.InstanceSplunkHecSettings.objects.filter")
    @patch("core.models.transaction.on_commit", side_effect=lambda callback: callback())
    def test_queue_failure_is_logged_without_secrets(self, on_commit, settings_filter, publish):
        settings_filter.return_value.exists.return_value = True
        item = AuditLog(action="test")
        with self.assertLogs("core.models", level="WARNING") as logs:
            queue_audit_log_splunk_hec_export(AuditLog, item, True)
        self.assertIn(str(item.id), " ".join(logs.output))
        self.assertNotIn("test-secret", " ".join(logs.output))
