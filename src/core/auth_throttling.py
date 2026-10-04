import hashlib
import ipaddress
import logging
import time
from collections.abc import Mapping

from django.conf import settings
from django.core.cache import caches
from django.http import JsonResponse
from rest_framework.throttling import BaseThrottle


logger = logging.getLogger(__name__)


def client_address(request):
    peer = request.META.get("REMOTE_ADDR") or "unknown"
    networks = [ipaddress.ip_network(value.strip(), strict=False) for value in settings.DOKO_TRUSTED_PROXY_CIDRS if value.strip()]
    chain = (request.META.get("HTTP_X_FORWARDED_FOR") or "").split(",")
    for forwarded in reversed(chain):
        try:
            if not any(ipaddress.ip_address(peer) in network for network in networks):
                break
            peer = str(ipaddress.ip_address(forwarded.strip()))
        except ValueError:
            break
    return peer


def _increment(key):
    try:
        cache = caches["security"]
        if cache.add(key, 1, timeout=61):
            return 1
        return cache.incr(key)
    except Exception:
        logger.warning("Shared authentication rate limiter unavailable; using local fallback")
        cache = caches["default"]
        if cache.add(key, 1, timeout=61):
            return 1
        try:
            return cache.incr(key)
        except ValueError:
            cache.set(key, 1, timeout=61)
            return 1


def allow_auth_attempt(request, scope, subject, limit):
    window = int(time.time() // 60)
    subject = subject.strip().casefold()[:512] if isinstance(subject, str) else ""
    digest = hashlib.sha256(subject.encode()).hexdigest()
    account_count = _increment(f"auth:{scope}:account:{digest}:{window}")
    address = hashlib.sha256(client_address(request).encode()).hexdigest()
    ip_count = _increment(f"auth:ip:{address}:{window}")
    return account_count <= limit and ip_count <= settings.DOKO_AUTH_IP_PER_MINUTE


class AuthRateThrottle(BaseThrottle):
    scope = "login"
    field = "username"

    def allow_request(self, request, view):
        data = request.data if isinstance(request.data, Mapping) else {}
        limit = settings.DOKO_AUTH_LOGIN_PER_MINUTE if self.scope == "login" else settings.DOKO_AUTH_RESET_PER_MINUTE
        return allow_auth_attempt(request, self.scope, data.get(self.field, ""), limit)

    def wait(self):
        return max(1, 60 - int(time.time()) % 60)


class PasswordResetRateThrottle(AuthRateThrottle):
    scope = "reset"
    field = "uid"


class AdminLoginThrottleMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.method == "POST" and request.path_info.rstrip("/") == "/admin/login":
            if not allow_auth_attempt(request, "login", request.POST.get("username", ""), settings.DOKO_AUTH_LOGIN_PER_MINUTE):
                response = JsonResponse({"detail": "Too many login attempts. Please try again shortly."}, status=429)
                response["Retry-After"] = str(max(1, 60 - int(time.time()) % 60))
                return response
        return self.get_response(request)
