import time
import uuid

from django.utils.deprecation import MiddlewareMixin

from .audit import audit_log


class AuditRequestMiddleware(MiddlewareMixin):
    def process_request(self, request):
        request.audit_request_id = uuid.uuid4()
        request._audit_t0 = time.time()


    def process_response(self, request, response):
        t0 = getattr(request, "_audit_t0", None)
        duration_ms = None
        if t0 is not None:
            duration_ms = int((time.time() - t0) * 1000)
            request.audit_duration_ms = duration_ms

        path = getattr(request, "path", "") or ""
        method = (getattr(request, "method", "") or "").upper()
        status_code = getattr(response, "status_code", None)

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
                    metadata={"exception_type": type(exception).__name__},
                )
        except Exception:
            pass
        return None
