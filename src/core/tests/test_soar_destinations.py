from types import SimpleNamespace
from unittest.mock import Mock, patch
from django.core.exceptions import ValidationError
from django.test import SimpleTestCase
from core.services_soar import SOARService


class SoarDestinationTests(SimpleTestCase):
    def setUp(self):
        self.service = SOARService(SimpleNamespace(base_url="http://soar.internal:8080", auth_type="none", auth_config={}, timeout_seconds=30, verify_ssl=False))
        self.context = {"secret": {}, "prompt": "", "variables": {}, "provider_execution": {}}
        proxy = patch("core.services_soar.build_outbound_proxies", return_value={})
        proxy.start()
        self.addCleanup(proxy.stop)
        self.response = Mock()
        self.response.iter_content.return_value = [b'{}']

    def call(self, template):
        response = Mock()
        response.iter_content.return_value = [b'{"result":"ok"}']
        with patch("core.services_soar.requests.request", return_value=response) as request, patch("core.services_soar.build_outbound_proxies", return_value={}):
            result = self.service._perform_request({"url_template": template}, self.context)
            return request.call_args.kwargs, result

    def test_fixed_internal_and_multihost_templates_remain_supported(self):
        for template, expected in (("{base_url}/rest/playbook_run/42", "http://soar.internal:8080/rest/playbook_run/42"), ("https://results.internal:9443/result", "https://results.internal:9443/result")):
            kwargs, result = self.call(template)
            self.assertEqual(kwargs["url"], expected)
            self.assertFalse(kwargs["allow_redirects"])
            self.assertFalse(kwargs["verify"])
            self.assertEqual(result["response"], {"result": "ok"})

    def test_dynamic_result_url_can_only_use_provider_origin(self):
        self.context["provider_execution"]["url"] = "http://soar.internal:8080/result/42"
        kwargs, _ = self.call("{provider_execution.url}")
        self.assertEqual(kwargs["url"], self.context["provider_execution"]["url"])
        self.context["provider_execution"]["url"] = "http://different.internal/result"
        with patch("core.services_soar.requests.request", return_value=self.response) as request:
            with self.assertRaises(ValidationError):
                self.service._perform_request({"url_template": "{provider_execution.url}"}, self.context)
            request.assert_not_called()

    def test_values_cannot_change_url_authority(self):
        self.context["variables"]["host"] = "other.internal"
        for template in ("http://{variables.host}/", "http://soar.internal:8080@{variables.host}/", "file:///etc/hosts"):
            with self.subTest(template=template), patch("core.services_soar.requests.request", return_value=self.response) as request:
                with self.assertRaises(ValidationError):
                    self.service._perform_request({"url_template": template}, self.context)
                request.assert_not_called()

    def test_dynamic_multihost_results_require_an_explicit_configured_origin(self):
        self.service.provider.request_config = {"allowed_origins": ["https://results.internal:9443"]}
        self.context["provider_execution"]["url"] = "https://results.internal:9443/result/42"
        kwargs, _ = self.call("{provider_execution.url}")
        self.assertEqual(kwargs["url"], self.context["provider_execution"]["url"])
