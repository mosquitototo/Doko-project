from __future__ import annotations

import socket
from typing import Any

import requests
from django.utils import timezone

from .models import AuditLog, InstanceSplunkHecSettings
from .outbound_proxy import build_outbound_proxies


class SplunkHecError(RuntimeError):
    pass


def _response_detail(response: requests.Response) -> str:
    try:
        body = response.json()
        detail = body.get("text") or body.get("message") or ""
    except Exception:
        detail = (response.text or "").strip()

    if detail:
        return detail[:1000]

    return f"HTTP {response.status_code}"


def build_audit_log_hec_payload(audit_log: AuditLog, settings_obj: InstanceSplunkHecSettings) -> dict[str, Any]:
    event = {
        "id": str(audit_log.id),
        "created_at": audit_log.created_at.isoformat() if audit_log.created_at else None,
        "actor_id": str(audit_log.actor_id) if audit_log.actor_id else "",
        "actor_username": audit_log.actor_username or "",
        "action": audit_log.action or "",
        "object_type": audit_log.object_type or "",
        "object_id": audit_log.object_id or "",
        "object_repr": audit_log.object_repr or "",
        "success": bool(audit_log.success),
        "status_code": audit_log.status_code,
        "ip_address": audit_log.ip_address or "",
        "user_agent": audit_log.user_agent or "",
        "method": audit_log.method or "",
        "path": audit_log.path or "",
        "request_id": str(audit_log.request_id) if audit_log.request_id else "",
        "duration_ms": audit_log.duration_ms,
        "metadata": audit_log.metadata or {},
        "application": "doko",
        "event_kind": "audit",
    }

    payload: dict[str, Any] = {
        "time": audit_log.created_at.timestamp() if audit_log.created_at else timezone.now().timestamp(),
        "host": socket.gethostname(),
        "source": settings_obj.source or "doko:audit",
        "sourcetype": settings_obj.sourcetype or "_json",
        "event": event,
    }

    if settings_obj.index:
        payload["index"] = settings_obj.index

    return payload


def send_payload_to_splunk_hec(settings_obj: InstanceSplunkHecSettings, payload: dict[str, Any]) -> None:
    endpoint = (settings_obj.endpoint or "").strip()
    token = settings_obj.get_token()

    if not settings_obj.enabled:
        return

    if not endpoint:
        raise SplunkHecError("Splunk HEC endpoint is required.")

    if not token:
        raise SplunkHecError("Splunk HEC token is required.")

    response = requests.post(
        endpoint,
        headers={
            "Authorization": f"Splunk {token}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=10,
        proxies=build_outbound_proxies(),
    )

    if 200 <= response.status_code < 300:
        return

    raise SplunkHecError(f"Splunk HEC rejected the request: {_response_detail(response)}")


def send_audit_log_to_splunk_hec(audit_log: AuditLog) -> None:
    settings_obj = InstanceSplunkHecSettings.get_solo()

    if not settings_obj.enabled:
        return

    payload = build_audit_log_hec_payload(audit_log, settings_obj)
    send_payload_to_splunk_hec(settings_obj, payload)


def test_splunk_hec_connection(payload: dict[str, Any]) -> tuple[bool, str]:
    settings_obj = InstanceSplunkHecSettings()
    settings_obj.enabled = True
    settings_obj.endpoint = (payload.get("endpoint") or "").strip()
    settings_obj.index = (payload.get("index") or "").strip()
    settings_obj.source = ((payload.get("source") or "doko:audit").strip() or "doko:audit")
    settings_obj.sourcetype = ((payload.get("sourcetype") or "_json").strip() or "_json")
    settings_obj.set_token((payload.get("token") or "").strip())

    test_payload: dict[str, Any] = {
        "time": timezone.now().timestamp(),
        "host": socket.gethostname(),
        "source": settings_obj.source or "doko:audit",
        "sourcetype": settings_obj.sourcetype or "_json",
        "event": {
            "message": "doko splunk hec connectivity test",
            "kind": "connectivity_test",
            "application": "doko",
        },
    }

    if settings_obj.index:
        test_payload["index"] = settings_obj.index

    try:
        send_payload_to_splunk_hec(settings_obj, test_payload)
        return True, "Connection successful."
    except Exception as exc:
        return False, str(exc)