from datetime import datetime, timezone as datetime_timezone
from datetime import timedelta
import queue
import socket
import ssl
import tempfile
import threading
from unittest.mock import MagicMock, patch

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import AuditLog, InstanceSyslogSettings
from .services_syslog import (
    build_audit_event,
    build_syslog_message,
    send_message_to_syslog,
)


class SyslogFormatTests(TestCase):
    def setUp(self):
        self.audit_log = AuditLog.objects.create(
            created_at=timezone.now(),
            actor_username="analyst",
            action="case.updated",
            object_type="case",
            object_id="case-id",
            object_repr="private case title",
            success=True,
            metadata={"description": "private description", "case_id": "case-id"},
        )
        self.event = build_audit_event(self.audit_log)
        self.now = datetime(2026, 8, 21, 10, 11, 12, 123000, tzinfo=datetime_timezone.utc)

    def test_audit_event_is_sanitized(self):
        serialized = str(self.event)
        self.assertNotIn("private case title", serialized)
        self.assertNotIn("private description", serialized)
        self.assertEqual(self.event["metadata"]["description"], "[redacted]")

    def test_rfc5424_format(self):
        message = build_syslog_message(
            self.event,
            InstanceSyslogSettings.Format.RFC5424,
            hostname="doko-host",
            now=self.now,
        )
        self.assertTrue(message.startswith("<134>1 2026-08-21T10:11:12.123Z doko-host doko - DOKO_AUDIT - "))
        self.assertIn('"action":"case.updated"', message)

    def test_rfc3164_format(self):
        message = build_syslog_message(
            self.event,
            InstanceSyslogSettings.Format.RFC3164,
            hostname="doko-host",
            now=self.now,
        )
        self.assertTrue(message.startswith("<134>Aug 21 10:11:12 doko-host doko: "))
        self.assertIn('"object_id":"case-id"', message)

    def test_cef_format(self):
        message = build_syslog_message(
            self.event,
            InstanceSyslogSettings.Format.CEF,
            hostname="doko-host",
            now=self.now,
        )
        self.assertTrue(message.startswith("CEF:0|Doko|Doko|1.0|case.updated|case|3|"))
        self.assertIn("externalId=", message)
        self.assertIn("cs2=case-id", message)


class SyslogTransportTests(TestCase):
    @patch("core.services_syslog.socket.socket")
    @patch("core.services_syslog.socket.getaddrinfo")
    def test_udp_transport(self, getaddrinfo, socket_class):
        getaddrinfo.return_value = [(2, 2, 17, "", ("127.0.0.1", 514))]
        client = socket_class.return_value.__enter__.return_value
        settings_obj = InstanceSyslogSettings(
            enabled=True,
            host="127.0.0.1",
            port=514,
            protocol=InstanceSyslogSettings.Protocol.UDP,
        )

        send_message_to_syslog(settings_obj, "test")

        client.settimeout.assert_called_once_with(10)
        client.sendto.assert_called_once_with(b"test\n", ("127.0.0.1", 514))

    @patch("core.services_syslog.socket.create_connection")
    def test_tcp_transport(self, create_connection):
        connection = create_connection.return_value.__enter__.return_value
        settings_obj = InstanceSyslogSettings(
            enabled=True,
            host="syslog.example.test",
            port=514,
            protocol=InstanceSyslogSettings.Protocol.TCP,
        )

        send_message_to_syslog(settings_obj, "test")

        create_connection.assert_called_once_with(("syslog.example.test", 514), timeout=10)
        connection.sendall.assert_called_once_with(b"test\n")

    @patch("core.services_syslog.ssl.create_default_context")
    @patch("core.services_syslog.socket.create_connection")
    def test_tls_transport_verifies_with_configured_ca(self, create_connection, create_context):
        connection = create_connection.return_value.__enter__.return_value
        context = MagicMock()
        tls_connection = context.wrap_socket.return_value.__enter__.return_value
        create_context.return_value = context
        settings_obj = InstanceSyslogSettings(
            enabled=True,
            host="syslog.example.test",
            port=6514,
            protocol=InstanceSyslogSettings.Protocol.TCP_TLS,
            ca_certificate="test-ca",
        )

        send_message_to_syslog(settings_obj, "test")

        create_context.assert_called_once_with(cadata="test-ca")
        context.wrap_socket.assert_called_once_with(connection, server_hostname="syslog.example.test")
        tls_connection.sendall.assert_called_once_with(b"test\n")


class SyslogLoopbackTests(TestCase):
    def test_udp_message_reaches_receiver(self):
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as receiver:
            receiver.bind(("127.0.0.1", 0))
            receiver.settimeout(2)
            settings_obj = InstanceSyslogSettings(
                enabled=True,
                host="127.0.0.1",
                port=receiver.getsockname()[1],
                protocol=InstanceSyslogSettings.Protocol.UDP,
            )

            send_message_to_syslog(settings_obj, "udp-test")
            payload, _ = receiver.recvfrom(1024)

        self.assertEqual(payload, b"udp-test\n")

    def test_tcp_message_reaches_receiver(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as receiver:
            receiver.bind(("127.0.0.1", 0))
            receiver.listen(1)
            receiver.settimeout(2)
            received = queue.Queue()

            def receive():
                try:
                    connection, _ = receiver.accept()
                    with connection:
                        received.put(connection.recv(1024))
                except Exception as exc:
                    received.put(exc)

            thread = threading.Thread(target=receive)
            thread.start()
            settings_obj = InstanceSyslogSettings(
                enabled=True,
                host="127.0.0.1",
                port=receiver.getsockname()[1],
                protocol=InstanceSyslogSettings.Protocol.TCP,
            )
            send_message_to_syslog(settings_obj, "tcp-test")
            thread.join(2)

        result = received.get(timeout=1)
        if isinstance(result, Exception):
            raise result
        self.assertEqual(result, b"tcp-test\n")

    def test_tls_message_reaches_verified_receiver(self):
        ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Doko Test CA")])
        now = datetime.now(datetime_timezone.utc)
        ca_certificate = (
            x509.CertificateBuilder()
            .subject_name(ca_name)
            .issuer_name(ca_name)
            .public_key(ca_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(days=1))
            .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
            .sign(ca_key, hashes.SHA256())
        )
        server_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        server_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "localhost")])
        server_certificate = (
            x509.CertificateBuilder()
            .subject_name(server_name)
            .issuer_name(ca_name)
            .public_key(server_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(minutes=1))
            .not_valid_after(now + timedelta(days=1))
            .add_extension(x509.SubjectAlternativeName([x509.DNSName("localhost")]), critical=False)
            .sign(ca_key, hashes.SHA256())
        )

        with tempfile.TemporaryDirectory() as directory:
            certificate_path = f"{directory}/server.crt"
            key_path = f"{directory}/server.key"
            with open(certificate_path, "wb") as certificate_file:
                certificate_file.write(server_certificate.public_bytes(serialization.Encoding.PEM))
            with open(key_path, "wb") as key_file:
                key_file.write(
                    server_key.private_bytes(
                        serialization.Encoding.PEM,
                        serialization.PrivateFormat.PKCS8,
                        serialization.NoEncryption(),
                    )
                )

            server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            server_context.load_cert_chain(certificate_path, key_path)
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as receiver:
                receiver.bind(("127.0.0.1", 0))
                receiver.listen(1)
                receiver.settimeout(3)
                received = queue.Queue()

                def receive_tls():
                    try:
                        connection, _ = receiver.accept()
                        with server_context.wrap_socket(connection, server_side=True) as tls_connection:
                            received.put(tls_connection.recv(1024))
                    except Exception as exc:
                        received.put(exc)

                thread = threading.Thread(target=receive_tls)
                thread.start()
                settings_obj = InstanceSyslogSettings(
                    enabled=True,
                    host="localhost",
                    port=receiver.getsockname()[1],
                    protocol=InstanceSyslogSettings.Protocol.TCP_TLS,
                    ca_certificate=ca_certificate.public_bytes(serialization.Encoding.PEM).decode("ascii"),
                )
                send_message_to_syslog(settings_obj, "tls-test")
                thread.join(3)

            result = received.get(timeout=1)
            if isinstance(result, Exception):
                raise result
            self.assertEqual(result, b"tls-test\n")


class SyslogSettingsApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = get_user_model().objects.create_user(
            username="syslog-admin",
            password="StrongPass-Syslog1!",
            is_staff=True,
        )
        self.client.force_authenticate(self.admin)

    def test_save_and_read_syslog_settings(self):
        response = self.client.put(
            "/api/settings/instance/syslog/",
            {
                "enabled": True,
                "host": "syslog.example.test",
                "port": 514,
                "protocol": "udp",
                "format": "rfc5424",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["host"], "syslog.example.test")

        detail = self.client.get("/api/settings/instance/")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.data["syslog"]["protocol"], "udp")
        self.assertNotIn("ca_certificate", detail.data["syslog"])

    def test_invalid_protocol_format_and_port_are_rejected(self):
        invalid_protocol = self.client.put(
            "/api/settings/instance/syslog/",
            {"enabled": True, "host": "syslog.example.test", "port": 514, "protocol": "http", "format": "rfc5424"},
            format="json",
        )
        invalid_format = self.client.put(
            "/api/settings/instance/syslog/",
            {"enabled": True, "host": "syslog.example.test", "port": 514, "protocol": "udp", "format": "json"},
            format="json",
        )
        invalid_port = self.client.put(
            "/api/settings/instance/syslog/",
            {"enabled": True, "host": "syslog.example.test", "port": 70000, "protocol": "udp", "format": "cef"},
            format="json",
        )

        self.assertEqual(invalid_protocol.status_code, 400)
        self.assertEqual(invalid_format.status_code, 400)
        self.assertEqual(invalid_port.status_code, 400)

    def test_host_with_embedded_scheme_or_port_is_rejected(self):
        scheme = self.client.put(
            "/api/settings/instance/syslog/",
            {"enabled": True, "host": "udp://syslog.example.test", "port": 514, "protocol": "udp", "format": "rfc5424"},
            format="json",
        )
        embedded_port = self.client.put(
            "/api/settings/instance/syslog/",
            {"enabled": True, "host": "syslog.example.test:514", "port": 514, "protocol": "udp", "format": "rfc5424"},
            format="json",
        )

        self.assertEqual(scheme.status_code, 400)
        self.assertEqual(embedded_port.status_code, 400)

    def test_tls_requires_a_valid_ca_certificate(self):
        missing = self.client.put(
            "/api/settings/instance/syslog/",
            {
                "enabled": True,
                "host": "syslog.example.test",
                "port": 6514,
                "protocol": "tcp_tls",
                "format": "rfc5424",
            },
            format="json",
        )
        invalid = self.client.put(
            "/api/settings/instance/syslog/",
            {
                "enabled": True,
                "host": "syslog.example.test",
                "port": 6514,
                "protocol": "tcp_tls",
                "format": "rfc5424",
                "ca_certificate": "not-a-certificate",
            },
            format="json",
        )

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(invalid.status_code, 400)

    @patch("core.views_settings.test_syslog_connection", return_value=(True, "sent"))
    def test_connection_endpoint_uses_selected_options(self, test_connection):
        response = self.client.post(
            "/api/settings/instance/syslog/test/",
            {
                "host": "syslog.example.test",
                "port": 514,
                "protocol": "tcp",
                "format": "cef",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        payload = test_connection.call_args.args[0]
        self.assertEqual(payload["protocol"], "tcp")
        self.assertEqual(payload["format"], "cef")
