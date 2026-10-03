from types import SimpleNamespace
from django.test import SimpleTestCase
from core.services_soar import SOARService


class SoarInterpolationTests(SimpleTestCase):
    def setUp(self):
        self.service = SOARService(SimpleNamespace(base_url="http://soar.internal:8080"))
        self.context = {"template": {"name": "{secret.value}", "code": "playbook"},
                        "prompt": "user {secret.value}", "secret": {"value": "CANARY", "token": "CANARY"},
                        "variables": {"first": "{variables.second}", "second": "data", "doko_output": "user {secret.value}", "container_id": 42},
                        "provider_execution": {"result": "{provider_execution.next}", "next": "unexpected"}}

    def test_values_are_not_interpreted_as_more_template_instructions(self):
        render = self.service._render_string
        self.assertEqual(render("Prompt: {prompt}", self.context), "Prompt: user {secret.value}")
        self.assertEqual(render("{template.name}", self.context), "{secret.value}")
        self.assertEqual(render("{variables.first}", self.context), "{variables.second}")
        self.assertEqual(render("{provider_execution.result}", self.context), "{provider_execution.next}")

    def test_original_markers_and_typed_payloads_still_work(self):
        self.assertEqual(self.service._render_string("{base_url}/{template.code}?key={secret.value}", self.context), "http://soar.internal:8080/playbook?key=CANARY")
        self.assertEqual(self.service._render_value("{variables}", self.context), self.context["variables"])
        self.assertEqual(self.service._render_value("{prompt}", self.context), self.context["prompt"])
        self.assertEqual(self.service._render_value({"input": "{variables.doko_output}", "container_id": "{variables.container_id}"}, self.context), {"input": "user {secret.value}", "container_id": "42"})
        self.assertEqual(self.service._render_string("{unknown}", self.context), "{unknown}")
