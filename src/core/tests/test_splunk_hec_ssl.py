from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from core.models import InstanceSplunkHecSettings
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
    @patch("core.services_splunk_hec.requests.post", return_value=Mock(status_code=200))
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
