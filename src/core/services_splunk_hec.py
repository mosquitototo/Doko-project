from __future__ import annotations

import socket
from typing import Any

import requests
from django.utils import timezone

from .audit import sanitize_audit_metadata
from .crypto_secrets import SecretEncryptionError
from .models import AuditLog, InstanceSplunkHecSettings
from .outbound_proxy import build_outbound_proxies


class SplunkHecError(RuntimeError):
    pass


def _validate_response(response: requests.Response) -> None:
    try:
        body = response.json()
    except ValueError:
        body = None
    status = f"HTTP {response.status_code}"
    code = body.get("code") if isinstance(body, dict) else None
    if type(code) is not int:
        raise SplunkHecError(f"Splunk HEC returned an invalid response ({status}): expected a JSON HEC status code.")
    if 200 <= response.status_code < 300 and code in (0, 24, 25):
        if "ackId" in body or code == 25:
            raise SplunkHecError("Splunk HEC accepted the event but requires indexer acknowledgment, which Doko does not support. Indexing has not been confirmed.")
        return
    messages = {
        1: "Token is disabled.",
        2: "Token is required.",
        3: "Invalid authorization.",
        4: "Invalid token.",
        5: "No event data received.",
        6: "Invalid event format.",
        7: "Incorrect or unauthorized index.",
        8: "Splunk internal server error.",
        9: "Splunk is busy.",
        10: "Data channel required: indexer acknowledgment and raw endpoints are not supported by this exporter.",
        11: "Invalid data channel.",
        12: "Event field is required.",
        13: "Event field cannot be blank.",
        14: "Indexer acknowledgment is disabled on Splunk.",
        15: "Splunk could not process indexed fields.",
        16: "Query string authorization is disabled on Splunk.",
        17: "The endpoint returned health status, not event acceptance.",
        18: "Splunk queues are full.",
        19: "Indexer acknowledgment is unavailable on Splunk.",
        20: "Splunk queues are full and indexer acknowledgment is unavailable.",
        21: "Invalid token.",
        22: "Token is disabled.",
        23: "Splunk HEC is shutting down.",
        26: "Splunk queue capacity is exhausted; the event was not accepted.",
        27: "Splunk indexer acknowledgment channel capacity is exhausted.",
    }
    raise SplunkHecError(f"Splunk HEC rejected the request ({status}, HEC code {code}): {messages.get(code, 'Check the collector configuration and Splunk logs.')}")


def _is_dns_error(error: BaseException) -> bool:
    pending = [error]
    seen = set()
    while pending:
        current = pending.pop()
        if id(current) in seen:
            continue
        seen.add(id(current))
        if isinstance(current, socket.gaierror):
            return True
        pending.extend(value for value in (
            current.__cause__, current.__context__, getattr(current, "reason", None), *current.args
        ) if isinstance(value, BaseException))
    return False


def build_audit_log_hec_payload(audit_log: AuditLog, settings_obj: InstanceSplunkHecSettings) -> dict[str, Any]:
    event = {
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
    if not settings_obj.enabled:
        return

    try:
        token = settings_obj.get_token()
    except SecretEncryptionError:
        raise SplunkHecError("Unable to decrypt the Splunk HEC token. Check the secret encryption configuration on web and workers.") from None

    if not endpoint:
        raise SplunkHecError("Splunk HEC endpoint is required.")

    if not token:
        raise SplunkHecError("Splunk HEC token is required.")

    try:
        response = requests.post(
            endpoint,
            headers={
                "Authorization": f"Splunk {token}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=10,
            verify=settings_obj.verify_ssl,
            proxies=build_outbound_proxies(),
        )
    except requests.exceptions.SSLError:
        raise SplunkHecError("Splunk HEC TLS negotiation or certificate verification failed.") from None
    except requests.exceptions.ProxyError:
        raise SplunkHecError("Unable to connect through the outbound proxy. Check Doko and environment proxy settings.") from None
    except requests.exceptions.ConnectTimeout:
        raise SplunkHecError("Connection timeout while contacting Splunk HEC (10 seconds).") from None
    except requests.exceptions.ReadTimeout:
        raise SplunkHecError("Response timeout while waiting for Splunk HEC (10 seconds without a response).") from None
    except requests.exceptions.Timeout:
        raise SplunkHecError("Splunk HEC request timed out.") from None
    except requests.exceptions.ConnectionError as exc:
        if _is_dns_error(exc):
            raise SplunkHecError("DNS resolution failed while contacting Splunk HEC. Check hostname resolution in the sending container.") from None
        raise SplunkHecError("Splunk HEC connection failed or was interrupted. Check the host, port, protocol and network path.") from None
    except (requests.exceptions.InvalidURL, requests.exceptions.InvalidSchema, requests.exceptions.MissingSchema):
        raise SplunkHecError("Invalid Splunk HEC URL. Use an HTTP or HTTPS URL.") from None
    except requests.RequestException:
        raise SplunkHecError("Splunk HEC HTTP request failed. Check the endpoint and outbound connection settings.") from None
    except SecretEncryptionError:
        raise SplunkHecError("Unable to decrypt outbound proxy credentials. Check the secret encryption configuration on web and workers.") from None

    _validate_response(response)


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
    settings_obj.verify_ssl = payload.get("verify_ssl", True)
    settings_obj.index = (payload.get("index") or "").strip()
    settings_obj.source = ((payload.get("source") or "doko:audit").strip() or "doko:audit")
    settings_obj.sourcetype = ((payload.get("sourcetype") or "_json").strip() or "_json")

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
        settings_obj.set_token((payload.get("token") or "").strip())
        send_payload_to_splunk_hec(settings_obj, test_payload)
        return True, "Connection successful."
    except SplunkHecError as exc:
        return False, str(exc)
    except Exception:
        return False, "Unable to test Splunk HEC. Check the instance and secret encryption configuration."
