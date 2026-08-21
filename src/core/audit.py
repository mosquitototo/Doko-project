from __future__ import annotations
from typing import Any, Optional
from uuid import UUID

from .models import AuditLog



def _get_ip(request) -> str:
    if request is None:
        return ""
    return request.META.get("REMOTE_ADDR") or ""


SENSITIVE_METADATA_KEYS = {
    "password",
    "current_password",
    "new_password",
    "token",
    "api_key",
    "apikey",
    "secret",
    "authorization",
    "cookie",
    "set-cookie",
    "token_key",
    "email",
    "content",
    "text",
    "body",
    "payload",
    "request_payload",
    "response_payload",
    "description",
    "subject",
    "message",
    "prompt",
    "output",
    "output_payload",
    "variables",
    "iocs",
    "assets",
    "error",
}


def _is_sensitive_metadata_key(key):
    normalized = str(key or "").lower().replace("-", "_")
    return any(
        sensitive == normalized or sensitive in normalized
        for sensitive in SENSITIVE_METADATA_KEYS
    )


def sanitize_audit_metadata(value, depth=0):
    if depth >= 6:
        return "[truncated]"

    if isinstance(value, dict):
        out = {}
        for k, v in list(value.items())[:100]:
            key = str(k)
            if _is_sensitive_metadata_key(key):
                out[key] = "[redacted]"
            else:
                out[key] = sanitize_audit_metadata(v, depth + 1)
        return out

    if isinstance(value, list):
        return [sanitize_audit_metadata(item, depth + 1) for item in value[:100]]

    if isinstance(value, str):
        return value[:500]

    return value


def audit_log(
    request,
    *,
    action: str,
    success: bool = True,
    status_code: Optional[int] = None,
    object_type: str = "",
    object_id: str = "",
    object_repr: str = "",
    metadata: Optional[dict[str, Any]] = None,
    actor_override=None,
    actor_username_override: Optional[str] = None,
):
    user = getattr(request, "user", None)
    authed_actor = user if getattr(user, "is_authenticated", False) else None

    actor = actor_override if actor_override is not None else authed_actor

    if actor_username_override is not None:
        actor_username = (actor_username_override or "")[:160]
    else:
        actor_username = getattr(actor, "username", "") if actor else ""

    rid = getattr(request, "audit_request_id", None)
    if isinstance(rid, str):
        try:
            rid = UUID(rid)
        except Exception:
            rid = None

    AuditLog.objects.create(
        actor=actor,
        actor_username=actor_username,
        action=action,
        success=bool(success),
        status_code=status_code,
        object_type=object_type or "",
        object_id=object_id or "",
        object_repr="",
        ip_address=_get_ip(request),
        user_agent=(request.META.get("HTTP_USER_AGENT") or "")[:255],
        method=(request.method or "")[:12],
        path=(request.path or "")[:255],
        request_id=rid,
        duration_ms=getattr(request, "audit_duration_ms", None),
        metadata=sanitize_audit_metadata(metadata or {}),
    )


def audit_event(
    request,
    *,
    action: str,
    object_type: str,
    object_id: str,
    object_repr: str = "",
    success: bool = True,
    status_code: Optional[int] = None,
    metadata: Optional[dict[str, Any]] = None,
):
    audit_log(
        request,
        action=action,
        success=success,
        status_code=status_code,
        object_type=object_type,
        object_id=str(object_id or ""),
        object_repr=(object_repr or "")[:255],
        metadata=sanitize_audit_metadata(metadata or {}),
    )
