import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from core.audit import sanitize_audit_metadata
from core.crypto_secrets import encrypt_secret
from core.models import AIProvider, Alert, AlertComment, AuditLog, AutomationExecutionLog, AutomationRule, Case, CaseExchange, ChatContextSnapshot, ChatGeneratedDraft, ChatMessage, ChatRun, ChatSession, Comment, ConnectorAllowlistDomain, ConnectorEndpoint, ConnectorInstance, ConnectorResult, Customer, CustomerAccess, Hunt, HuntJournalEntry, InstanceProxySettings, InstanceSplunkHecSettings, InvestigationTemplate, Permission, Role, Severity, Classification, SOARProvider, Task, UserRole, WorkbookInstance, WorkbookTemplate, WorkbookTemplateItem
from core.outbound_proxy import build_outbound_proxies
from core.rbac import get_permitted_customer_ids, user_has_perm
from core.serializers_settings import AutomationRuleSerializer, RoleSerializer
from core.services_automation import AutomationContext, evaluate_rule_conditions, run_automation_rules_for_event
from core.services_chat_context import ChatContextRequest, build_chat_context_snapshot
from core.services_chat_posting import post_generated_draft, user_has_draft_target_permission
from core.services_chat import _build_recent_conversation_history, _format_prompt
from core.services_llm import LLMService
from core.services_soar import SOARService, _sanitize_soar_data
from core.services_splunk_hec import build_audit_log_hec_payload, send_payload_to_splunk_hec, test_splunk_hec_connection


User = get_user_model()


class DokoSecurityAndFunctionTests(APITestCase):
    def setUp(self):
        self.customer_a = Customer.objects.create(name="Customer A")
        self.customer_b = Customer.objects.create(name="Customer B")
        self.user_a = User.objects.create_user(username="usera", password="StrongPass-123!")
        self.user_b = User.objects.create_user(username="userb", password="StrongPass-456!")

    def grant(self, user, customer, *codes):
        role = Role.objects.create(name=f"role-{user.id}-{customer.id}-{Role.objects.count()}")
        permissions = []
        for code in codes:
            permission, _ = Permission.objects.get_or_create(code=code, defaults={"label": code})
            permissions.append(permission)
        role.permissions.set(permissions)
        UserRole.objects.create(user=user, role=role)
        CustomerAccess.objects.create(role=role, customer=customer)
        return role

    def authenticate(self, user):
        self.client.force_authenticate(user=user)

    def test_case_create_read_update_and_hard_delete(self):
        self.grant(self.user_a, self.customer_a, "case.add", "case.view", "case.update", "case.delete")
        self.authenticate(self.user_a)
        response = self.client.post(
            "/api/cases/",
            {"title": "Case A", "description": "Description", "customer": str(self.customer_a.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        case_id = response.data["id"]
        self.assertEqual(self.client.get(f"/api/cases/{case_id}/").status_code, 200)
        self.assertEqual(
            self.client.patch(f"/api/cases/{case_id}/", {"status": "in_progress"}, format="json").status_code,
            200,
        )
        self.assertEqual(self.client.delete(f"/api/cases/{case_id}/").status_code, 204)
        self.assertFalse(Case.objects.filter(id=case_id).exists())

    def test_case_cannot_move_to_an_unauthorized_customer(self):
        self.grant(self.user_a, self.customer_a, "case.view", "case.update")
        case = Case.objects.create(title="Scoped", customer=self.customer_a, owner=self.user_a)
        self.authenticate(self.user_a)
        response = self.client.patch(
            f"/api/cases/{case.id}/",
            {"customer": str(self.customer_b.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        case.refresh_from_db()
        self.assertEqual(case.customer_id, self.customer_a.id)

    def test_customer_scoped_chat_permission_does_not_cross_customers(self):
        self.grant(self.user_a, self.customer_a, "chat.read.case", "case.view")
        self.assertTrue(user_has_perm(self.user_a, "chat.read.case", customer_id=self.customer_a.id))
        self.assertFalse(user_has_perm(self.user_a, "chat.read.case", customer_id=self.customer_b.id))
        self.assertFalse(user_has_perm(self.user_a, "chat.read.case"))

    def test_direct_customer_access_applies_assigned_role_permissions(self):
        permission, _ = Permission.objects.get_or_create(code="case.view", defaults={"label": "View cases"})
        role = Role.objects.create(name="direct-customer-role")
        role.permissions.add(permission)
        UserRole.objects.create(user=self.user_a, role=role)
        CustomerAccess.objects.create(user=self.user_a, customer=self.customer_a)

        self.assertTrue(user_has_perm(self.user_a, "case.view", customer_id=self.customer_a.id))
        self.assertFalse(user_has_perm(self.user_a, "case.view", customer_id=self.customer_b.id))

    def test_task_manager_scope_does_not_leak_other_customer_tasks(self):
        self.grant(self.user_a, self.customer_a, "task.manage")
        visible = Task.objects.create(title="Visible", owner=self.user_b)
        visible.customers.add(self.customer_a)
        hidden = Task.objects.create(title="Hidden", owner=self.user_b)
        hidden.customers.add(self.customer_b)
        self.authenticate(self.user_a)
        response = self.client.get("/api/tasks/?scope=all")
        self.assertEqual(response.status_code, 200)
        results = response.data.get("results", response.data)
        ids = {str(item["id"]) for item in results}
        self.assertIn(str(visible.id), ids)
        self.assertNotIn(str(hidden.id), ids)

    def test_user_manager_cannot_take_over_administrator(self):
        admin = User.objects.create_user(
            username="administrator",
            password="StrongPass-789!",
            is_staff=True,
        )
        permission, _ = Permission.objects.get_or_create(
            code="settings.access.users.manage",
            defaults={"label": "Manage users"},
        )
        role = Role.objects.create(name="user-manager")
        role.permissions.add(permission)
        UserRole.objects.create(user=self.user_a, role=role)
        self.authenticate(self.user_a)
        self.assertEqual(
            self.client.post(f"/api/settings/users/{admin.id}/password-reset-link/").status_code,
            403,
        )
        self.assertEqual(
            self.client.post(f"/api/settings/users/{admin.id}/api-tokens/", {}, format="json").status_code,
            403,
        )
        self.assertEqual(
            self.client.patch(
                f"/api/settings/users/{admin.id}/",
                {"is_active": False},
                format="json",
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.get(f"/api/settings/users/{admin.id}/api-tokens/").status_code,
            403,
        )

    def test_user_delete_is_permanent(self):
        admin = User.objects.create_user(
            username="admin",
            password="StrongPass-Admin!",
            is_staff=True,
        )
        target = User.objects.create_user(username="target", password="StrongPass-Target!")
        self.authenticate(admin)
        response = self.client.post(f"/api/settings/users/{target.id}/delete/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(User.objects.filter(id=target.id).exists())

    def test_delete_endpoints_hard_delete_core_entities(self):
        admin = User.objects.create_user(
            username="delete-admin",
            password="StrongPass-Delete!",
            is_staff=True,
        )
        self.authenticate(admin)

        case = Case.objects.create(title="Delete case", customer=self.customer_a, owner=admin)
        comment = Comment.objects.create(case=case, author=admin, text="Delete comment")
        alert = Alert.objects.create(title="Delete alert", customer=self.customer_a, owner=admin)
        hunt = Hunt.objects.create(title="Delete hunt", customer=self.customer_a, owner=admin)
        customer = Customer.objects.create(name="Delete customer")
        role = Role.objects.create(name="Delete role")

        self.assertEqual(self.client.delete(f"/api/comments/{comment.id}/").status_code, 204)
        self.assertEqual(self.client.delete(f"/api/alerts/{alert.id}/").status_code, 204)
        self.assertEqual(self.client.delete(f"/api/hunts/{hunt.id}/").status_code, 204)
        self.assertEqual(self.client.delete(f"/api/settings/customers/{customer.id}/").status_code, 204)
        self.assertEqual(self.client.delete(f"/api/settings/roles/{role.id}/").status_code, 204)

        self.assertFalse(Comment.objects.filter(id=comment.id).exists())
        self.assertFalse(Alert.objects.filter(id=alert.id).exists())
        self.assertFalse(Hunt.objects.filter(id=hunt.id).exists())
        self.assertFalse(Customer.objects.filter(id=customer.id).exists())
        self.assertFalse(Role.objects.filter(id=role.id).exists())

    def test_admin_is_exposed_with_clear_business_name(self):
        admin = User.objects.create_user(
            username="admin2",
            password="StrongPass-Admin2!",
            is_staff=True,
        )
        self.authenticate(admin)
        response = self.client.get("/api/me/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["is_admin"])
        self.assertNotIn("is_staff", response.data)

    def test_audit_metadata_redacts_sensitive_content(self):
        sanitized = sanitize_audit_metadata(
            {
                "case_id": "123",
                "payload": {"description": "secret case content"},
                "authorization": "Bearer secret",
            }
        )
        self.assertEqual(sanitized["case_id"], "123")
        self.assertEqual(sanitized["payload"], "[redacted]")
        self.assertEqual(sanitized["authorization"], "[redacted]")

    def test_case_chat_context_only_contains_requested_sections(self):
        self.grant(self.user_a, self.customer_a, "chat.read.case", "case.view")
        case = Case.objects.create(
            title="Scoped context",
            description="Requested summary",
            customer=self.customer_a,
            owner=self.user_a,
            iocs=[{"type": "ip", "value": "203.0.113.5"}],
            assets=[{"type": "host", "value": "host-a"}],
        )
        Comment.objects.create(case=case, author=self.user_a, text="Private comment")

        summary = build_chat_context_snapshot(
            ChatContextRequest(
                user=self.user_a,
                page_type="case",
                object_id=str(case.id),
                current_tab="summary",
                inclusions=["summary"],
                customer_id=str(self.customer_a.id),
            )
        )
        self.assertEqual(summary["header"]["description"], "Requested summary")
        self.assertEqual(summary["iocs"], [])
        self.assertEqual(summary["assets"], [])
        self.assertEqual(summary["comments"], [])

        indicators = build_chat_context_snapshot(
            ChatContextRequest(
                user=self.user_a,
                page_type="case",
                object_id=str(case.id),
                current_tab="indicators",
                inclusions=["iocs"],
                customer_id=str(self.customer_a.id),
            )
        )
        self.assertEqual(indicators["header"], {})
        self.assertEqual(indicators["iocs"], case.iocs)
        self.assertEqual(indicators["comments"], [])

    def test_global_chat_context_does_not_store_recent_record_content(self):
        self.grant(self.user_a, self.customer_a, "chat.use", "chat.read.case", "case.view")
        Case.objects.create(
            title="Do not snapshot this record",
            description="Sensitive investigation detail",
            customer=self.customer_a,
            owner=self.user_a,
        )
        payload = build_chat_context_snapshot(
            ChatContextRequest(
                user=self.user_a,
                page_type="global",
                object_id=None,
                current_tab=None,
                inclusions=[],
                customer_id=str(self.customer_a.id),
            )
        )
        self.assertEqual(payload["recent_cases"], [])
        self.assertNotIn("Sensitive investigation detail", str(payload))

    def test_soar_response_sanitizer_redacts_credentials(self):
        sanitized = _sanitize_soar_data(
            {
                "status": "completed",
                "access_token": "secret-token",
                "nested": {"authorization": "Bearer secret"},
            }
        )
        self.assertEqual(sanitized["status"], "completed")
        self.assertEqual(sanitized["access_token"], "[redacted]")
        self.assertEqual(sanitized["nested"]["authorization"], "[redacted]")

    def test_outbound_proxy_builds_authenticated_urls_without_exposing_password(self):
        settings_obj = InstanceProxySettings.get_solo()
        settings_obj.enabled = True
        settings_obj.host = "https://proxy.example.test"
        settings_obj.port = 8443
        settings_obj.username = "proxy user"
        settings_obj.set_password("proxy p@ss")
        settings_obj.save()

        expected = "https://proxy%20user:proxy%20p%40ss@proxy.example.test:8443"
        self.assertEqual(build_outbound_proxies(), {"http": expected, "https": expected})

        admin = User.objects.create_user(username="proxy-admin", password="StrongPass-Proxy!", is_staff=True)
        self.authenticate(admin)
        response = self.client.get("/api/settings/instance/")
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("password", response.data["proxy"])
        self.assertNotIn("proxy p@ss", str(response.data))

    def test_proxy_settings_reject_credentials_or_port_embedded_in_host(self):
        admin = User.objects.create_user(username="proxy-validator", password="StrongPass-Proxy2!", is_staff=True)
        self.authenticate(admin)

        credentials = self.client.put(
            "/api/settings/instance/proxy/",
            {"enabled": True, "host": "http://user:secret@proxy.example.test", "port": 8080},
            format="json",
        )
        embedded_port = self.client.put(
            "/api/settings/instance/proxy/",
            {"enabled": True, "host": "proxy.example.test:8080", "port": 8080},
            format="json",
        )

        self.assertEqual(credentials.status_code, 400)
        self.assertEqual(embedded_port.status_code, 400)

    @patch("core.services_splunk_hec.requests.post")
    def test_splunk_hec_uses_proxy_auth_and_sanitized_audit_payload(self, post):
        proxy = InstanceProxySettings.get_solo()
        proxy.enabled = True
        proxy.host = "proxy.example.test"
        proxy.port = 8080
        proxy.username = "proxy-user"
        proxy.set_password("proxy-secret")
        proxy.save()

        splunk = InstanceSplunkHecSettings.get_solo()
        splunk.enabled = True
        splunk.endpoint = "http://splunk.example.test:8088/services/collector"
        splunk.index = "doko"
        splunk.set_token("hec-secret")
        splunk.save()

        audit_log = AuditLog.objects.create(
            created_at=timezone.now(),
            action="case.updated",
            object_type="case",
            object_id="case-id",
            object_repr="sensitive case title",
            metadata={"description": "sensitive description", "case_id": "case-id"},
        )
        payload = build_audit_log_hec_payload(audit_log, splunk)
        response = Mock(status_code=200)
        post.return_value = response

        send_payload_to_splunk_hec(splunk, payload)

        post.assert_called_once_with(
            splunk.endpoint,
            headers={"Authorization": "Splunk hec-secret", "Content-Type": "application/json"},
            json=payload,
            timeout=10,
            proxies={
                "http": "http://proxy-user:proxy-secret@proxy.example.test:8080",
                "https": "http://proxy-user:proxy-secret@proxy.example.test:8080",
            },
        )
        self.assertNotIn("object_repr", payload["event"])
        self.assertEqual(payload["event"]["metadata"]["description"], "[redacted]")

    def test_splunk_hec_reaches_collector_through_configured_proxy(self):
        received = {}

        class ProxyHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                received["path"] = self.path
                received["headers"] = dict(self.headers)
                received["body"] = json.loads(self.rfile.read(length))
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(b'{"text":"Success","code":0}')

            def log_message(self, format, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), ProxyHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        try:
            proxy = InstanceProxySettings.get_solo()
            proxy.enabled = True
            proxy.host = "127.0.0.1"
            proxy.port = server.server_port
            proxy.username = "proxy-user"
            proxy.set_password("proxy-secret")
            proxy.save()

            ok, detail = test_splunk_hec_connection(
                {
                    "endpoint": "http://splunk.example.test:8088/services/collector",
                    "token": "hec-secret",
                    "index": "doko",
                }
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertTrue(ok)
        self.assertEqual(detail, "Connection successful.")
        self.assertEqual(received["path"], "http://splunk.example.test:8088/services/collector")
        self.assertEqual(received["headers"]["Authorization"], "Splunk hec-secret")
        self.assertTrue(received["headers"]["Proxy-Authorization"].startswith("Basic "))
        self.assertEqual(received["body"]["index"], "doko")

    def test_internal_http_llm_request_and_response(self):
        received = {}

        class LlmHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                received["path"] = self.path
                received["authorization"] = self.headers.get("Authorization")
                received["body"] = json.loads(self.rfile.read(length))
                body = json.dumps({"choices": [{"message": {"content": "Mock answer"}}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), LlmHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        try:
            provider = AIProvider.objects.create(
                name="Local test LLM",
                code="local-test-llm",
                provider_kind="openai_compatible",
                base_url=f"http://127.0.0.1:{server.server_port}/v1",
                default_model="test-model",
            )
            provider.set_api_key("llm-secret")
            provider.save(update_fields=["api_key_secret_ref"])
            answer = LLMService(provider).generate(system_prompt="System", user_prompt="User")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual(answer, "Mock answer")
        self.assertEqual(received["path"], "/v1/chat/completions")
        self.assertEqual(received["authorization"], "Bearer llm-secret")
        self.assertEqual(received["body"]["model"], "test-model")
        self.assertEqual(received["body"]["messages"][1]["content"], "User")

    def test_internal_http_soar_template_execution(self):
        received = {}

        class SoarHandler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                received["path"] = self.path
                received["authorization"] = self.headers.get("Authorization")
                received["body"] = json.loads(self.rfile.read(length))
                body = json.dumps(
                    {
                        "run_id": "run-1",
                        "status": "completed",
                        "outputs": {"verdict": "benign"},
                        "access_token": "remote-secret",
                    }
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, format, *args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), SoarHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()

        try:
            provider = SOARProvider.objects.create(
                name="Local test SOAR",
                code="local-test-soar",
                provider_kind="generic_http",
                base_url=f"http://127.0.0.1:{server.server_port}",
                auth_type="bearer",
                auth_secret_ref=encrypt_secret("soar-secret"),
                request_config={
                    "method": "POST",
                    "url_template": "{base_url}/launch",
                    "body_template": {
                        "playbook": "{template.remote_template_code}",
                        "target": "{variables.target}",
                    },
                },
            )
            template = InvestigationTemplate.objects.create(
                code="local-test-template",
                name="Local test template",
                entity_type="ip",
                target_kind="single",
                soar_provider=provider,
                remote_template_code="enrich-ip",
            )
            result = SOARService(provider).execute_template(template, {"target": "203.0.113.10"})
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

        self.assertEqual(result["status"], "success")
        self.assertEqual(received["path"], "/launch")
        self.assertEqual(received["authorization"], "Bearer soar-secret")
        self.assertEqual(received["body"]["playbook"], "enrich-ip")
        self.assertEqual(received["body"]["remote_template_code"], "enrich-ip")
        self.assertEqual(received["body"]["target"], "203.0.113.10")
        self.assertEqual(result["response"]["access_token"], "[redacted]")

    @patch("core.services_splunk_hec.requests.post")
    def test_splunk_hec_test_reports_success_and_hides_network_details(self, post):
        post.return_value = Mock(status_code=200)
        ok, detail = test_splunk_hec_connection(
            {"endpoint": "http://splunk.example.test:8088/services/collector", "token": "hec-secret"}
        )
        self.assertTrue(ok)
        self.assertEqual(detail, "Connection successful.")

        import requests

        post.side_effect = requests.exceptions.ProxyError("proxy-user:proxy-secret@proxy.example.test")
        ok, detail = test_splunk_hec_connection(
            {"endpoint": "http://splunk.example.test:8088/services/collector", "token": "hec-secret"}
        )
        self.assertFalse(ok)
        self.assertEqual(detail, "Unable to reach Splunk HEC.")
        self.assertNotIn("proxy-secret", detail)

    def test_role_permission_update_rejects_unknown_ids(self):
        serializer = RoleSerializer(
            data={
                "name": "invalid-permission-role",
                "permission_ids": [999999],
            }
        )
        self.assertFalse(serializer.is_valid())
        self.assertIn("permission_ids", serializer.errors)

    def test_permissions_from_different_roles_do_not_mix_customers(self):
        self.grant(self.user_a, self.customer_a, "case.view", "alert.view")
        self.grant(self.user_a, self.customer_b, "hunt.view")

        case_a = Case.objects.create(title="Visible case", customer=self.customer_a)
        case_b = Case.objects.create(title="Hidden case", customer=self.customer_b)
        alert_a = Alert.objects.create(title="Visible alert", customer=self.customer_a)
        alert_b = Alert.objects.create(title="Hidden alert", customer=self.customer_b)
        hunt_a = Hunt.objects.create(title="Hidden hunt", customer=self.customer_a)
        hunt_b = Hunt.objects.create(title="Visible hunt", customer=self.customer_b)

        self.assertEqual(
            {str(value) for value in get_permitted_customer_ids(self.user_a, "case.view")},
            {str(self.customer_a.id)},
        )

        self.authenticate(self.user_a)
        cases = self.client.get("/api/cases/").data
        alerts = self.client.get("/api/alerts/").data
        hunts = self.client.get("/api/hunts/").data

        case_results = cases.get("results", cases)
        alert_results = alerts.get("results", alerts)
        hunt_results = hunts.get("results", hunts)
        self.assertEqual({str(item["id"]) for item in case_results}, {str(case_a.id)})
        self.assertEqual({str(item["id"]) for item in alert_results}, {str(alert_a.id)})
        self.assertEqual({str(item["id"]) for item in hunt_results}, {str(hunt_b.id)})
        self.assertNotIn(str(case_b.id), str(cases))
        self.assertNotIn(str(alert_b.id), str(alerts))
        self.assertNotIn(str(hunt_a.id), str(hunts))

    def test_scoped_catbot_comment_permissions_apply_to_target_customer(self):
        self.grant(
            self.user_a,
            self.customer_a,
            "chat.use",
            "chat.comment.case.generate",
            "chat.comment.case.post",
            "case.view",
        )
        case_a = Case.objects.create(title="Allowed", customer=self.customer_a)
        case_b = Case.objects.create(title="Denied", customer=self.customer_b)
        provider = AIProvider.objects.create(
            name="Draft test provider",
            code="draft-test-provider",
            base_url="http://127.0.0.1:1/v1",
            default_model="test",
        )
        session = ChatSession.objects.create(user=self.user_a, client_tab_id="test")
        snapshot = ChatContextSnapshot.objects.create(
            session=session,
            user=self.user_a,
            page_type="case",
            object_id=str(case_a.id),
            context_payload={},
        )
        run = ChatRun.objects.create(
            session=session,
            snapshot=snapshot,
            user=self.user_a,
            request_id="request-1",
            client_tab_id="test",
            prompt="test",
            provider=provider,
        )
        draft = ChatGeneratedDraft.objects.create(
            run=run,
            target_type="case_comment",
            target_id=str(case_a.id),
            content="<p>Generated note</p>",
        )

        self.assertTrue(
            user_has_draft_target_permission(
                self.user_a,
                "case_comment",
                str(case_a.id),
                "post",
            )
        )
        self.assertFalse(
            user_has_draft_target_permission(
                self.user_a,
                "case_comment",
                str(case_b.id),
                "post",
            )
        )
        post_generated_draft(user=self.user_a, draft=draft)
        self.assertTrue(Comment.objects.filter(case=case_a, author_label="Catbot").exists())

    def test_catbot_uses_recent_conversation_without_crossing_sessions(self):
        provider = AIProvider.objects.create(
            name="History test provider",
            code="history-test-provider",
            base_url="http://127.0.0.1:1/v1",
            default_model="test",
        )
        session = ChatSession.objects.create(user=self.user_a, client_tab_id="history")
        snapshot = ChatContextSnapshot.objects.create(session=session, user=self.user_a, context_payload={})
        run = ChatRun.objects.create(
            session=session,
            snapshot=snapshot,
            user=self.user_a,
            provider=provider,
            request_id="current-request",
            client_tab_id="history",
            prompt="Continue",
        )
        for index in range(14):
            ChatMessage.objects.create(
                session=session,
                role="user" if index % 2 == 0 else "assistant",
                content=f"message-{index}",
                metadata={"request_id": f"previous-{index}"},
            )
        ChatMessage.objects.create(
            session=session,
            role="user",
            content="current-message",
            metadata={"request_id": "current-request"},
        )
        other_session = ChatSession.objects.create(user=self.user_a, client_tab_id="other")
        ChatMessage.objects.create(session=other_session, role="user", content="other-session-secret")

        history = _build_recent_conversation_history(run)
        prompt = _format_prompt({}, run.prompt, history)
        self.assertEqual(len(history), 12)
        self.assertEqual(history[0]["content"], "message-2")
        self.assertEqual(history[-1]["content"], "message-13")
        self.assertNotIn("current-message", prompt)
        self.assertNotIn("other-session-secret", prompt)
        self.assertIn("message-13", prompt)

    def test_automation_condition_operators(self):
        target = Case.objects.create(
            title="Suspicious endpoint activity",
            customer=self.customer_a,
            iocs=[{"key": "ip", "value": "203.0.113.1"}, {"key": "domain", "value": "example.test"}],
        )
        checks = [
            ("title", "EQUAL", "Suspicious endpoint activity"),
            ("title", "NOT EQUAL", "Benign"),
            ("title", "CONTAINS", "endpoint"),
            ("title", "DOES NOT CONTAIN", "benign"),
            ("ioc_count", "GREATER THAN", 1),
            ("ioc_count", "LESS THAN", 3),
            ("ioc_count", "BETWEEN", {"from": 1, "to": 2}),
        ]
        for field, operator, value in checks:
            with self.subTest(operator=operator):
                rule = AutomationRule(
                    scope="case",
                    conditions={
                        "operator": "AND",
                        "children": [{"field": field, "operator": operator, "value": value}],
                    },
                )
                self.assertTrue(
                    evaluate_rule_conditions(
                        rule,
                        AutomationContext(scope="case", target=target, event="case.updated"),
                    )
                )

    def test_automation_actions_execute_for_cases_alerts_and_hunts(self):
        Severity.objects.update_or_create(code="critical", defaults={"label": "Critical", "is_active": True})
        Classification.objects.update_or_create(code="malware", defaults={"label": "Malware", "is_active": True})
        workbook = WorkbookTemplate.objects.create(name="Automation workbook")
        WorkbookTemplateItem.objects.create(template=workbook, label="Review", order=0)
        case = Case.objects.create(title="Case automation", customer=self.customer_a)
        alert = Alert.objects.create(title="Alert automation", customer=self.customer_a, case=case)
        hunt = Hunt.objects.create(title="Hunt automation", customer=self.customer_a)

        rules = [
            AutomationRule.objects.create(
                name="case-actions",
                scope="case",
                conditions={"operator": "AND", "children": [{"field": "event", "operator": "EQUAL", "value": "case.updated"}]},
                actions=[
                    {"type": "add_comment", "body": "Case automation note"},
                    {"type": "change_status", "value": "in_progress"},
                    {"type": "change_classification", "value": "malware"},
                    {"type": "change_severity", "value": "critical"},
                    {"type": "apply_workbook_template", "workbook_template_id": str(workbook.id)},
                    {"type": "exchange_message", "body": "Saved Exchange", "send_mode": "save"},
                ],
            ),
            AutomationRule.objects.create(
                name="alert-actions",
                scope="alert",
                conditions={"operator": "AND", "children": [{"field": "event", "operator": "EQUAL", "value": "alert.updated"}]},
                actions=[
                    {"type": "add_comment", "body": "Alert automation note"},
                    {"type": "change_status", "value": "in_progress"},
                    {"type": "change_classification", "value": "malware"},
                    {"type": "change_severity", "value": "critical"},
                ],
            ),
            AutomationRule.objects.create(
                name="hunt-actions",
                scope="hunt",
                conditions={"operator": "AND", "children": [{"field": "event", "operator": "EQUAL", "value": "hunt.updated"}]},
                actions=[
                    {"type": "add_comment", "body": "Hunt automation note"},
                    {"type": "change_status", "value": "in_progress"},
                ],
            ),
        ]

        case_logs = run_automation_rules_for_event(scope="case", target=case, event="case.updated", rule_ids=[rules[0].id])
        alert_logs = run_automation_rules_for_event(scope="alert", target=alert, event="alert.updated", rule_ids=[rules[1].id])
        hunt_logs = run_automation_rules_for_event(scope="hunt", target=hunt, event="hunt.updated", rule_ids=[rules[2].id])

        self.assertEqual(case_logs[0].status, AutomationExecutionLog.Status.SUCCESS)
        self.assertEqual(alert_logs[0].status, AutomationExecutionLog.Status.SUCCESS)
        self.assertEqual(hunt_logs[0].status, AutomationExecutionLog.Status.SUCCESS)
        case.refresh_from_db()
        alert.refresh_from_db()
        hunt.refresh_from_db()
        self.assertEqual((case.status, case.classification, case.severity), ("in_progress", "malware", "critical"))
        self.assertEqual((alert.status, alert.classification, alert.severity), ("in_progress", "malware", "critical"))
        self.assertEqual(hunt.status, "in_progress")
        self.assertTrue(Comment.objects.filter(case=case, author_label="Doko Automation").exists())
        self.assertTrue(AlertComment.objects.filter(alert=alert, author_label="Doko Automation").exists())
        self.assertTrue(HuntJournalEntry.objects.filter(hunt=hunt).exists())
        self.assertTrue(WorkbookInstance.objects.filter(case=case, template=workbook).exists())
        self.assertTrue(CaseExchange.objects.filter(case=case, direction="outbound").exists())

    def test_automation_scope_validation_rejects_impossible_hunt_options(self):
        base = {
            "name": "invalid-hunt-rule",
            "scope": "hunt",
            "is_enabled": True,
            "conditions": {
                "operator": "AND",
                "children": [{"field": "classification", "operator": "EQUAL", "value": "malware"}],
            },
            "actions": [{"type": "change_classification", "value": "malware"}],
        }
        serializer = AutomationRuleSerializer(data=base)
        self.assertFalse(serializer.is_valid())

        base["conditions"] = {"operator": "AND", "children": []}
        base["actions"] = [{
            "type": "run_investigation_template",
            "template_id": "00000000-0000-0000-0000-000000000001",
            "target_source": "manual",
            "target_value": "203.0.113.5",
            "post_result_comment": True,
        }]
        serializer = AutomationRuleSerializer(data=base)
        self.assertFalse(serializer.is_valid())

    def test_automation_investigation_templates_run_for_all_scopes(self):
        provider = SOARProvider.objects.create(
            name="Automation SOAR",
            code="automation-soar",
            base_url="http://127.0.0.1:1",
            auth_type="none",
        )
        template = InvestigationTemplate.objects.create(
            code="automation-investigation",
            name="Automation investigation",
            entity_type="ip",
            target_kind="single",
            soar_provider=provider,
            remote_template_code="lookup-ip",
        )
        targets = {
            "case": Case.objects.create(title="Investigation case", customer=self.customer_a),
            "alert": Alert.objects.create(title="Investigation alert", customer=self.customer_a),
            "hunt": Hunt.objects.create(title="Investigation hunt", customer=self.customer_a),
        }

        with patch(
            "core.services_automation.SOARService.launch_execution",
            return_value={"status": "completed", "external_run_id": "run-1"},
        ) as launch_execution, patch(
            "core.services_automation.SOARService.collect_result",
            return_value={"status": "completed", "outputs": {"verdict": "benign"}},
        ):
            for scope, target in targets.items():
                event = f"{scope}.updated"
                rule = AutomationRule.objects.create(
                    name=f"{scope}-investigation",
                    scope=scope,
                    conditions={"operator": "AND", "children": [{"field": "event", "operator": "EQUAL", "value": event}]},
                    actions=[{
                        "type": "run_investigation_template",
                        "template_id": str(template.id),
                        "target_source": "manual",
                        "target_type": "ip",
                        "target_value": "203.0.113.15",
                    }],
                )
                logs = run_automation_rules_for_event(
                    scope=scope,
                    target=target,
                    event=event,
                    rule_ids=[rule.id],
                )
                self.assertEqual(logs[0].status, AutomationExecutionLog.Status.SUCCESS)

        self.assertEqual(launch_execution.call_count, 3)

    @patch("core.views._run_automation_safely")
    def test_alert_escalation_emits_generic_and_specific_case_events(self, run_automation):
        admin = User.objects.create_user(username="automation-admin", password="StrongPass-Automation!", is_staff=True)
        alert = Alert.objects.create(title="Escalate", customer=self.customer_a)
        self.authenticate(admin)
        response = self.client.post(f"/api/alerts/{alert.id}/escalate/", {}, format="json")
        self.assertEqual(response.status_code, 201)
        case_events = [
            call.kwargs["event"]
            for call in run_automation.call_args_list
            if call.kwargs.get("scope") == "case"
        ]
        self.assertIn("case.created", case_events)
        self.assertIn("case.created_from_alert_escalation", case_events)

    @patch("core.views_connectors.run_hub_request")
    @patch("core.views_connectors._normalize_base_url", return_value="https://api.example.test/")
    def test_connector_sends_only_selected_target_and_redacts_stored_secret(self, normalize_url, run_hub):
        admin = User.objects.create_user(username="connector-admin", password="StrongPass-Connector!", is_staff=True)
        case = Case.objects.create(
            title="Sensitive case title",
            description="Sensitive case description",
            customer=self.customer_a,
            iocs=[{"key": "ip", "value": "203.0.113.50"}],
            assets=[{"key": "host", "value": "host-secret"}],
        )
        instance = ConnectorInstance.objects.create(name="Test connector", created_by=admin)
        instance.encrypted_secret = encrypt_secret("connector-secret")
        instance.save(update_fields=["encrypted_secret"])
        endpoint = ConnectorEndpoint.objects.create(
            instance=instance,
            name="lookup",
            target_type="ioc",
            method="POST",
            base_url="https://api.example.test/",
            path_template="lookup/{{secret}}/{{value}}",
            headers_text=json.dumps({"X-Custom": "prefix-{{secret}}"}),
            body_template={"indicator": "{{value}}", "kind": "{{key}}", "token": "{{secret}}"},
        )
        ConnectorAllowlistDomain.objects.create(domain="api.example.test")
        run_hub.return_value = Mock(
            status_code=200,
            json=Mock(return_value={"results": [{"key": "ip", "value": "203.0.113.50", "http_status": 200, "data": {"ok": True}}]}),
        )
        self.authenticate(admin)

        with patch("core.views_connectors._require_connector_hub_config", return_value=("http://hub:8080", "hmac")):
            response = self.client.post(
                "/api/connectors/run/",
                {
                    "case_id": str(case.id),
                    "target_type": "ioc",
                    "targets": [{"key": "ip", "value": "203.0.113.50"}],
                    "connector_instance_id": str(instance.id),
                    "endpoint_id": str(endpoint.id),
                },
                format="json",
            )

        self.assertEqual(response.status_code, 200)
        sent_payload = run_hub.call_args.kwargs["payload"]
        self.assertEqual(sent_payload["calls"][0]["body"]["indicator"], "203.0.113.50")
        self.assertNotIn(case.title, str(sent_payload))
        self.assertNotIn(case.description, str(sent_payload))
        self.assertNotIn("host-secret", str(sent_payload))
        stored = ConnectorResult.objects.get(case=case)
        self.assertNotIn("connector-secret", str(stored.request_payload))
        self.assertIn("[redacted]", str(stored.request_payload))

        with patch("core.views_connectors._require_connector_hub_config", return_value=("http://hub:8080", "hmac")):
            rejected = self.client.post(
                "/api/connectors/run/",
                {
                    "case_id": str(case.id),
                    "target_type": "ioc",
                    "targets": [{"key": "ip", "value": "198.51.100.99"}],
                    "connector_instance_id": str(instance.id),
                    "endpoint_id": str(endpoint.id),
                },
                format="json",
            )
        self.assertEqual(rejected.status_code, 400)
