import time
import logging

from django.contrib.auth import (
    authenticate,
    get_user_model,
    login as django_login,
    logout as django_logout,
)
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.middleware.csrf import get_token
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.utils.decorators import method_decorator
from django.utils.encoding import force_str
from django.utils.http import urlsafe_base64_decode
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie

from knox.models import AuthToken

from rest_framework import permissions, status
from rest_framework.authentication import SessionAuthentication
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.throttling import AnonRateThrottle

from .models import AuditLog



logger = logging.getLogger(__name__)
User = get_user_model()


class AuthRateThrottle(AnonRateThrottle):
    rate = "10/minute"


class PasswordResetRateThrottle(AnonRateThrottle):
    rate = "5/minute"


def get_client_ip(request) -> str:
    return request.META.get("REMOTE_ADDR") or ""


def audit_safe_create(**kwargs):
    try:
        AuditLog.objects.create(**kwargs)
    except Exception:
        logger.exception("AuditLog create failed (auth)")


def get_request_meta(request):
    ip = get_client_ip(request)
    ua = (request.META.get("HTTP_USER_AGENT") or "")[:255]
    path = (request.path or "")[:255]
    method = (request.method or "")[:12]
    return ip, ua, path, method


def authenticate_from_payload(request):
    import hashlib

    username_in = (request.data.get("username") or "").strip()
    password = request.data.get("password") or ""

    login_in_trunc = username_in[:160]

    if not username_in or not password:
        hashlib.pbkdf2_hmac("sha256", b"dummy", b"doko-timing-salt", 1000)
        return None, {
            "username_in": username_in,
            "email_in": "",
            "login_in_trunc": login_in_trunc,
            "reason": "missing_fields",
        }

    user = authenticate(request, username=username_in, password=password)

    if not user:
        return None, {
            "username_in": username_in,
            "email_in": "",
            "login_in_trunc": login_in_trunc,
            "reason": "invalid_credentials",
        }

    if not getattr(user, "is_active", False):
        return None, {
            "username_in": username_in,
            "email_in": "",
            "login_in_trunc": login_in_trunc,
            "reason": "inactive_user",
        }

    return user, {
        "username_in": username_in,
        "email_in": "",
        "login_in_trunc": login_in_trunc,
        "reason": "",
    }


MAX_API_TOKENS_PER_USER = 3


def _parse_bool(value):
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _api_token_limit_reached(user) -> bool:
    return AuthToken.objects.filter(user=user).count() >= MAX_API_TOKENS_PER_USER


def _token_limit_response():
    return Response(
        {
            "detail": (
                f"Maximum API token limit reached. "
                f"Revoke an existing token before creating a new one."
            )
        },
        status=status.HTTP_400_BAD_REQUEST,
    )


def _parse_token_expiry_payload(data):
    never_expire = _parse_bool(data.get("never_expire") or data.get("never_expires"))

    if never_expire:
        return None, True, None

    expires_at_raw = (data.get("expires_at") or "").strip()

    if not expires_at_raw:
        return None, False, None

    expiry = parse_datetime(expires_at_raw)

    if not expiry:
        return None, False, Response(
            {"detail": "Invalid expires_at datetime."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if timezone.is_naive(expiry):
        expiry = timezone.make_aware(expiry, timezone.get_current_timezone())

    if expiry <= timezone.now():
        return None, False, Response(
            {"detail": "expires_at must be in the future."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    return expiry, False, None


@method_decorator(ensure_csrf_cookie, name="dispatch")
class CsrfCookieView(APIView):
    authentication_classes = []
    permission_classes = []

    def get(self, request, *args, **kwargs):
        return Response({"csrfToken": get_token(request)}, status=status.HTTP_200_OK)


@method_decorator(csrf_protect, name="dispatch")
class SessionLoginView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = [AuthRateThrottle]

    def post(self, request, *args, **kwargs):
        t0 = time.time()
        ip, ua, path, method = get_request_meta(request)

        user, ctx = authenticate_from_payload(request)
        login_in_trunc = ctx["login_in_trunc"]

        audit_safe_create(
            actor=None,
            actor_username=login_in_trunc,
            action="auth.session_login",
            success=False,
            status_code=None,
            method=method,
            path=path,
            ip_address=ip,
            user_agent=ua,
            duration_ms=None,
            object_type="auth",
            object_id="",
            object_repr="",
            metadata={
                "outcome": "attempt",
                "username_input": ctx["username_in"][:160],
                "email_input": ctx["email_in"][:160],
            },
        )

        if not user:
            audit_safe_create(
                actor=None,
                actor_username=login_in_trunc,
                action="auth.session_login",
                success=False,
                status_code=400,
                method=method,
                path=path,
                ip_address=ip,
                user_agent=ua,
                duration_ms=int((time.time() - t0) * 1000),
                object_type="auth",
                object_id="",
                object_repr="",
                metadata={
                    "outcome": "fail",
                    "reason": ctx["reason"],
                    "username_input": ctx["username_in"][:160],
                    "email_input": ctx["email_in"][:160],
                },
            )
            return Response(
                {"non_field_errors": ["Unable to log in with provided credentials."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        django_login(request, user)

        audit_safe_create(
            actor=user,
            actor_username=(getattr(user, "username", "") or "")[:160],
            action="auth.session_login",
            success=True,
            status_code=200,
            method=method,
            path=path,
            ip_address=ip,
            user_agent=ua,
            duration_ms=int((time.time() - t0) * 1000),
            object_type="auth",
            object_id=str(getattr(user, "id", ""))[:80],
            object_repr=(getattr(user, "username", "") or "")[:255],
            metadata={
                "outcome": "success",
                "username_input": ctx["username_in"][:160],
                "email_input": ctx["email_in"][:160],
            },
        )

        return Response(
            {
                "ok": True,
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                },
            },
            status=status.HTTP_200_OK,
        )


@method_decorator(csrf_protect, name="dispatch")
class SessionLogoutView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, *args, **kwargs):
        t0 = time.time()
        ip, ua, path, method = get_request_meta(request)
        user = request.user

        django_logout(request)

        audit_safe_create(
            actor=user,
            actor_username=(getattr(user, "username", "") or "")[:160],
            action="auth.session_logout",
            success=True,
            status_code=204,
            method=method,
            path=path,
            ip_address=ip,
            user_agent=ua,
            duration_ms=int((time.time() - t0) * 1000),
            object_type="auth",
            object_id=str(getattr(user, "id", ""))[:80],
            object_repr=(getattr(user, "username", "") or "")[:255],
            metadata={"outcome": "success"},
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


class AuthTokenWithAuditView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = [AuthRateThrottle]

    def post(self, request, *args, **kwargs):
        ip, ua, path, method = get_request_meta(request)

        audit_safe_create(
            actor=None,
            actor_username="",
            action="auth.api_token",
            success=False,
            status_code=405,
            method=method,
            path=path,
            ip_address=ip,
            user_agent=ua,
            duration_ms=0,
            object_type="auth",
            object_id="",
            object_repr="",
            metadata={
                "outcome": "disabled",
                "reason": "api_token_creation_requires_authenticated_session",
            },
        )

        return Response(
            {"detail": "API token creation is only available from an authenticated session."},
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )


class ApiTokenListCreateView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, *args, **kwargs):
        tokens = AuthToken.objects.filter(user=request.user).order_by("-created")

        data = [
            {
                "id": token.token_key,
                "token_key": token.token_key,
                "created": token.created,
                "expiry": token.expiry,
            }
            for token in tokens
        ]

        return Response(data, status=status.HTTP_200_OK)

    def post(self, request, *args, **kwargs):
        t0 = time.time()
        ip, ua, path, method = get_request_meta(request)

        if _api_token_limit_reached(request.user):
            return _token_limit_response()

        expiry, never_expire, error_response = _parse_token_expiry_payload(request.data or {})

        if error_response is not None:
            return error_response

        token_instance, raw_token = AuthToken.objects.create(user=request.user)

        if never_expire or expiry is not None:
            token_instance.expiry = None if never_expire else expiry
            token_instance.save(update_fields=["expiry"])

        audit_safe_create(
            actor=request.user,
            actor_username=(getattr(request.user, "username", "") or "")[:160],
            action="auth.api_token_create",
            success=True,
            status_code=201,
            method=method,
            path=path,
            ip_address=ip,
            user_agent=ua,
            duration_ms=int((time.time() - t0) * 1000),
            object_type="auth_token",
            object_id=(token_instance.token_key or "")[:80],
            object_repr=(token_instance.token_key or "")[:255],
            metadata={
                "outcome": "success",
                "token_key": token_instance.token_key,
                "expiry": token_instance.expiry.isoformat() if token_instance.expiry else None,
                "never_expire": bool(never_expire),
            },
        )

        return Response(
            {
                "id": token_instance.token_key,
                "token": raw_token,
                "token_key": token_instance.token_key,
                "created": token_instance.created,
                "expiry": token_instance.expiry,
            },
            status=status.HTTP_201_CREATED,
        )


class ApiTokenRevokeView(APIView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, token_key: str, *args, **kwargs):
        t0 = time.time()
        ip, ua, path, method = get_request_meta(request)

        token_instance = AuthToken.objects.filter(
            user=request.user,
            token_key=token_key,
        ).first()
        if not token_instance:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        token_key = token_instance.token_key
        object_id = str(getattr(token_instance, "pk", ""))[:80]
        object_repr = (token_key or "")[:255]
        token_instance.delete()

        audit_safe_create(
            actor=request.user,
            actor_username=(getattr(request.user, "username", "") or "")[:160],
            action="auth.api_token_revoke",
            success=True,
            status_code=204,
            method=method,
            path=path,
            ip_address=ip,
            user_agent=ua,
            duration_ms=int((time.time() - t0) * 1000),
            object_type="auth_token",
            object_id=object_id,
            object_repr=object_repr,
            metadata={
                "outcome": "success",
                "token_key": token_key,
            },
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


###### reset pwd token
token_generator = PasswordResetTokenGenerator()


class PasswordResetConfirmView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = [PasswordResetRateThrottle]

    def post(self, request, *args, **kwargs):
        t0 = time.time()

        uid = (request.data.get("uid") or "").strip()
        token = (request.data.get("token") or "").strip()
        new_password = request.data.get("new_password") or ""

        ip = get_client_ip(request)
        ua = (request.META.get("HTTP_USER_AGENT") or "")[:255]
        path = (request.path or "")[:255]
        method = (request.method or "")[:12]

        audit_safe_create(
            actor=None,
            actor_username="",
            action="auth.password_reset_confirm",
            success=False,
            status_code=None,
            method=method,
            path=path,
            ip_address=ip,
            user_agent=ua,
            duration_ms=None,
            object_type="auth",
            object_id="",
            object_repr="",
            metadata={"outcome": "attempt"},
        )

        if not uid or not token or not new_password:
            audit_safe_create(
                actor=None,
                actor_username="",
                action="auth.password_reset_confirm",
                success=False,
                status_code=400,
                method=method,
                path=path,
                ip_address=ip,
                user_agent=ua,
                duration_ms=int((time.time() - t0) * 1000),
                object_type="auth",
                object_id="",
                object_repr="",
                metadata={"outcome": "fail", "reason": "missing_fields"},
            )
            return Response(
                {"error": "uid, token and new_password are required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user_id = force_str(urlsafe_base64_decode(uid))
            u = User.objects.get(pk=user_id)
        except Exception:
            audit_safe_create(
                actor=None,
                actor_username="",
                action="auth.password_reset_confirm",
                success=False,
                status_code=400,
                method=method,
                path=path,
                ip_address=ip,
                user_agent=ua,
                duration_ms=int((time.time() - t0) * 1000),
                object_type="auth",
                object_id="",
                object_repr="",
                metadata={"outcome": "fail", "reason": "invalid_uid"},
            )
            return Response({"error": "invalid link"}, status=status.HTTP_400_BAD_REQUEST)

        if not getattr(u, "is_active", False):
            audit_safe_create(
                actor=None,
                actor_username=(getattr(u, "username", "") or "")[:160],
                action="auth.password_reset_confirm",
                success=False,
                status_code=400,
                method=method,
                path=path,
                ip_address=ip,
                user_agent=ua,
                duration_ms=int((time.time() - t0) * 1000),
                object_type="user",
                object_id=str(getattr(u, "id", ""))[:80],
                object_repr=(getattr(u, "username", "") or "")[:255],
                metadata={"outcome": "fail", "reason": "inactive_user"},
            )
            return Response({"error": "invalid or expired link"}, status=status.HTTP_400_BAD_REQUEST)

        if not token_generator.check_token(u, token):
            audit_safe_create(
                actor=None,
                actor_username=(getattr(u, "username", "") or "")[:160],
                action="auth.password_reset_confirm",
                success=False,
                status_code=400,
                method=method,
                path=path,
                ip_address=ip,
                user_agent=ua,
                duration_ms=int((time.time() - t0) * 1000),
                object_type="user",
                object_id=str(getattr(u, "id", ""))[:80],
                object_repr=(getattr(u, "username", "") or "")[:255],
                metadata={"outcome": "fail", "reason": "invalid_or_expired_token"},
            )
            return Response({"error": "invalid or expired link"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            validate_password(new_password, user=u)
        except Exception as e:
            msg = str(getattr(e, "messages", [str(e)])[0])
            audit_safe_create(
                actor=None,
                actor_username=(getattr(u, "username", "") or "")[:160],
                action="auth.password_reset_confirm",
                success=False,
                status_code=400,
                method=method,
                path=path,
                ip_address=ip,
                user_agent=ua,
                duration_ms=int((time.time() - t0) * 1000),
                object_type="user",
                object_id=str(getattr(u, "id", ""))[:80],
                object_repr=(getattr(u, "username", "") or "")[:255],
                metadata={"outcome": "fail", "reason": "password_validation"},
            )
            return Response({"error": msg}, status=status.HTTP_400_BAD_REQUEST)

        u.set_password(new_password)
        u.save(update_fields=["password"])
        AuthToken.objects.filter(user=u).delete()

        audit_safe_create(
            actor=None,
            actor_username=(getattr(u, "username", "") or "")[:160],
            action="auth.password_reset_confirm",
            success=True,
            status_code=200,
            method=method,
            path=path,
            ip_address=ip,
            user_agent=ua,
            duration_ms=int((time.time() - t0) * 1000),
            object_type="user",
            object_id=str(getattr(u, "id", ""))[:80],
            object_repr=(getattr(u, "username", "") or "")[:255],
            metadata={"outcome": "success"},
        )

        return Response({"info": "password updated"}, status=status.HTTP_200_OK)