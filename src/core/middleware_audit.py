import time
import uuid
import json

from django.utils.deprecation import MiddlewareMixin

from .models import AuditLog
from .audit import audit_log


def _first(v):
    if isinstance(v, list) and v:
        return v[0]
    return v


def _safe_extract_login(request):
    try:
        if hasattr(request, "POST") and request.POST:
            username_in = (_first(request.POST.get("username")) or "").strip()
            email_in = (_first(request.POST.get("email")) or "").strip()
            return username_in, email_in
    except Exception:
        pass

    try:
        ct = (request.META.get("CONTENT_TYPE") or "").lower()
        body = request.body or b""
        if not body:
            return "", ""

        looks_json = ("application/json" in ct) or body.lstrip().startswith(b"{")
        if not looks_json:
            return "", ""

        payload = json.loads(body.decode("utf-8") or "{}") or {}
        username_in = (_first(payload.get("username")) or "").strip()
        email_in = (_first(payload.get("email")) or "").strip()
        return username_in, email_in
    except Exception:
        return "", ""


def _get_client_ip(request) -> str:
    return request.META.get("REMOTE_ADDR") or ""


def _audit_safe_create(**kwargs):
    try:
        AuditLog.objects.create(**kwargs)
    except Exception:
        pass


class AuditRequestMiddleware(MiddlewareMixin):
    def process_request(self, request):
        request.audit_request_id = uuid.uuid4()
        request._audit_t0 = time.time()

        path = getattr(request, "path", "") or ""
        method = (getattr(request, "method", "") or "").upper()
        if path.startswith("/api/auth/token/") and method == "POST":
            username_in, email_in = _safe_extract_login(request)
            request._audit_auth_username_in = username_in[:160]
            request._audit_auth_email_in = email_in[:160]
            request._audit_auth_login_in = (username_in or email_in or "")[:160]

    def process_response(self, request, response):
        t0 = getattr(request, "_audit_t0", None)
        duration_ms = None
        if t0 is not None:
            duration_ms = int((time.time() - t0) * 1000)
            request.audit_duration_ms = duration_ms

        path = getattr(request, "path", "") or ""
        method = (getattr(request, "method", "") or "").upper()
        status_code = getattr(response, "status_code", None)

        if path.startswith("/api/auth/token/") and method == "POST":
            username_in = getattr(request, "_audit_auth_username_in", "") or ""
            email_in = getattr(request, "_audit_auth_email_in", "") or ""
            login_in = getattr(request, "_audit_auth_login_in", "") or ""

            ok = bool(status_code) and 200 <= status_code < 300

            _audit_safe_create(
                actor=None,
                actor_username=(login_in[:160] if login_in else ""),
                action="auth.token",
                success=ok,
                status_code=status_code,
                method=method,
                path=path[:255],
                ip_address=_get_client_ip(request),
                user_agent=(request.META.get("HTTP_USER_AGENT") or "")[:255],
                request_id=getattr(request, "audit_request_id", None),
                duration_ms=duration_ms,
                object_type="auth",
                object_id="",
                object_repr="",
                metadata={
                    "outcome": "success" if ok else "fail",
                    "username_input": username_in[:160],
                    "email_input": email_in[:160],
                },
            )
            return response

        if path.startswith("/api/settings/") and method in {"POST", "PUT", "PATCH", "DELETE"}:
            try:
                audit_log(
                    request,
                    action="settings.request",
                    success=(200 <= (status_code or 500) < 400),
                    status_code=status_code,
                    metadata={"method": method, "path": path},
                )
            except Exception:
                pass

        return response

    def process_exception(self, request, exception):
        try:
            path = getattr(request, "path", "") or ""
            if path.startswith("/api/"):
                audit_log(
                    request,
                    action="request.exception",
                    success=False,
                    status_code=500,
                    metadata={"error": str(exception)[:500]},
                )
        except Exception:
            pass
        return None
