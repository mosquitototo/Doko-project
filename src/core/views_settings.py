from django.contrib.auth import get_user_model
from django.conf import settings
from django.contrib.auth.tokens import PasswordResetTokenGenerator
from django.db import transaction
from django.db.models import Q
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.db.models.deletion import ProtectedError
from django.http import FileResponse, Http404, HttpResponse

from pathlib import Path
import re
import csv
import io
import json
import requests

from rest_framework import generics, status, permissions
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.exceptions import ValidationError, PermissionDenied

from knox.models import AuthToken

from .outbound_proxy import build_outbound_proxies
from .celerysettings import *
from .models import (
    Role,
    UserRole,
    Permission,
    CaseRetentionSettings,
    AuditLog,
    Customer,
    CustomerAccess,
    AIProvider,
    SOARProvider,
    InvestigationTemplate,
    InstanceProxySettings,
    InstanceSplunkHecSettings,
    InstanceBackup,
    AutomationRule,
    Severity,
    Classification,
    CaseExchangeReplyQuickpart,
    WorkbookTemplate,
)
from .permissions import HasPermissionCode, CanManageInstanceSettings
from .serializers import AuditLogSerializer
from .serializers_chat import (AIProviderSerializer, SOARProviderSerializer, InvestigationTemplateSerializer,)
from .rbac import user_has_perm
from .audit import audit_event
from .instance_backups import create_database_backup, restore_database_backup
from .services_splunk_hec import test_splunk_hec_connection
from .serializers_settings import (
    RoleSerializer,
    PermissionSerializer,
    CaseRetentionSettingsSerializer,
    RoleCustomerAccessUpdateSerializer,
    InstanceBackupSerializer,
    InstanceProxySettingsSerializer,
    RestoreBackupSerializer,
    SettingsUserApiTokenSerializer,
    AutomationRuleSerializer,
)


CHAT_COMMAND_RE = re.compile(r"^/[a-z0-9_:-]+$")

def _normalize_chat_command(value: str) -> str | None:
    command = (value or "").strip().lower()
    if not command:
        return None
    if not command.startswith("/"):
        raise ValidationError({"chat_command": "Chat command must start with '/'."})
    if not CHAT_COMMAND_RE.match(command):
        raise ValidationError({
            "chat_command": "Chat command may only contain lowercase letters, digits, '_', '-' or ':'."
        })
    return command


def _validate_chat_command_uniqueness(*, command: str, is_enabled: bool, instance=None) -> None:
    if not command or not is_enabled:
        return

    qs = InvestigationTemplate.objects.filter(chat_command=command, is_enabled=True)
    if instance is not None:
        qs = qs.exclude(pk=instance.pk)

    if qs.exists():
        raise ValidationError({"chat_command": "This chat command is already used by another enabled template."})
    

User = get_user_model()


def _parse_bool(value):
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


MAX_API_TOKENS_PER_USER = 3


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


def _normalize_splunk_hec_payload(data):
    if not hasattr(data, "get"):
        data = {}

    nested = data.get("splunk_hec") or data.get("splunkHec") or {}
    if not isinstance(nested, dict):
        nested = {}

    def pick(*keys, default=""):
        for key in keys:
            value = data.get(key, None)
            if value not in (None, ""):
                return value

        for key in keys:
            value = nested.get(key, None)
            if value not in (None, ""):
                return value

        return default

    return {
        "enabled": _parse_bool(pick("enabled", default=False)),
        "endpoint": str(pick("endpoint", "hec_endpoint", "hecEndpoint")).strip(),
        "token": str(pick("token", "hec_token", "hecToken")).strip(),
        "index": str(pick("index")).strip(),
        "source": (str(pick("source", default="doko:audit")).strip() or "doko:audit"),
        "sourcetype": (str(pick("sourcetype", "source_type", "sourceType", default="_json")).strip() or "_json"),
    }


def _test_splunk_hec_connection(payload):
    endpoint = payload.get("endpoint", "").strip()
    token = payload.get("token", "").strip()

    if not endpoint:
        return False, "Splunk HEC endpoint is required."
    if not token:
        return False, "Splunk HEC token is required."

    headers = {
        "Authorization": f"Splunk {token}",
        "Content-Type": "application/json",
    }

    event_payload = {
        "event": {
            "message": "doko splunk hec connectivity test",
            "kind": "connectivity_test",
        },
        "source": payload.get("source") or "doko:audit",
        "sourcetype": payload.get("sourcetype") or "_json",
    }

    if payload.get("index"):
        event_payload["index"] = payload["index"]

    try:
        response = requests.post(
            endpoint,
            headers=headers,
            json=event_payload,
            timeout=10,
            proxies=build_outbound_proxies(),
        )
    except requests.RequestException as exc:
        return False, f"Unable to reach Splunk HEC: {exc}"

    if 200 <= response.status_code < 300:
        return True, "Connection successful."

    detail = ""
    try:
        body = response.json()
        detail = body.get("text") or body.get("message") or ""
    except Exception:
        detail = (response.text or "").strip()

    if detail:
        return False, f"Splunk HEC rejected the request: {detail}"
    return False, f"Splunk HEC rejected the request with status {response.status_code}."


def _get_splunk_hec_settings():
    return InstanceSplunkHecSettings.get_solo().to_public_dict()


###### reset pwd token
token_generator = PasswordResetTokenGenerator()

def _frontend_base_url(request) -> str:
    base = (getattr(settings, "FRONTEND_BASE_URL", "") or "").strip()
    if base:
        return base.rstrip("/")
    return request.build_absolute_uri("/").rstrip("/")


class SettingsUserListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = (
            "settings.access.users.view"
            if request.method == "GET"
            else "settings.access.users.manage"
        )
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        qs = User.objects.all().order_by("username")
        q = self.request.query_params.get("q", "").strip()
        include_inactive = self.request.query_params.get("include_inactive") == "1"

        if q:
            qs = qs.filter(username__icontains=q)

        if not include_inactive:
            qs = qs.filter(is_active=True)

        return qs

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        data = [{
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "is_active": u.is_active,
            "is_staff": u.is_staff,
        } for u in qs[:500]]
        return Response({"results": data, "count": qs.count()})

    @transaction.atomic
    def create(self, request, *args, **kwargs):


        username = (request.data.get("username") or "").strip()
        email = (request.data.get("email") or "").strip()
        password = request.data.get("password") or ""

        if not username or not password:
            return Response({"error": "username and password are required"}, status=400)

        if User.objects.filter(username=username).exists():
            return Response({"error": "username already exists"}, status=409)

        u = User(username=username, email=email, is_active=True)
        u.set_password(password)
        u.save()

        audit_event(
            request,
            action="settings.user.created",
            object_type="user",
            object_id=str(u.id),
            object_repr=u.username or "",
            status_code=201,
            metadata={
                "target_user_id": u.id,
                "target_username": u.username,
                "email": u.email,
                "is_active": u.is_active,
                "is_staff": u.is_staff,
            },
        )

        return Response({
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "is_active": u.is_active,
            "is_staff": u.is_staff,
        }, status=201)


class SettingsUserRetrieveUpdateView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    queryset = User.objects.all()

    def initial(self, request, *args, **kwargs):
        self.required_permission = (
            "settings.access.users.view"
            if request.method == "GET"
            else "settings.access.users.manage"
        )
        super().initial(request, *args, **kwargs)

    def retrieve(self, request, *args, **kwargs):
        u = self.get_object()
        role_ids = list(UserRole.objects.filter(user=u).values_list("role_id", flat=True))
        return Response({
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "is_active": u.is_active,
            "is_staff": u.is_staff,
            "role_ids": role_ids,
        })

    def update(self, request, *args, **kwargs):
        u = self.get_object()

        before = {
            "username": u.username,
            "email": u.email,
            "is_active": u.is_active,
            "is_staff": u.is_staff,
            "role_ids": list(UserRole.objects.filter(user=u).values_list("role_id", flat=True)),
        }

        username = request.data.get("username")
        email = request.data.get("email")
        is_staff = request.data.get("is_staff")
        is_active = request.data.get("is_active")

        role_ids = request.data.get("role_ids", None)
        
        if role_ids is not None and not user_has_perm(request.user, "settings.access.roles.manage"):
            raise PermissionDenied("Only role managers can change user roles.")

        if username is not None:
            username = username.strip()
            if not username:
                return Response({"error": "username cannot be empty"}, status=400)
            if User.objects.exclude(id=u.id).filter(username=username).exists():
                return Response({"error": "username already exists"}, status=409)
            u.username = username

        if email is not None:
            u.email = (email or "").strip()

        if is_staff is not None:
            if not user_has_perm(request.user, "settings.instance.manage"):
                raise PermissionDenied("Only instance managers can change staff status.")
            if u.id == request.user.id:
                raise PermissionDenied("You cannot change your own staff status.")
            u.is_staff = bool(is_staff)

        if is_active is not None:
            next_is_active = bool(is_active)
            if u.id == request.user.id and not next_is_active:
                raise PermissionDenied("You cannot disable yourself.")
            u.is_active = next_is_active

        u.save()

        if role_ids is not None:
            if u.id == request.user.id:
                raise PermissionDenied("You cannot change your own roles.")

            if not isinstance(role_ids, list) or not all(isinstance(x, int) for x in role_ids):
                return Response({"error": "role_ids must be a list of integers"}, status=400)

            valid_role_ids = set(Role.objects.filter(id__in=role_ids).values_list("id", flat=True))
            if len(valid_role_ids) != len(set(role_ids)):
                return Response({"error": "unknown role id in role_ids"}, status=400)

            UserRole.objects.filter(user=u).exclude(role_id__in=valid_role_ids).delete()
            existing = set(UserRole.objects.filter(user=u).values_list("role_id", flat=True))
            to_add = valid_role_ids - existing
            UserRole.objects.bulk_create([UserRole(user=u, role_id=rid) for rid in to_add])

        final_role_ids = list(UserRole.objects.filter(user=u).values_list("role_id", flat=True))

        audit_event(
            request,
            action="settings.user.updated",
            object_type="user",
            object_id=str(u.id),
            object_repr=u.username or "",
            metadata={
                "target_user_id": u.id,
                "target_username": u.username,
                "before": before,
                "after": {
                    "username": u.username,
                    "email": u.email,
                    "is_active": u.is_active,
                    "is_staff": u.is_staff,
                    "role_ids": final_role_ids,
                },
            },
        )

        return Response({
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "is_active": u.is_active,
            "is_staff": u.is_staff,
            "role_ids": final_role_ids,
        })


class SettingsUserResetPasswordView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "settings.access.users.manage"

    def post(self, request, pk: int):
        u = generics.get_object_or_404(User, pk=pk)
        if u.is_staff and not user_has_perm(request.user, "settings.instance.manage"):
            raise PermissionDenied("Only instance managers can reset admin passwords.")
        
        new_password = request.data.get("password") or ""
        if not new_password:
            return Response({"error": "password is required"}, status=400)

        u.set_password(new_password)
        u.save(update_fields=["password"])

        audit_event(
            request,
            action="settings.user.password_reset",
            object_type="user",
            object_id=str(u.id),
            object_repr=u.username or "",
            metadata={
                "target_user_id": u.id,
                "target_username": u.username,
            },
        )

        return Response({"info": "password updated"}, status=200)


class SettingsUserPasswordResetLinkView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "settings.access.users.manage"

    def post(self, request, pk: int):
        u = generics.get_object_or_404(User, pk=pk)

        if not u.is_active:
            return Response({"error": "user is inactive"}, status=400)

        uid = urlsafe_base64_encode(force_bytes(u.pk))
        token = token_generator.make_token(u)

        base = _frontend_base_url(request)

        path = f"/reset-password?uid={uid}&token={token}"

        audit_event(
            request,
            action="settings.user.password_reset_link_generated",
            object_type="user",
            object_id=str(u.id),
            object_repr=u.username or "",
            metadata={
                "target_user_id": u.id,
                "target_username": u.username,
            },
        )

        return Response(
            {
                "path": path,
                "uid": uid,
                "token": token,
                "info": "reset link generated",
            },
            status=200,
        )
    

class SettingsUserDisableView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "settings.access.users.delete"

    def post(self, request, pk: int):
        u = generics.get_object_or_404(User, pk=pk)

        if u.id == request.user.id:
            return Response({"error": "cannot disable yourself"}, status=400)
        
        if u.is_staff and not user_has_perm(request.user, "settings.instance.manage"):
            raise PermissionDenied("Only instance managers can disable staff users.")

        u.is_active = False
        u.save(update_fields=["is_active"])

        audit_event(
            request,
            action="settings.user.disabled",
            object_type="user",
            object_id=str(u.id),
            object_repr=u.username or "",
            metadata={
                "target_user_id": u.id,
                "target_username": u.username,
                "is_active": u.is_active,
            },
        )

        return Response({"info": "user disabled"}, status=200)


class SettingsUserApiTokenListCreateView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "settings.access.users.manage"

    def get(self, request, pk: int):
        u = generics.get_object_or_404(User, pk=pk)

        tokens = AuthToken.objects.filter(user=u).order_by("-created")
        data = SettingsUserApiTokenSerializer(tokens, many=True).data
        return Response(data, status=status.HTTP_200_OK)

    def post(self, request, pk: int):
        u = generics.get_object_or_404(User, pk=pk)

        if _api_token_limit_reached(u):
            return _token_limit_response()

        expiry, never_expire, error_response = _parse_token_expiry_payload(request.data or {})

        if error_response is not None:
            return error_response

        token_instance, raw_token = AuthToken.objects.create(user=u)

        if never_expire or expiry is not None:
            token_instance.expiry = None if never_expire else expiry
            token_instance.save(update_fields=["expiry"])

        try:
            AuditLog.objects.create(
                actor=request.user,
                actor_username=(getattr(request.user, "username", "") or "")[:160],
                action="settings.user.api_token.create",
                success=True,
                status_code=201,
                object_type="auth_token",
                object_id=(token_instance.token_key or "")[:80],
                object_repr=(token_instance.token_key or "")[:255],
                metadata={
                    "target_user_id": u.id,
                    "target_username": u.username,
                    "token_key": token_instance.token_key,
                    "expiry": token_instance.expiry.isoformat() if token_instance.expiry else None,
                    "never_expire": bool(never_expire),
                },
            )
        except Exception:
            pass

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


class SettingsUserApiTokenRevokeView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "settings.access.users.manage"

    def post(self, request, pk: int, token_key: str):
        u = generics.get_object_or_404(User, pk=pk)

        token_instance = AuthToken.objects.filter(user=u, token_key=token_key).first()
        if not token_instance:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        token_key = token_instance.token_key
        object_id = (token_key or "")[:80]
        object_repr = (token_key or "")[:255]

        token_instance.delete()

        try:
            AuditLog.objects.create(
                actor=request.user,
                actor_username=(getattr(request.user, "username", "") or "")[:160],
                action="settings.user.api_token.revoke",
                success=True,
                status_code=204,
                object_type="auth_token",
                object_id=object_id,
                object_repr=object_repr,
                metadata={
                    "target_user_id": u.id,
                    "target_username": u.username,
                    "token_key": token_key,
                },
            )
        except Exception:
            pass

        return Response(status=status.HTTP_204_NO_CONTENT)
    

class SettingsPermissionListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "settings.access.roles.view"

    def get_queryset(self):
        qs = Permission.objects.all().order_by("code")
        q = self.request.query_params.get("q", "").strip()
        if q:
            qs = qs.filter(code__icontains=q)
        return qs

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        data = PermissionSerializer(qs[:2000], many=True).data
        return Response({"results": data, "count": qs.count()})


class SettingsRoleListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    serializer_class = RoleSerializer
    queryset = Role.objects.all().order_by("name")

    def initial(self, request, *args, **kwargs):
        self.required_permission = (
            "settings.access.roles.view"
            if request.method == "GET"
            else "settings.access.roles.manage"
        )
        super().initial(request, *args, **kwargs)

    def perform_create(self, serializer):
        role = serializer.save()

        audit_event(
            self.request,
            action="settings.role.created",
            object_type="role",
            object_id=str(role.id),
            object_repr=role.name or "",
            status_code=201,
            metadata={
                "role_id": role.id,
                "name": role.name,
                "permission_ids": list(role.permissions.values_list("id", flat=True)),
                "permission_codes": list(role.permissions.values_list("code", flat=True)),
            },
        )


class SettingsRoleRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    serializer_class = RoleSerializer
    queryset = Role.objects.all()
    
    def initial(self, request, *args, **kwargs):
        if request.method == "GET":
            self.required_permission = "settings.access.roles.view"
        elif request.method == "DELETE":
            self.required_permission = "settings.access.roles.delete"
        else:
            self.required_permission = "settings.access.roles.manage"
        super().initial(request, *args, **kwargs)

    def perform_update(self, serializer):
        role = serializer.instance
        before = {
            "name": role.name,
            "description": role.description,
            "permission_ids": list(role.permissions.values_list("id", flat=True)),
            "permission_codes": list(role.permissions.values_list("code", flat=True)),
        }

        obj = serializer.save()

        audit_event(
            self.request,
            action="settings.role.updated",
            object_type="role",
            object_id=str(obj.id),
            object_repr=obj.name or "",
            metadata={
                "role_id": obj.id,
                "before": before,
                "after": {
                    "name": obj.name,
                    "description": obj.description,
                    "permission_ids": list(obj.permissions.values_list("id", flat=True)),
                    "permission_codes": list(obj.permissions.values_list("code", flat=True)),
                },
            },
        )

    def perform_destroy(self, instance):
        snapshot = {
            "name": instance.name,
            "description": instance.description,
            "permission_ids": list(instance.permissions.values_list("id", flat=True)),
            "permission_codes": list(instance.permissions.values_list("code", flat=True)),
        }
        role_id = str(instance.id)
        role_name = instance.name or ""

        super().perform_destroy(instance)

        audit_event(
            self.request,
            action="settings.role.deleted",
            object_type="role",
            object_id=role_id,
            object_repr=role_name,
            metadata={
                "deleted": snapshot,
            },
        )


class CaseRetentionSettingsView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = (
            "settings.case_management.view"
            if request.method == "GET"
            else "settings.case_management.manage"
        )
        super().initial(request, *args, **kwargs)

    def get_object(self):
        obj, _ = CaseRetentionSettings.objects.get_or_create(id=1)
        return obj

    def get(self, request):
        obj = self.get_object()
        return Response(CaseRetentionSettingsSerializer(obj).data)

    def patch(self, request):
        obj = self.get_object()
        ser = CaseRetentionSettingsSerializer(obj, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)

        aa = ser.validated_data.get("auto_archive_after_days", obj.auto_archive_after_days)
        hd = ser.validated_data.get("hard_delete_after_days", obj.hard_delete_after_days)
        if hd < aa:
            return Response(
                {"detail": "Hard delete must be ≥ auto-archive"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        before = {
            "auto_archive_after_days": obj.auto_archive_after_days,
            "hard_delete_after_days": obj.hard_delete_after_days,
            "exchange_send_template_id": str(obj.exchange_send_template_id) if obj.exchange_send_template_id else None,
        }

        inst = ser.save(updated_by=request.user)

        audit_event(
            request,
            action="settings.case_retention.updated",
            object_type="case_retention_settings",
            object_id=str(inst.id),
            object_repr="Case retention settings",
            metadata={
                "before": before,
                "after": {
                    "auto_archive_after_days": inst.auto_archive_after_days,
                    "hard_delete_after_days": inst.hard_delete_after_days,
                    "exchange_send_template_id": str(inst.exchange_send_template_id) if inst.exchange_send_template_id else None,
                },
            },
        )

        return Response(CaseRetentionSettingsSerializer(inst).data)

    def put(self, request):
        obj = self.get_object()
        ser = CaseRetentionSettingsSerializer(obj, data=request.data)
        ser.is_valid(raise_exception=True)

        aa = ser.validated_data.get("auto_archive_after_days", obj.auto_archive_after_days)
        hd = ser.validated_data.get("hard_delete_after_days", obj.hard_delete_after_days)
        if hd < aa:
            return Response(
                {"detail": "Hard delete must be ≥ auto-archive"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        before = {
            "auto_archive_after_days": obj.auto_archive_after_days,
            "hard_delete_after_days": obj.hard_delete_after_days,
            "exchange_send_template_id": str(obj.exchange_send_template_id) if obj.exchange_send_template_id else None,
        }

        inst = ser.save(updated_by=request.user)

        audit_event(
            request,
            action="settings.case_retention.updated",
            object_type="case_retention_settings",
            object_id=str(inst.id),
            object_repr="Case retention settings",
            metadata={
                "before": before,
                "after": {
                    "auto_archive_after_days": inst.auto_archive_after_days,
                    "hard_delete_after_days": inst.hard_delete_after_days,
                    "exchange_send_template_id": str(inst.exchange_send_template_id) if inst.exchange_send_template_id else None,
                },
            },
        )

        return Response(CaseRetentionSettingsSerializer(inst).data)


class AutomationRuleListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    serializer_class = AutomationRuleSerializer

    def initial(self, request, *args, **kwargs):
        self.required_permission = (
            "settings.automation_rules.view"
            if request.method == "GET"
            else "settings.automation_rules.manage"
        )
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        qs = AutomationRule.objects.all().order_by("name", "created_at")

        include_inactive = self.request.query_params.get("include_inactive") == "1"
        if not include_inactive:
            qs = qs.filter(is_enabled=True)

        q = (self.request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(name__icontains=q)

        scope = (self.request.query_params.get("scope") or "").strip()
        if scope:
            qs = qs.filter(scope=scope)

        return qs

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        data = AutomationRuleSerializer(qs[:500], many=True).data
        return Response({"results": data, "count": qs.count()})

    def perform_create(self, serializer):
        obj = serializer.save(
            created_by=self.request.user,
            updated_by=self.request.user,
        )

        audit_event(
            self.request,
            action="settings.automation_rule.created",
            object_type="automation_rule",
            object_id=str(obj.id),
            object_repr=obj.name or "",
            status_code=201,
            metadata={
                "scope": obj.scope,
                "is_enabled": obj.is_enabled,
            },
        )


class AutomationRuleDetailView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    serializer_class = AutomationRuleSerializer
    queryset = AutomationRule.objects.all()

    def initial(self, request, *args, **kwargs):
        if request.method == "GET":
            self.required_permission = "settings.automation_rules.view"
        elif request.method == "DELETE":
            self.required_permission = "settings.automation_rules.delete"
        else:
            self.required_permission = "settings.automation_rules.manage"

        super().initial(request, *args, **kwargs)

    def perform_update(self, serializer):
        obj = serializer.save(updated_by=self.request.user)

        audit_event(
            self.request,
            action="settings.automation_rule.updated",
            object_type="automation_rule",
            object_id=str(obj.id),
            object_repr=obj.name or "",
            metadata={
                "scope": obj.scope,
                "is_enabled": obj.is_enabled,
            },
        )

    def perform_destroy(self, instance):
        rule_id = str(instance.id)
        rule_name = instance.name or ""

        instance.delete()

        audit_event(
            self.request,
            action="settings.automation_rule.deleted",
            object_type="automation_rule",
            object_id=rule_id,
            object_repr=rule_name,
            metadata={},
        )


class AutomationRuleMetadataView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "settings.automation_rules.view"

    def get(self, request):
        users = User.objects.filter(is_active=True).order_by("username")[:500]
        customers = Customer.objects.filter(is_active=True).order_by("name")[:500]
        severities = Severity.objects.filter(is_active=True).order_by("order", "label")
        classifications = Classification.objects.filter(is_active=True).order_by("label")
        quickparts = CaseExchangeReplyQuickpart.objects.filter(is_active=True).order_by("name")
        templates = (
            InvestigationTemplate.objects
            .filter(is_enabled=True, soar_provider__is_enabled=True)
            .select_related("soar_provider")
            .order_by("name")
        )

        workbooks = WorkbookTemplate.objects.filter(is_active=True).order_by("name")

        return Response(
            {
                "scopes": [
                    {"value": "alert", "label": "Alert"},
                    {"value": "case", "label": "Case"},
                    {"value": "hunt", "label": "Hunt"},
                ],
                "operators": [
                    "EQUAL",
                    "NOT EQUAL",
                    "CONTAINS",
                    "DOES NOT CONTAIN",
                    "GREATER THAN",
                    "LESS THAN",
                    "BETWEEN",
                ],
                "condition_fields": [
                    {"value": "event", "label": "Trigger"},
                    {"value": "title", "label": "Title"},
                    {"value": "status", "label": "Status"},
                    {"value": "owner", "label": "Owner"},
                    {"value": "classification", "label": "Classification"},
                    {"value": "severity", "label": "Severity"},
                    {"value": "customer", "label": "Customer"},
                    {"value": "source", "label": "Source"},
                    {"value": "linked_alert_count", "label": "Linked alerts count"},
                    {"value": "object_age_hours", "label": "Object age, hours"},
                    {"value": "ioc_count", "label": "IoC count"},
                    {"value": "asset_count", "label": "Asset count"},
                    {"value": "inbound_exchange_delay_minutes", "label": "Inbound exchange delay, minutes"},
                    {"value": "ioc", "label": "IoC"},
                    {"value": "asset", "label": "Asset"},
                    {"value": "ioc_status", "label": "IoC status"},
                    {"value": "asset_status", "label": "Asset status"},
                    {"value": "scheduled_time", "label": "Scheduled time"},
                ],
                "event_values": [
                    {"value": "alert.created", "label": "Alert created", "scopes": ["alert"]},
                    {"value": "alert.updated", "label": "Alert updated", "scopes": ["alert"]},
                    {"value": "case.created", "label": "Case created", "scopes": ["case"]},
                    {"value": "case.updated", "label": "Case updated", "scopes": ["case"]},
                    {"value": "case.created_from_alert_escalation", "label": "Case created from alert escalation", "scopes": ["case"]},
                    {"value": "case.ioc_added", "label": "IoC added to case", "scopes": ["case"]},
                    {"value": "case.asset_added", "label": "Asset added to case", "scopes": ["case"]},
                    {"value": "case.exchange_inbound_received", "label": "Inbound Exchange received", "scopes": ["case"]},
                    {"value": "case.exchange_outbound_created", "label": "Outbound Exchange created", "scopes": ["case"]},
                    {"value": "hunt.created", "label": "Hunt created", "scopes": ["hunt"]},
                    {"value": "hunt.updated", "label": "Hunt updated", "scopes": ["hunt"]},
                    {"value": "scheduled_time", "label": "Scheduled time", "scopes": ["alert", "case", "hunt"]},
                ],

                "statuses": {
                    "alert": [
                        {"value": "open", "label": "Open"},
                        {"value": "in_progress", "label": "In progress"},
                        {"value": "merged", "label": "Merged"},
                        {"value": "closed", "label": "Closed"},
                    ],
                    "case": [
                        {"value": "open", "label": "Open"},
                        {"value": "in_progress", "label": "In progress"},
                        {"value": "resolved", "label": "Resolved"},
                        {"value": "closed", "label": "Closed"},
                        {"value": "archived", "label": "Archived"},
                    ],
                    "hunt": [
                        {"value": "to_do", "label": "To do"},
                        {"value": "in_progress", "label": "In progress"},
                        {"value": "completed", "label": "Completed"},
                        {"value": "abandoned", "label": "Abandoned"},
                    ],
                },

                "workbooks": [
                    {"id": str(item.id), "name": item.name}
                    for item in workbooks
                ],

                "severities": [
                    {"code": item.code, "label": item.label}
                    for item in severities
                ],

                "classifications": [
                    {"code": item.code, "label": item.label}
                    for item in classifications
                ],

                "customers": [
                    {"id": str(item.id), "name": item.name}
                    for item in customers
                ],

                "users": [
                    {"id": item.id, "username": item.username}
                    for item in users
                ],

                "quickparts": [
                    {"id": str(item.id), "name": item.name}
                    for item in quickparts
                ],

                "investigation_templates": [
                    {
                        "id": str(item.id),
                        "code": item.code,
                        "name": item.name,
                        "chat_command": item.chat_command or "",
                        "entity_type": item.entity_type,
                        "target_kind": item.target_kind,
                        "allowed_variables_schema": item.allowed_variables_schema or {},
                    }
                    for item in templates
                ],
            }
        )
    

class SettingsAuditLogListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "settings.audit.view"
    serializer_class = AuditLogSerializer

    def get_queryset(self):
        qs = AuditLog.objects.all()

        q = (self.request.query_params.get("q") or "").strip()
        action = (self.request.query_params.get("action") or "").strip()
        object_type = (self.request.query_params.get("object_type") or "").strip()
        object_id = (self.request.query_params.get("object_id") or "").strip()
        actor_id = (self.request.query_params.get("actor_id") or "").strip()
        request_id = (self.request.query_params.get("request_id") or "").strip()
        method = (self.request.query_params.get("method") or "").strip()
        path = (self.request.query_params.get("path") or "").strip()
        status_code = (self.request.query_params.get("status_code") or "").strip()
        case_id = (self.request.query_params.get("case_id") or "").strip()
        alert_id = (self.request.query_params.get("alert_id") or "").strip()
        hunt_id = (self.request.query_params.get("hunt_id") or "").strip()
        task_id = (self.request.query_params.get("task_id") or "").strip()
        customer_id = (self.request.query_params.get("customer_id") or "").strip()
        success = (self.request.query_params.get("success") or "").strip()
        date_from = (self.request.query_params.get("date_from") or "").strip()
        date_to = (self.request.query_params.get("date_to") or "").strip()
        ordering = (self.request.query_params.get("ordering") or "-created_at").strip()

        if q:
            qs = qs.filter(
                Q(actor_username__icontains=q)
                | Q(action__icontains=q)
                | Q(object_type__icontains=q)
                | Q(object_id__icontains=q)
                | Q(object_repr__icontains=q)
                | Q(method__icontains=q)
                | Q(path__icontains=q)
                | Q(ip_address__icontains=q)
                | Q(user_agent__icontains=q)
                | Q(metadata__icontains=q)
            )

        if action:
            qs = qs.filter(action=action)
        if object_type:
            qs = qs.filter(object_type=object_type)
        if object_id:
            qs = qs.filter(object_id=object_id)
        if actor_id:
            qs = qs.filter(actor_id=actor_id)
        if request_id:
            qs = qs.filter(request_id=request_id)
        if method:
            qs = qs.filter(method__iexact=method)
        if path:
            qs = qs.filter(path__icontains=path)
        if status_code:
            try:
                qs = qs.filter(status_code=int(status_code))
            except ValueError:
                qs = qs.none()

        if case_id:
            qs = qs.filter(Q(object_id=case_id) | Q(metadata__case_id=case_id))
        if alert_id:
            qs = qs.filter(Q(object_id=alert_id) | Q(metadata__alert_id=alert_id))
        if hunt_id:
            qs = qs.filter(Q(object_id=hunt_id) | Q(metadata__hunt_id=hunt_id))
        if task_id:
            qs = qs.filter(Q(object_id=task_id) | Q(metadata__task_id=task_id))
        if customer_id:
            qs = qs.filter(
                Q(metadata__customer_id=customer_id)
                | Q(metadata__customer_ids__contains=[customer_id])
            )

        if success in {"true", "false", "1", "0"}:
            val = success in {"true", "1"}
            qs = qs.filter(success=val)

        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        allowed = {"created_at", "-created_at", "action", "-action", "success", "-success"}
        if ordering not in allowed:
            ordering = "-created_at"
        return qs.order_by(ordering)

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        page = self.paginate_queryset(qs)
        ser = self.get_serializer(page, many=True)
        return self.get_paginated_response(ser.data)


class SettingsAuditLogDetailView(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "settings.audit.view"
    serializer_class = AuditLogSerializer
    queryset = AuditLog.objects.all()


class SettingsRoleCustomerAccessView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        if request.method == "GET":
            self.required_permission = "settings.access.roles.view"
        else:
            self.required_permission = "settings.access.roles.manage"
        super().initial(request, *args, **kwargs)

    def get_role(self, role_id: int) -> Role:
        return generics.get_object_or_404(Role, id=role_id)

    def get(self, request, role_id: int):
        role = self.get_role(role_id)

        qs = (
            CustomerAccess.objects
            .filter(role=role, user__isnull=True)
            .values_list("customer_id", flat=True)
        )
        customer_ids = list(qs)

        customers = list(
            Customer.objects
            .filter(id__in=customer_ids)
            .values("id", "name", "is_active")
            .order_by("name")
        )

        return Response(
            {
                "role_id": role.id,
                "customer_ids": customer_ids,
                "customers": customers,
            },
            status=200,
        )

    @transaction.atomic
    def put(self, request, role_id: int):
        role = self.get_role(role_id)

        ser = RoleCustomerAccessUpdateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        customer_ids = ser.validated_data["customer_ids"]

        found = set(Customer.objects.filter(id__in=customer_ids).values_list("id", flat=True))
        missing = [str(x) for x in customer_ids if x not in found]
        if missing:
            return Response({"detail": "Unknown customer id(s)", "missing": missing}, status=400)

        CustomerAccess.objects.filter(role=role, user__isnull=True).exclude(customer_id__in=customer_ids).delete()

        existing = set(
            CustomerAccess.objects
            .filter(role=role, user__isnull=True, customer_id__in=customer_ids)
            .values_list("customer_id", flat=True)
        )

        to_add = [cid for cid in customer_ids if cid not in existing]
        CustomerAccess.objects.bulk_create(
            [CustomerAccess(customer_id=cid, role=role, user=None) for cid in to_add],
            ignore_conflicts=True,
        )

        final_ids = list(
            CustomerAccess.objects
            .filter(role=role, user__isnull=True)
            .values_list("customer_id", flat=True)
        )

        audit_event(
            request,
            action="settings.role.customer_access.updated",
            object_type="role",
            object_id=str(role.id),
            object_repr=role.name or "",
            metadata={
                "role_id": role.id,
                "customer_ids": [str(x) for x in final_ids],
            },
        )

        return Response({"role_id": role.id, "customer_ids": final_ids}, status=200)
    

class _AIProviderAccessMixin:
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        if request.method == "GET":
            allowed = (
                user_has_perm(request.user, "settings.aisoar.view")
                or user_has_perm(request.user, "settings.aisoar.manage")
                or user_has_perm(request.user, "chat.provider.manage")
            )
        else:
            allowed = (
                user_has_perm(request.user, "settings.aisoar.manage")
                or user_has_perm(request.user, "chat.provider.manage")
            )

        if not allowed:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()


class _InvestigationTemplateAccessMixin:
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        if request.method == "GET":
            allowed = (
                user_has_perm(request.user, "settings.aisoar.view")
                or user_has_perm(request.user, "settings.aisoar.manage")
                or user_has_perm(request.user, "chat.template.manage")
            )
        else:
            allowed = (
                user_has_perm(request.user, "settings.aisoar.manage")
                or user_has_perm(request.user, "chat.template.manage")
            )

        if not allowed:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied()


class AIProviderListCreateView(_AIProviderAccessMixin, generics.ListCreateAPIView):
    queryset = AIProvider.objects.all().order_by("name")
    serializer_class = AIProviderSerializer

    def create(self, request, *args, **kwargs):
        if AIProvider.objects.exists():
            return Response(
                {
                    "detail": "Only one AI provider is allowed in the current configuration mode. Edit the existing provider instead."
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().create(request, *args, **kwargs)


class AIProviderDetailView(_AIProviderAccessMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = AIProvider.objects.all()
    serializer_class = AIProviderSerializer

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()

        if instance.is_default:
            return Response(
                {
                    "detail": "Default AI provider cannot be deleted. Assign another default provider first."
                },
                status=status.HTTP_409_CONFLICT,
            )

        force_delete = str(request.query_params.get("force", "")).lower() in {"1", "true", "yes"}

        try:
            self.perform_destroy(instance)
            return Response(status=status.HTTP_204_NO_CONTENT)

        except ProtectedError:
            if not force_delete:
                runs_count = instance.chat_runs.count()
                return Response(
                    {
                        "detail": (
                            "This AI provider cannot be deleted because it is already used by chat runs. "
                            f"Found {runs_count} related run(s). "
                            "Use force=1 to delete related chat runs as well."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            instance.chat_runs.all().delete()
            self.perform_destroy(instance)
            return Response(status=status.HTTP_204_NO_CONTENT)


class SOARProviderListCreateView(_AIProviderAccessMixin, generics.ListCreateAPIView):
    queryset = SOARProvider.objects.all().order_by("name")
    serializer_class = SOARProviderSerializer


class SOARProviderDetailView(_AIProviderAccessMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = SOARProvider.objects.all()
    serializer_class = SOARProviderSerializer

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()

        try:
            self.perform_destroy(instance)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except ProtectedError:
            templates_count = (
                instance.investigation_templates.count()
                if hasattr(instance, "investigation_templates")
                else 0
            )
            return Response(
                {
                    "detail": (
                        "This SOAR provider cannot be deleted because it is still referenced by existing objects. "
                        f"Found {templates_count} related template(s)."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )


class InvestigationTemplateListCreateView(_AIProviderAccessMixin, generics.ListCreateAPIView):
    queryset = InvestigationTemplate.objects.select_related("soar_provider").all().order_by("name")
    serializer_class = InvestigationTemplateSerializer

    def perform_create(self, serializer):
        validated = serializer.validated_data
        chat_command = _normalize_chat_command(validated.get("chat_command", ""))
        is_enabled = bool(validated.get("is_enabled", True))

        _validate_chat_command_uniqueness(
            command=chat_command or "",
            is_enabled=is_enabled,
        )

        serializer.save(chat_command=chat_command)


class InvestigationTemplateDetailView(_AIProviderAccessMixin, generics.RetrieveUpdateDestroyAPIView):
    queryset = InvestigationTemplate.objects.select_related("soar_provider").all()
    serializer_class = InvestigationTemplateSerializer

    def perform_update(self, serializer):
        validated = serializer.validated_data

        if "chat_command" in validated:
            chat_command = _normalize_chat_command(validated.get("chat_command", ""))
        else:
            chat_command = serializer.instance.chat_command

        is_enabled = bool(validated.get("is_enabled", serializer.instance.is_enabled))

        _validate_chat_command_uniqueness(
            command=chat_command or "",
            is_enabled=is_enabled,
            instance=serializer.instance,
        )

        serializer.save(chat_command=chat_command)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()

        try:
            self.perform_destroy(instance)
            return Response(status=status.HTTP_204_NO_CONTENT)
        except ProtectedError:
            return Response(
                {
                    "detail": (
                        "This investigation template cannot be deleted because it is already referenced by existing action runs."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )


class InstanceSettingsView(APIView):
    permission_classes = [CanManageInstanceSettings]

    def get(self, request):
        last_backup = InstanceBackup.objects.order_by("-created_at").first()
        splunk_hec = _get_splunk_hec_settings()
        proxy = InstanceProxySettings.get_solo()

        return Response(
            {
                "proxy": InstanceProxySettingsSerializer(proxy).data,
                "splunk_hec": {
                    "enabled": bool(splunk_hec.get("enabled", False)),
                    "endpoint": splunk_hec.get("endpoint", "") or "",
                    "has_token": bool(splunk_hec.get("has_token", False)),
                    "index": splunk_hec.get("index", "") or "",
                    "source": splunk_hec.get("source", "doko:audit") or "doko:audit",
                    "sourcetype": splunk_hec.get("sourcetype", "_json") or "_json",
                },
                "last_backup": InstanceBackupSerializer(last_backup).data if last_backup else None,
                "last_backup_file": last_backup.filename if last_backup else "",
                "last_audit_export_file": "",
            }
        )


class InstanceProxySettingsView(APIView):
    permission_classes = [CanManageInstanceSettings]

    def get_object(self):
        return InstanceProxySettings.get_solo()

    def put(self, request):
        obj = self.get_object()
        before = {
            "enabled": obj.enabled,
            "host": obj.host,
            "port": obj.port,
            "username": obj.username,
            "has_password": bool(obj.password_secret_ref),
        }

        serializer = InstanceProxySettingsSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        instance = serializer.save(updated_by=request.user)

        audit_event(
            request,
            action="settings.instance.proxy.updated",
            object_type="instance_proxy_settings",
            object_id=str(instance.id),
            object_repr="Instance proxy settings",
            metadata={
                "before": before,
                "after": {
                    "enabled": instance.enabled,
                    "host": instance.host,
                    "port": instance.port,
                    "username": instance.username,
                    "has_password": bool(instance.password_secret_ref),
                },
            },
        )

        return Response(InstanceProxySettingsSerializer(instance).data, status=status.HTTP_200_OK)

    def post(self, request):
        return self.put(request)
    

class InstanceAuditExportView(APIView):
    permission_classes = [CanManageInstanceSettings]

    def post(self, request):
        qs = AuditLog.objects.all().order_by("-created_at")

        query = (request.data.get("query") or "").strip()
        date_from = (request.data.get("date_from") or "").strip()
        date_to = (request.data.get("date_to") or "").strip()
        include_failed_only = _parse_bool(request.data.get("include_failed_only"))

        if query:
            qs = qs.filter(
                Q(actor_username__icontains=query)
                | Q(action__icontains=query)
                | Q(object_type__icontains=query)
                | Q(object_id__icontains=query)
                | Q(object_repr__icontains=query)
                | Q(method__icontains=query)
                | Q(path__icontains=query)
                | Q(ip_address__icontains=query)
                | Q(user_agent__icontains=query)
                | Q(metadata__icontains=query)
            )

        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
        if include_failed_only:
            qs = qs.filter(success=False)

        buffer = io.StringIO()
        writer = csv.writer(buffer)

        writer.writerow([
            "id",
            "created_at",
            "actor",
            "actor_username",
            "action",
            "object_type",
            "object_id",
            "object_repr",
            "success",
            "status_code",
            "ip_address",
            "user_agent",
            "method",
            "path",
            "request_id",
            "duration_ms",
            "metadata",
        ])

        for item in qs.iterator():
            writer.writerow([
                str(item.id),
                item.created_at.isoformat() if item.created_at else "",
                getattr(item.actor, "id", "") if item.actor_id else "",
                item.actor_username or "",
                item.action or "",
                item.object_type or "",
                item.object_id or "",
                item.object_repr or "",
                item.success,
                item.status_code if item.status_code is not None else "",
                item.ip_address or "",
                item.user_agent or "",
                item.method or "",
                item.path or "",
                str(item.request_id) if item.request_id else "",
                item.duration_ms if item.duration_ms is not None else "",
                json.dumps(item.metadata or {}, ensure_ascii=False),
            ])

        content = buffer.getvalue()
        buffer.close()

        response = HttpResponse(content, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="audit_logs.csv"'

        audit_event(
            request,
            action="settings.audit.exported",
            object_type="audit_log",
            object_id="",
            object_repr="Audit CSV export",
            metadata={
                "query": query,
                "date_from": date_from,
                "date_to": date_to,
                "include_failed_only": include_failed_only,
                "row_count": qs.count(),
            },
        )

        return response


class InstanceSplunkHecSettingsView(APIView):
    permission_classes = [CanManageInstanceSettings]

    def post(self, request):
        return self._save(request)

    def put(self, request):
        return self._save(request)

    def _save(self, request):
        payload = _normalize_splunk_hec_payload(request.data or {})
        obj = InstanceSplunkHecSettings.get_solo()

        next_enabled = bool(payload["enabled"])
        next_endpoint = payload["endpoint"]
        next_token = payload["token"]

        if next_enabled:
            if not next_endpoint:
                return Response(
                    {"detail": "Splunk HEC endpoint is required."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not next_token and not obj.token_secret_ref:
                return Response(
                    {"detail": "Splunk HEC token is required."},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        before = obj.to_public_dict()

        obj.enabled = next_enabled
        obj.endpoint = next_endpoint
        obj.index = payload["index"]
        obj.source = payload["source"]
        obj.sourcetype = payload["sourcetype"]
        obj.updated_by = request.user

        if next_token:
            obj.set_token(next_token)

        obj.save()

        audit_event(
            request,
            action="settings.instance.splunk_hec.updated",
            object_type="instance_splunk_hec_settings",
            object_id=str(obj.id),
            object_repr="Splunk HEC settings",
            metadata={
                "before": before,
                "after": obj.to_public_dict(),
            },
        )

        return Response(obj.to_public_dict(), status=status.HTTP_200_OK)


class InstanceSplunkHecTestView(APIView):
    permission_classes = [CanManageInstanceSettings]

    def post(self, request):
        payload = _normalize_splunk_hec_payload(request.data or {})
        obj = InstanceSplunkHecSettings.get_solo()

        if not payload["endpoint"]:
            payload["endpoint"] = obj.endpoint or ""

        if not payload["token"]:
            payload["token"] = obj.get_token()

        if not payload["index"]:
            payload["index"] = obj.index or ""

        if not payload["source"]:
            payload["source"] = obj.source or "doko:audit"

        if not payload["sourcetype"]:
            payload["sourcetype"] = obj.sourcetype or "_json"

        ok, detail = test_splunk_hec_connection(payload)

        if ok:
            return Response(
                {
                    "ok": True,
                    "detail": detail,
                },
                status=status.HTTP_200_OK,
            )

        return Response(
            {
                "ok": False,
                "detail": detail,
            },
            status=status.HTTP_400_BAD_REQUEST,
        )
    

class InstanceBackupCreateView(APIView):
    permission_classes = [CanManageInstanceSettings]

    def post(self, request):
        try:
            backup = create_database_backup(user=request.user)
        except Exception as exc:
            return Response(
                {"detail": f"Unable to create backup: {exc}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        audit_event(
            request,
            action="settings.instance.backup.created",
            object_type="instance_backup",
            object_id=str(backup.id),
            object_repr=backup.filename or "",
            status_code=201,
            metadata={
                "filename": backup.filename,
                "file_size": backup.file_size,
                "sha256": backup.sha256,
            },
        )

        return Response(
            InstanceBackupSerializer(backup).data,
            status=status.HTTP_201_CREATED,
        )


class InstanceBackupDownloadView(APIView):
    permission_classes = [CanManageInstanceSettings]

    def get(self, request, backup_id):
        try:
            backup = InstanceBackup.objects.get(pk=backup_id)
        except InstanceBackup.DoesNotExist:
            raise Http404("Backup not found.")

        path = Path(backup.file_path)
        if not path.exists() or not path.is_file():
            raise Http404("Backup file not found.")

        response = FileResponse(
            path.open("rb"),
            as_attachment=True,
            filename=backup.filename,
            content_type=backup.content_type or "application/octet-stream",
        )

        audit_event(
            request,
            action="settings.instance.backup.downloaded",
            object_type="instance_backup",
            object_id=str(backup.id),
            object_repr=backup.filename or "",
            metadata={
                "filename": backup.filename,
                "file_size": backup.file_size,
                "sha256": backup.sha256,
            },
        )

        return response


class InstanceBackupRestoreView(APIView):
    permission_classes = [CanManageInstanceSettings]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        serializer = RestoreBackupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        uploaded_file = serializer.validated_data["file"]

        try:
            restore_database_backup(uploaded_file)
        except ValueError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:
            return Response(
                {"detail": f"Unable to restore backup: {exc}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        audit_event(
            request,
            action="settings.instance.backup.restored",
            object_type="instance_backup",
            object_id="",
            object_repr=getattr(uploaded_file, "name", "") or "",
            metadata={
                "filename": getattr(uploaded_file, "name", "") or "",
                "size": getattr(uploaded_file, "size", None),
            },
        )

        return Response({"detail": "Backup restored."}, status=status.HTTP_200_OK)