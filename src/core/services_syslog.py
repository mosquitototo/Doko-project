from __future__ import annotations

import json
import socket
import ssl
from datetime import timezone as datetime_timezone
from typing import Any

from django.utils import timezone

from .audit import sanitize_audit_metadata
from .models import AuditLog, InstanceSyslogSettings


class SyslogError(RuntimeError):
    pass


def build_audit_event(audit_log: AuditLog) -> dict[str, Any]:
    return {
        "id": str(audit_log.id),
        "created_at": audit_log.created_at.isoformat() if audit_log.created_at else None,
        "actor_id": str(audit_log.actor_id) if audit_log.actor_id else "",
        "actor_username": audit_log.actor_username or "",
        "action": audit_log.action or "",
        "object_type": audit_log.object_type or "",
        "object_id": audit_log.object_id or "",
        "success": bool(audit_log.success),
        "status_code": audit_log.status_code,
        "ip_address": audit_log.ip_address or "",
        "user_agent": audit_log.user_agent or "",
        "method": audit_log.method or "",
        "path": audit_log.path or "",
        "request_id": str(audit_log.request_id) if audit_log.request_id else "",
        "duration_ms": audit_log.duration_ms,
        "metadata": sanitize_audit_metadata(audit_log.metadata or {}),
        "application": "doko",
        "event_kind": "audit",
    }


def _safe_token(value: str, fallback: str = "-") -> str:
    normalized = "".join(ch if 33 <= ord(ch) <= 126 and ch != " " else "_" for ch in str(value or ""))
    return normalized[:255] or fallback


def _json_event(event: dict[str, Any]) -> str:
    message = json.dumps(event, ensure_ascii=False, separators=(",", ":"), default=str)
    if len(message.encode("utf-8")) <= 48_000:
        return message

    compact = dict(event)
    compact["metadata"] = "[truncated]"
    return json.dumps(compact, ensure_ascii=False, separators=(",", ":"), default=str)


def _priority(event: dict[str, Any]) -> int:
    severity = 6 if event.get("success", True) else 3
    return 16 * 8 + severity


def _cef_header(value: Any) -> str:
    return str(value if value is not None else "").replace("\\", "\\\\").replace("|", "\\|").replace("\n", " ").replace("\r", " ")


def _cef_extension(value: Any) -> str:
    return str(value if value is not None else "").replace("\\", "\\\\").replace("=", "\\=").replace("\n", "\\n").replace("\r", "")


def build_syslog_message(
    event: dict[str, Any],
    message_format: str,
    *,
    hostname: str | None = None,
    now=None,
) -> str:
    host = _safe_token(hostname or socket.gethostname(), "doko")
    event_time = now or timezone.now()
    if timezone.is_naive(event_time):
        event_time = timezone.make_aware(event_time, datetime_timezone.utc)
    event_time = event_time.astimezone(datetime_timezone.utc)
    priority = _priority(event)

    if message_format == InstanceSyslogSettings.Format.RFC5424:
        timestamp = event_time.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        return f"<{priority}>1 {timestamp} {host} doko - DOKO_AUDIT - {_json_event(event)}"

    if message_format == InstanceSyslogSettings.Format.RFC3164:
        timestamp = f"{event_time.strftime('%b')} {event_time.day:2d} {event_time.strftime('%H:%M:%S')}"
        return f"<{priority}>{timestamp} {host} doko: {_json_event(event)}"

    if message_format == InstanceSyslogSettings.Format.CEF:
        cef_severity = 3 if event.get("success", True) else 8
        metadata = json.dumps(event.get("metadata") or {}, ensure_ascii=False, separators=(",", ":"), default=str)
        if len(metadata.encode("utf-8")) > 32_000:
            metadata = "[truncated]"
        fields = {
            "act": event.get("action", ""),
            "suser": event.get("actor_username", ""),
            "src": event.get("ip_address", ""),
            "request": event.get("path", ""),
            "requestMethod": event.get("method", ""),
            "outcome": "success" if event.get("success", True) else "failure",
            "externalId": event.get("id", ""),
            "cs1Label": "ObjectType",
            "cs1": event.get("object_type", ""),
            "cs2Label": "ObjectId",
            "cs2": event.get("object_id", ""),
            "cs3Label": "Metadata",
            "cs3": metadata,
        }
        extension = " ".join(f"{key}={_cef_extension(value)}" for key, value in fields.items())
        return (
            f"CEF:0|Doko|Doko|1.0|{_cef_header(event.get('action', 'audit'))}|"
            f"{_cef_header(event.get('object_type', 'audit'))}|{cef_severity}|{extension}"
        )

    raise SyslogError("Unsupported Syslog format.")


def send_message_to_syslog(settings_obj: InstanceSyslogSettings, message: str) -> None:
    if not settings_obj.enabled:
        return

    host = (settings_obj.host or "").strip()
    port = int(settings_obj.port or 0)
    protocol = settings_obj.protocol
    payload = f"{message.rstrip()}\n".encode("utf-8")

    if not host:
        raise SyslogError("Syslog host is required.")
    if port < 1 or port > 65535:
        raise SyslogError("Syslog port must be between 1 and 65535.")

    try:
        if protocol == InstanceSyslogSettings.Protocol.UDP:
            addresses = socket.getaddrinfo(host, port, type=socket.SOCK_DGRAM)
            if not addresses:
                raise SyslogError("Unable to resolve Syslog host.")
            family, socktype, proto, _, address = addresses[0]
            with socket.socket(family, socktype, proto) as client:
                client.settimeout(10)
                client.sendto(payload, address)
            return

        if protocol not in {
            InstanceSyslogSettings.Protocol.TCP,
            InstanceSyslogSettings.Protocol.TCP_TLS,
        }:
            raise SyslogError("Unsupported Syslog protocol.")

        with socket.create_connection((host, port), timeout=10) as connection:
            if protocol == InstanceSyslogSettings.Protocol.TCP_TLS:
                if not settings_obj.ca_certificate:
                    raise SyslogError("A CA certificate is required for TCP/TLS.")
                context = ssl.create_default_context(cadata=settings_obj.ca_certificate)
                with context.wrap_socket(connection, server_hostname=host) as tls_connection:
                    tls_connection.sendall(payload)
            else:
                connection.sendall(payload)
    except SyslogError:
        raise
    except (OSError, ssl.SSLError, ValueError) as exc:
        raise SyslogError("Unable to send the Syslog message.") from exc


def send_audit_log_to_syslog(audit_log: AuditLog) -> None:
    settings_obj = InstanceSyslogSettings.get_solo()
    if not settings_obj.enabled:
        return

    event = build_audit_event(audit_log)
    message = build_syslog_message(
        event,
        settings_obj.message_format,
        now=audit_log.created_at,
    )
    send_message_to_syslog(settings_obj, message)


def test_syslog_connection(payload: dict[str, Any]) -> tuple[bool, str]:
    settings_obj = InstanceSyslogSettings(
        enabled=True,
        host=(payload.get("host") or "").strip(),
        port=payload.get("port") or 0,
        protocol=payload.get("protocol") or InstanceSyslogSettings.Protocol.UDP,
        message_format=payload.get("format") or InstanceSyslogSettings.Format.RFC5424,
        ca_certificate=payload.get("ca_certificate") or "",
    )
    event = {
        "id": "connectivity-test",
        "created_at": timezone.now().isoformat(),
        "actor_id": "",
        "actor_username": "",
        "action": "syslog.connectivity_test",
        "object_type": "instance_syslog_settings",
        "object_id": "1",
        "success": True,
        "status_code": None,
        "ip_address": "",
        "user_agent": "",
        "method": "",
        "path": "",
        "request_id": "",
        "duration_ms": None,
        "metadata": {},
        "application": "doko",
        "event_kind": "connectivity_test",
    }

    try:
        message = build_syslog_message(event, settings_obj.message_format)
        send_message_to_syslog(settings_obj, message)
        if settings_obj.protocol == InstanceSyslogSettings.Protocol.UDP:
            return True, "Test message sent. UDP delivery cannot be acknowledged by the receiver."
        return True, "Connection successful and test message sent."
    except Exception as exc:
        return False, str(exc)
