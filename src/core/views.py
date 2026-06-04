from datetime import date, datetime, timezone as dt_timezone
from uuid import UUID
from urllib.parse import urlparse
import json
import requests
import uuid

from django.contrib.auth import get_user_model, update_session_auth_hash
from django.shortcuts import get_object_or_404
from django.db.models import Case, When, Value, IntegerField, Max, OuterRef, Subquery, DateTimeField, CharField, BooleanField, Q, F, Count
from django.utils import timezone
from django.utils.timezone import localtime
from django.db.models.functions import Coalesce, Greatest
from django.db import transaction, IntegrityError
from django.conf import settings
from django.utils.html import escape
from django.core.files.base import ContentFile
from django.core.exceptions import FieldError
from django.contrib.auth.password_validation import validate_password


from rest_framework import generics, viewsets, mixins, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from .audit import audit_event

from .models import (
    Alert,
    AlertComment,
    Event,
    TimelineItem,
    Comment,
    Attachment,
    Severity,
    Classification,
    UserRole,
    CustomerContact,
    Customer,
    WorkbookTemplate,
    WorkbookTemplateItem,
    WorkbookInstance,
    WorkbookInstanceItem,
    ReportTemplate,
    ReportInstance,
    IncidentTimelineItem,
    UserProfile,
    CaseExchange,
    CaseUserState,
    ConnectorResult,
    ConnectorAllowlistDomain,
    ConnectorInstance,
    ConnectorEndpoint,
    CaseExchangeReplyQuickpart,
    CaseExchangeFollowup,
    InvestigationTemplate,
    Hunt, 
    HuntJournalEntry, 
    HuntCaseLink,
    Task,
    TaskComment,
    TaskCaseLink,
    CaseRetentionSettings,
)

from .serializers import (
    AlertSerializer,
    EventSerializer,
    EventDetailSerializer,
    EventListSerializer,
    TimelineItemSerializer,
    CommentSerializer,
    AttachmentSerializer,
    SeveritySerializer,
    ClassificationSerializer,
    CustomerSerializer,
    CustomerContactSerializer,
    WorkbookInstanceItemSerializer,
    WorkbookTemplateSerializer,
    WorkbookTemplateCreateSerializer,
    WorkbookTemplateItemSerializer,
    WorkbookInstanceSerializer,
    ReportTemplateSerializer,
    ReportTemplateListSerializer,
    ReportInstanceSerializer,
    ReportGenerateRequestSerializer,
    ReportPreviewRequestSerializer,
    IncidentTimelineItemSerializer,
    IncidentTimelineItemCreateSerializer,
    AlertCommentSerializer,
    MeSerializer,
    CaseExchangeSerializer,
    CaseExchangeCreateSerializer,
    CaseExchangeReplyQuickpartSerializer,
    CaseExchangeFollowupSerializer,
    HuntListSerializer,
    HuntDetailSerializer,
    HuntJournalEntrySerializer,
    HuntCaseLinkSerializer,
    TaskListSerializer,
    TaskDetailSerializer,
    TaskCommentSerializer,
    TaskCaseLinkSerializer,
)

from .permissions import IsOwnerOrMember, HasPermissionCode
from .rbac import get_user_permissions, get_accessible_customer_ids
from .reports_engine import render_report_html
from .outbound_proxy import build_outbound_proxies


User = get_user_model()



DEFAULT_CUSTOMER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")
def is_default_customer(customer: "Customer") -> bool:
    try:
        return uuid.UUID(str(customer.id)) == DEFAULT_CUSTOMER_ID
    except Exception:
        return False

def get_default_customer() -> Customer | None:
    return Customer.objects.filter(id=DEFAULT_CUSTOMER_ID, is_active=True).first()

def _parse_alert_ids(raw_ids):
    if raw_ids is None:
        return []

    if isinstance(raw_ids, str):
        raw_ids = [x.strip() for x in raw_ids.split(",") if x.strip()]

    if not isinstance(raw_ids, (list, tuple)):
        return []

    out = []
    seen = set()

    for raw in raw_ids:
        try:
            value = str(UUID(str(raw)))
        except Exception:
            continue

        if value in seen:
            continue

        seen.add(value)
        out.append(value)

    return out


def _get_alerts_for_new_case_merge(request, base_alert: Alert):
    requested_ids = _parse_alert_ids(request.data.get("alert_ids"))
    merged_ids = [str(base_alert.id), *requested_ids]

    seen = set()
    ordered_ids = []
    for alert_id in merged_ids:
        if alert_id in seen:
            continue
        seen.add(alert_id)
        ordered_ids.append(alert_id)

    qs = Alert.objects.filter(id__in=ordered_ids, is_deleted=False)

    if not request.user.is_staff:
        customer_ids = get_accessible_customer_ids(request.user)
        qs = qs.filter(customer_id__in=customer_ids)

    alerts = list(qs.order_by("created_at", "id"))
    found_ids = {str(a.id) for a in alerts}

    missing_ids = [alert_id for alert_id in ordered_ids if alert_id not in found_ids]
    if missing_ids:
        raise PermissionDenied("One or more alerts are not accessible.")

    return alerts


def _join_alert_descriptions(alerts: list[Alert]) -> str:
    parts = []

    for alert in sorted(alerts, key=lambda a: (a.created_at, str(a.id))):
        title = (alert.title or "Untitled alert").strip()
        desc = (alert.description or "").strip()

        date_label = ""
        if alert.created_at:
            date_label = localtime(alert.created_at).strftime("%Y-%m-%d %H:%M:%S")

        block = [
            f"### {title}",
        ]

        if date_label:
            block.append(f"*{date_label}*")

        if desc:
            block.append("")
            block.append(desc)

        parts.append("\n".join(block).strip())

    return "\n\n---\n\n".join(parts)


def _truthy_param(request, name: str) -> bool:
    return (request.query_params.get(name) or "").strip().lower() in ("1", "true", "yes", "y", "on")


def _apply_archived_filters(qs, request):
    include_archived = _truthy_param(request, "include_archived")
    archived_only = _truthy_param(request, "archived_only")

    try:
        if archived_only:
            return qs.filter(archived_at__isnull=False)
        if not include_archived:
            return qs.filter(archived_at__isnull=True)
        return qs
    except FieldError:
        return qs


def _getlist_or_single(request, key: str):
    vals = request.query_params.getlist(key)
    if vals:
        out = [v.strip() for v in vals if (v or "").strip()]
        return out

    single = (request.query_params.get(key) or "").strip()
    return [single] if single else []


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    u = request.user

    if not u or not getattr(u, "is_authenticated", False):
        return Response({"detail": "Authentication credentials were not provided."}, status=status.HTTP_401_UNAUTHORIZED)

    if not getattr(u, "is_active", False):
        return Response({"detail": "User is inactive."}, status=status.HTTP_403_FORBIDDEN)

    perms = sorted(list(get_user_permissions(u)))

    direct_roles = list(
        UserRole.objects.filter(user=u).select_related("role").values_list("role__name", flat=True)
    )

    profile, _ = UserProfile.objects.get_or_create(user=u)

    avatar_url = None
    if profile.avatar:
        avatar_url = request.build_absolute_uri(profile.avatar.url)

    return Response(
        {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "is_staff": u.is_staff,
            "timezone": profile.timezone,
            "avatar_url": avatar_url,
            "permissions": ["*"] if u.is_staff else perms,
            "rbac_debug": {
                "direct_roles": sorted(set([x for x in direct_roles if x])),
            },
        }
    )


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def me_update(request):
    u = request.user
    profile, _ = UserProfile.objects.get_or_create(user=u)

    email = request.data.get("email", None)
    timezone = request.data.get("timezone", None)

    updated_user = False
    updated_profile = False

    if email is not None:
        u.email = (email or "").strip()
        updated_user = True

    if timezone is not None:
        profile.timezone = (timezone or "").strip()
        updated_profile = True

    if updated_user:
        u.save(update_fields=["email"])
    if updated_profile:
        profile.save(update_fields=["timezone"])

    avatar_url = None
    if profile.avatar:
        avatar_url = request.build_absolute_uri(profile.avatar.url)

    audit_event(
        request,
        action="me.updated",
        object_type="user",
        object_id=str(u.id),
        object_repr=u.username or "",
        metadata={"updated_fields": {"email": email is not None, "timezone": timezone is not None}},
    )

    return Response(
        {
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "is_staff": u.is_staff,
            "timezone": profile.timezone,
            "avatar_url": avatar_url,
        },
        status=status.HTTP_200_OK,
    )


def get_event_for_user_or_404(request, event_id):
    qs = Event.objects.filter(is_deleted=False)

    if request.user.is_staff:
        return get_object_or_404(qs, id=event_id)

    customer_ids = get_accessible_customer_ids(request.user)
    qs = qs.filter(customer_id__in=customer_ids)

    return get_object_or_404(
        qs.filter(Q(owner=request.user) | Q(members=request.user)).distinct(),
        id=event_id,
    )


def _check_case_access(request, event: Event):
    if request.user.is_staff:
        return
    customer_ids = get_accessible_customer_ids(request.user)
    if event.customer_id not in customer_ids:
        raise PermissionDenied("Case not accessible.")
    

def _check_case_manage_access(request, event: Event):
    _check_case_access(request, event)

    if request.user.is_staff:
        return

    if event.owner_id == request.user.id:
        return

    if event.members.filter(id=request.user.id).exists():
        return

    raise PermissionDenied("Case not manageable.")


def _str_or_empty(value) -> str:
    return str(value) if value else ""


def _audit_case_meta(case: Event, extra: dict | None = None) -> dict:
    data = {
        "case_id": _str_or_empty(getattr(case, "id", None)),
        "case_number": getattr(case, "case_number", None),
        "customer_id": _str_or_empty(getattr(case, "customer_id", None)),
    }
    if extra:
        data.update(extra)
    return data


def _case_alert_sources_for_automation(case: Event) -> list[str]:
    sources = []
    seen = set()

    qs = (
        Alert.objects
        .filter(case=case, is_deleted=False)
        .exclude(source="")
        .order_by("created_at", "id")
        .values_list("source", flat=True)
    )

    for source in qs:
        value = str(source or "").strip()
        if not value:
            continue

        key = value.casefold()
        if key in seen:
            continue

        seen.add(key)
        sources.append(value)

    return sources


def _audit_alert_meta(alert: Alert, extra: dict | None = None) -> dict:
    data = {
        "alert_id": _str_or_empty(getattr(alert, "id", None)),
        "case_id": _str_or_empty(getattr(alert, "case_id", None)),
        "customer_id": _str_or_empty(getattr(alert, "customer_id", None)),
    }
    if extra:
        data.update(extra)
    return data


def _alert_status_before_merge(alert: Alert) -> str:
    allowed_statuses = set(Alert.Status.values)
    previous_status = str(getattr(alert, "status_before_merge", "") or "").strip()

    if previous_status in allowed_statuses and previous_status != Alert.Status.MERGED:
        return previous_status

    current_status = str(getattr(alert, "status", "") or "").strip()

    if current_status in allowed_statuses and current_status != Alert.Status.MERGED:
        return current_status

    return Alert.Status.OPEN


ALERT_CASE_EXCHANGES_MAX_ITEMS = 20
ALERT_CASE_EXCHANGE_BODY_MAX_CHARS = 500000
ALERT_CASE_EXCHANGE_RAW_MAX_BYTES = 200000


def _safe_str(value, max_len: int = 500) -> str:
    if value is None:
        return ""
    return str(value).strip()[:max_len]


def _safe_str_list(value, *, max_items: int = 100, max_len: int = 500) -> list[str]:
    if value in (None, ""):
        return []

    if isinstance(value, str):
        value = [value]

    if not isinstance(value, list):
        raise ValidationError("Expected a list of strings.")

    out = []
    seen = set()

    for item in value[:max_items]:
        text = _safe_str(item, max_len=max_len)
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)

    return out


def _get_alert_case_exchange_items(alert: Alert) -> list[dict]:
    raw = getattr(alert, "raw", None) or {}

    if not isinstance(raw, dict):
        return []

    items = raw.get("case_exchanges", None)

    if items is None:
        projections = raw.get("projections", {})
        if isinstance(projections, dict):
            items = projections.get("case_exchanges", None)

    if items in (None, ""):
        return []

    if not isinstance(items, list):
        raise ValidationError({"raw": "case_exchanges must be a list."})

    if len(items) > ALERT_CASE_EXCHANGES_MAX_ITEMS:
        raise ValidationError({"raw": "case_exchanges contains too many items."})

    out = []

    for item in items:
        if not isinstance(item, dict):
            raise ValidationError({"raw": "Each case exchange must be an object."})
        out.append(item)

    return out


def _case_exchange_item_has_content(item: dict) -> bool:
    checks = [
        item.get("subject"),
        item.get("body"),
        item.get("body_preview"),
        item.get("sender"),
        item.get("message_id"),
        item.get("external_id"),
        item.get("id"),
        item.get("key"),
    ]

    for value in checks:
        if str(value or "").strip():
            return True

    for key in ["to", "cc", "bcc", "references"]:
        value = item.get(key)
        if isinstance(value, list) and any(str(x or "").strip() for x in value):
            return True
        if isinstance(value, str) and value.strip():
            return True

    return False


def _clean_case_exchange_raw(item: dict, *, alert: Alert, projection_key: str, external_id: str) -> dict:
    raw_payload = item.get("raw") or {}

    if not isinstance(raw_payload, dict):
        raw_payload = {}

    raw_payload = dict(raw_payload)

    for key in ["body", "body_html", "html"]:
        raw_payload.pop(key, None)

    body_ref = item.get("body_ref", None)
    if body_ref not in (None, ""):
        if isinstance(body_ref, dict):
            raw_payload["body_ref"] = body_ref
        else:
            raw_payload["body_ref"] = _safe_str(body_ref, max_len=1000)

    try:
        raw_size = len(json.dumps(raw_payload, ensure_ascii=False).encode("utf-8"))
    except Exception:
        raise ValidationError({"raw": "Case exchange raw payload must be JSON serializable."})

    if raw_size > ALERT_CASE_EXCHANGE_RAW_MAX_BYTES:
        raise ValidationError({"raw": "Case exchange raw payload is too large."})

    raw_payload["alert_exchange"] = {
        "source": "alert.raw.case_exchanges",
        "source_alert_id": str(alert.id),
        "source_alert_title": alert.title or "",
        "projection_key": projection_key,
        "external_id": external_id,
    }

    return raw_payload


def _build_case_exchange_payload_from_alert_item(*, alert: Alert, item: dict, idx: int) -> dict | None:
    if not _case_exchange_item_has_content(item):
        return None

    projection_key = _safe_str(item.get("external_id") or item.get("id") or item.get("key") or idx, max_len=120)
    external_id = _safe_str(item.get("external_id") or item.get("id") or item.get("key"), max_len=500)

    direction = _safe_str(item.get("direction") or CaseExchange.Direction.INBOUND, max_len=20)
    if direction not in {CaseExchange.Direction.INBOUND, CaseExchange.Direction.OUTBOUND}:
        direction = CaseExchange.Direction.INBOUND

    channel = _safe_str(item.get("channel") or CaseExchange.Channel.EMAIL, max_len=20)
    if channel not in {CaseExchange.Channel.EMAIL, CaseExchange.Channel.OTHER}:
        channel = CaseExchange.Channel.EMAIL

    body = str(item.get("body") or "")
    if not body:
        body = str(item.get("body_preview") or "")

    if len(body) > ALERT_CASE_EXCHANGE_BODY_MAX_CHARS:
        raise ValidationError({"raw": "Case exchange body is too large."})

    payload = {
        "direction": direction,
        "channel": channel,
        "subject": _safe_str(item.get("subject") or alert.title, max_len=500),
        "body": body,
        "sender": _safe_str(item.get("sender"), max_len=500),
        "to": _safe_str_list(item.get("to")),
        "cc": _safe_str_list(item.get("cc")),
        "bcc": _safe_str_list(item.get("bcc")),
        "message_id": _safe_str(item.get("message_id"), max_len=500),
        "references": _safe_str_list(item.get("references")),
        "raw": _clean_case_exchange_raw(
            item,
            alert=alert,
            projection_key=projection_key,
            external_id=external_id,
        ),
    }

    ser = CaseExchangeCreateSerializer(data=payload)
    ser.is_valid(raise_exception=True)
    return dict(ser.validated_data)


def _dispatch_materialized_case_exchange_events(case_id: str, exchange_id: str, actor):
    case = Event.objects.filter(id=case_id, is_deleted=False).first()
    if not case:
        return

    exchange = CaseExchange.objects.filter(id=exchange_id, case=case).first()
    if not exchange:
        return

    try:
        dispatch_case_exchange_webhooks(case, exchange, actor)
    except Exception:
        pass

    exchange_event = (
        "case.exchange_inbound_received"
        if exchange.direction == CaseExchange.Direction.INBOUND
        else "case.exchange_outbound_created"
    )

    _run_automation_safely(
        scope="case",
        target=case,
        event=exchange_event,
        actor=actor,
        data={
            "exchange": exchange,
            "exchange_id": str(exchange.id),
            "direction": exchange.direction,
            "source": "alert.raw.case_exchanges",
        },
    )


def _materialize_alert_case_exchanges(*, case: Event, alert: Alert, actor, request=None) -> int:
    created_count = 0
    items = _get_alert_case_exchange_items(alert)

    for idx, item in enumerate(items):
        payload = _build_case_exchange_payload_from_alert_item(alert=alert, item=item, idx=idx)

        if payload is None:
            continue

        message_id = payload.get("message_id") or ""
        raw_payload = payload.get("raw") or {}
        alert_exchange = raw_payload.get("alert_exchange") or {}
        projection_key = alert_exchange.get("projection_key") or ""
        external_id = alert_exchange.get("external_id") or ""

        if message_id:
            defaults = dict(payload)
            defaults.pop("message_id", None)
            defaults["created_by"] = actor if getattr(actor, "is_authenticated", False) else None

            try:
                exchange, created = CaseExchange.objects.get_or_create(
                    case=case,
                    message_id=message_id,
                    defaults=defaults,
                )
            except IntegrityError:
                exchange = CaseExchange.objects.filter(case=case, message_id=message_id).first()
                created = False
        else:
            existing_qs = CaseExchange.objects.filter(
                case=case,
                raw__alert_exchange__source_alert_id=str(alert.id),
                raw__alert_exchange__projection_key=str(projection_key),
            )

            if external_id:
                existing_qs = CaseExchange.objects.filter(
                    case=case,
                    raw__alert_exchange__external_id=str(external_id),
                )

            if existing_qs.exists():
                continue

            exchange = CaseExchange.objects.create(
                case=case,
                created_by=actor if getattr(actor, "is_authenticated", False) else None,
                **payload,
            )
            created = True

        if not created or not exchange:
            continue

        created_count += 1

        TimelineItem.objects.create(
            event=case,
            alert=alert,
            date=date.today(),
            type="case_exchange_created",
            text=f"Exchange created from alert: {(exchange.subject or '(no subject)')}",
            actor=actor,
        )

        audit_event(
            request,
            action="case.exchange.created_from_alert",
            object_type="case_exchange",
            object_id=str(exchange.id),
            object_repr=(exchange.subject or "")[:255],
            metadata={
                "case_id": str(case.id),
                "alert_id": str(alert.id),
                "direction": exchange.direction,
                "channel": exchange.channel,
                "message_id": exchange.message_id or "",
            },
        )

        transaction.on_commit(
            lambda case_id=str(case.id), exchange_id=str(exchange.id), actor=actor: _dispatch_materialized_case_exchange_events(
                case_id,
                exchange_id,
                actor,
            )
        )

    return created_count


def _audit_hunt_meta(hunt: Hunt, extra: dict | None = None) -> dict:
    data = {
        "hunt_id": _str_or_empty(getattr(hunt, "id", None)),
        "customer_id": _str_or_empty(getattr(hunt, "customer_id", None)),
    }
    if extra:
        data.update(extra)
    return data


def _audit_task_meta(task: Task, extra: dict | None = None) -> dict:
    try:
        customer_ids = [str(x) for x in task.customers.values_list("id", flat=True)]
    except Exception:
        customer_ids = []

    data = {
        "task_id": _str_or_empty(getattr(task, "id", None)),
        "customer_ids": customer_ids,
    }
    if extra:
        data.update(extra)
    return data


def _run_automation_safely(*, scope: str, target, event: str, actor=None, data: dict | None = None):
    try:
        from .services_automation import run_automation_rules_for_event

        run_automation_rules_for_event(
            scope=scope,
            target=target,
            event=event,
            actor=actor,
            data=data or {},
        )
    except Exception as exc:
        try:
            audit_event(
                None,
                action="automation.execution.failed",
                object_type=scope,
                object_id=str(getattr(target, "id", "") or ""),
                object_repr=str(getattr(target, "title", "") or "")[:255],
                success=False,
                status_code=500,
                metadata={
                    "event": event,
                    "error": str(exc)[:500],
                },
            )
        except Exception:
            pass


###############
### Users
###############
class UserLiteListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "settings.access.users.view"

    def list(self, request, *args, **kwargs):
        q = request.query_params.get("q", "").strip()
        qs = User.objects.all().order_by("username")
        if q:
            qs = qs.filter(username__icontains=q)

        data = [{"id": u.id, "username": u.username} for u in qs[:200]]
        return Response(data)


###############
### Alerts
###############
class AlertViewSet(
    mixins.CreateModelMixin,
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = AlertSerializer
    def get_permissions(self):
        if getattr(self, "action", None) == "create":
            self.required_permission = "alert.add"
        else:
            self.required_permission = "alert.view"
        return super().get_permissions()

    def get_queryset(self):
        qs = Alert.objects.filter(is_deleted=False).order_by("-created_at")
        if self.request.user.is_staff:
            return qs
        customer_ids = get_accessible_customer_ids(self.request.user)
        return qs.filter(customer_id__in=customer_ids)

    serializer_class = AlertSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def perform_create(self, serializer):
        inst = serializer.save(created_by=self.request.user)

        audit_event(
            self.request,
            action="alert.created",
            object_type="alert",
            object_id=str(inst.id),
            object_repr=inst.title or "",
            metadata={"status": getattr(inst, "status", None), "customer_id": str(getattr(inst, "customer_id", "") or "")},
        )


class AlertListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    serializer_class = AlertSerializer

    def initial(self, request, *args, **kwargs):
        self.required_permission = "alert.view" if request.method == "GET" else "alert.add"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        user = self.request.user

        qs = (
            Alert.objects
            .filter(is_deleted=False)
            .select_related("customer", "owner", "case")
        )

        if not user.is_staff:
            customer_ids = get_accessible_customer_ids(user)
            qs = qs.filter(customer_id__in=customer_ids)

        search = (self.request.query_params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(title__icontains=search)
                | Q(description__icontains=search)
                | Q(source__icontains=search)
            )

        status_list = _getlist_or_single(self.request, "status")
        if status_list:
            status_q = Q()

            normalized_statuses = []
            for value in status_list:
                v = (value or "").strip()
                if not v:
                    continue

                if v == "merged":
                    status_q |= Q(case__isnull=False) | Q(status=Alert.Status.MERGED)
                    continue

                if v == Alert.Status.CLOSED:
                    status_q |= Q(status=Alert.Status.CLOSED, case__isnull=True)
                    continue

                normalized_statuses.append(v)

            if normalized_statuses:
                status_q |= Q(status__in=normalized_statuses, case__isnull=True)

            qs = qs.filter(status_q) if status_q else qs.none()

        severity_list = _getlist_or_single(self.request, "severity")
        if severity_list:
            qs = qs.filter(severity__in=severity_list)

        classification_list = _getlist_or_single(self.request, "classification")
        if classification_list:
            qs = qs.filter(classification__in=classification_list)

        outcome_list = _getlist_or_single(self.request, "outcome")
        if outcome_list:
            qs = qs.filter(outcome__in=outcome_list)

        owner_raw = _getlist_or_single(self.request, "owner")
        owner_ids = []
        for raw in owner_raw:
            try:
                owner_ids.append(int(raw))
            except Exception:
                pass
        if owner_ids:
            qs = qs.filter(owner_id__in=owner_ids)

        customer_raw = (
            _getlist_or_single(self.request, "customer")
            or _getlist_or_single(self.request, "customer_id")
        )
        customer_ids_filter = []
        for raw in customer_raw:
            try:
                customer_ids_filter.append(str(UUID(str(raw))))
            except Exception:
                return qs.none()

        if customer_ids_filter:
            qs = qs.filter(customer_id__in=customer_ids_filter)

        ordering = (self.request.query_params.get("ordering") or "-created_at").strip()

        ordering_map = {
            "created_at": "created_at",
            "-created_at": "-created_at",
            "title": "title",
            "-title": "-title",
            "status": "status",
            "-status": "-status",
            "severity": "severity",
            "-severity": "-severity",
            "classification": "classification",
            "-classification": "-classification",
            "outcome": "outcome",
            "-outcome": "-outcome",
            "customer": "customer__name",
            "-customer": "-customer__name",
            "owner": "owner__username",
            "-owner": "-owner__username",
        }

        qs = qs.order_by(ordering_map.get(ordering, "-created_at"), "-created_at", "id")

        return qs

    def perform_create(self, serializer):
        user = self.request.user

        requested_owner = serializer.validated_data.get("owner")

        if requested_owner and not user.is_staff and requested_owner != user:
            raise PermissionDenied("Only staff can assign another owner.")
        
        owner = requested_owner if requested_owner and user.is_staff else user
        if not user.is_staff:
            allowed = set(str(x) for x in get_accessible_customer_ids(user))
            cust = serializer.validated_data.get("customer", None)
            if cust is not None and str(getattr(cust, "id", "")) not in allowed:
                raise PermissionDenied("Customer not accessible.")
    
        event = serializer.save(owner=owner)
        if getattr(event, "customer_id", None) is None:
            default_customer = get_default_customer()
            if default_customer:
                event.customer = default_customer
                event.save(update_fields=["customer"])

        audit_event(
            self.request,
            action="alert.created",
            object_type="alert",
            object_id=str(event.id),
            object_repr=event.title or "",
            metadata=_audit_alert_meta(
                event,
                {
                    "status": getattr(event, "status", None),
                    "severity": getattr(event, "severity", None),
                    "classification": getattr(event, "classification", None),
                    "source": getattr(event, "source", "") or "",
                },
            ),
        )

        _run_automation_safely(
            scope="alert",
            target=event,
            event="alert.created",
            actor=self.request.user,
            data={},
        )


class AlertRetrieveView(generics.RetrieveAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "alert.view"
    serializer_class = AlertSerializer

    def get_queryset(self):
        qs = Alert.objects.filter(is_deleted=False)
        if self.request.user.is_staff:
            return qs
        customer_ids = get_accessible_customer_ids(self.request.user)
        return qs.filter(customer_id__in=customer_ids)


class AlertListForEventView(generics.ListAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.view"
    serializer_class = AlertSerializer
    event_id_kwarg = "event_id"

    def get_event(self):
        event_id = self.kwargs["event_id"]
        qs = Event.objects.filter(is_deleted=False)
        if not self.request.user.is_staff:
            customer_ids = get_accessible_customer_ids(self.request.user)
            qs = qs.filter(customer_id__in=customer_ids)
        event = get_object_or_404(qs, id=event_id)
        _check_case_access(self.request, event)
        return event

    def get_queryset(self):
        event = self.get_event()
        return Alert.objects.filter(case=event, is_deleted=False).order_by("-created_at")


class AlertEscalateToCaseView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "alert.merge"

    def post(self, request, pk):
        if request.user.is_staff:
            base_alert = get_object_or_404(Alert, pk=pk, is_deleted=False)
        else:
            customer_ids = get_accessible_customer_ids(request.user)
            base_alert = get_object_or_404(
                Alert.objects.filter(is_deleted=False, customer_id__in=customer_ids),
                pk=pk,
            )

        alerts = _get_alerts_for_new_case_merge(request, base_alert)

        already_linked = [a for a in alerts if a.case_id]
        if already_linked:
            first = already_linked[0]
            return Response(
                {
                    "alert_id": str(first.id),
                    "conflict": True,
                    "current_case_id": str(first.case_id),
                },
                status=status.HTTP_409_CONFLICT,
            )

        force_null = bool(request.data.get("force_case_customer_null"))

        distinct_customer_ids = {
            str(a.customer_id) for a in alerts if getattr(a, "customer_id", None)
        }
        default_customer = get_default_customer()

        if force_null or len(distinct_customer_ids) > 1:
            case_customer = None
        else:
            first_customer = next((a.customer for a in alerts if a.customer_id), None)
            case_customer = first_customer or default_customer

        case_title = base_alert.title
        case_description = _join_alert_descriptions(alerts)

        with transaction.atomic():
            case = Event.objects.create(
                title=case_title,
                description=case_description,
                status="open",
                classification=base_alert.classification,
                severity=base_alert.severity,
                owner=request.user,
                customer=case_customer,
            )

            TimelineItem.objects.create(
                event=case,
                date=date.today(),
                type="case_created",
                text="Case created (from alert escalation)",
                actor=request.user,
            )

            created_exchange_count = 0

            for idx, alert in enumerate(alerts):
                previous_status = _alert_status_before_merge(alert)
                update_fields = ["case", "status", "status_before_merge"]

                if (
                    case.customer_id
                    and not force_null
                    and len(distinct_customer_ids) <= 1
                    and not alert.customer_id
                ):
                    alert.customer_id = case.customer_id
                    update_fields.append("customer")

                alert.case = case
                alert.status_before_merge = previous_status
                alert.status = Alert.Status.MERGED
                alert.save(update_fields=update_fields)

                created_exchange_count += _materialize_alert_case_exchanges(
                    case=case,
                    alert=alert,
                    actor=request.user,
                    request=request,
                )

                TimelineItem.objects.create(
                    event=case,
                    alert=alert,
                    date=date.today(),
                    type="alert_linked",
                    text=f"Alert {'escalated' if idx == 0 else 'linked'}: {alert.title}",
                    actor=request.user,
                )

                audit_event(
                    request,
                    action="alert.escalated_to_case" if idx == 0 else "alert.linked_to_case",
                    object_type="alert",
                    object_id=str(alert.id),
                    object_repr=alert.title or "",
                    metadata={"case_id": str(case.id)},
                )

            audit_event(
                request,
                action="case.created",
                object_type="case",
                object_id=str(case.id),
                object_repr=case.title or "",
                metadata={
                    "source": "alert.escalate",
                    "alert_ids": [str(a.id) for a in alerts],
                },
            )

        _run_automation_safely(
            scope="case",
            target=case,
            event="case.created",
            actor=request.user,
            data={
                "alert_ids": [str(a.id) for a in alerts],
                "source_alert_id": str(base_alert.id),
                "created_from_alert_escalation": True,
            },
        )

        return Response(
            {
                "alert_id": str(base_alert.id),
                "case_id": str(case.id),
                "linked": True,
                "created_case": True,
                "created_exchange_count": created_exchange_count,
            },
            status=status.HTTP_201_CREATED,
        )


class AlertLinkToCaseView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "alert.merge"

    def post(self, request, pk):
        case_id = request.data.get("case_id")
        if not case_id:
            return Response({"error": "case_id_required"}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            alert_qs = Alert.objects.select_for_update().filter(pk=pk, is_deleted=False)
            if not request.user.is_staff:
                customer_ids = get_accessible_customer_ids(request.user)
                alert_qs = alert_qs.filter(customer_id__in=customer_ids)

            alert = get_object_or_404(alert_qs)

            case_qs = Event.objects.select_for_update().filter(pk=case_id, is_deleted=False)
            if not request.user.is_staff:
                customer_ids = get_accessible_customer_ids(request.user)
                case_qs = case_qs.filter(customer_id__in=customer_ids)

            case = get_object_or_404(case_qs)

            _check_case_manage_access(request, case)
            case_sources_before = _case_alert_sources_for_automation(case)

            if alert.case_id == case.id:
                if alert.status != Alert.Status.MERGED:
                    alert.status_before_merge = _alert_status_before_merge(alert)
                    alert.status = Alert.Status.MERGED
                    alert.save(update_fields=["status", "status_before_merge"])

                created_exchange_count = _materialize_alert_case_exchanges(
                    case=case,
                    alert=alert,
                    actor=request.user,
                    request=request,
                )

                case_sources_after = _case_alert_sources_for_automation(case)

                transaction.on_commit(
                    lambda case_id=str(case.id), actor=request.user, sources=case_sources_after, alert_id=str(alert.id): _run_automation_safely(
                        scope="case",
                        target=Event.objects.get(id=case_id),
                        event="case.alert_linked",
                        actor=actor,
                        data={
                            "alert_id": alert_id,
                            "before": {
                                "source": sources,
                            },
                            "after": {
                                "source": sources,
                            },
                        },
                    )
                )

                return Response(
                    {
                        "alert_id": str(alert.id),
                        "case_id": str(case.id),
                        "already_linked": True,
                        "status": Alert.Status.MERGED,
                        "created_exchange_count": created_exchange_count,
                    },
                    status=status.HTTP_200_OK,
                )

            if alert.case_id and alert.case_id != case.id:
                return Response(
                    {
                        "alert_id": str(alert.id),
                        "conflict": True,
                        "current_case_id": str(alert.case_id),
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            if alert.customer_id and case.customer_id and alert.customer_id != case.customer_id:
                return Response(
                    {
                        "error": "customer_mismatch",
                        "detail": "Alert and Case customers must match.",
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            case_update_fields = []
            if not case.customer_id and alert.customer_id:
                case.customer_id = alert.customer_id
                case_update_fields.append("customer")

            previous_status = _alert_status_before_merge(alert)
            alert_update_fields = ["case", "status", "status_before_merge"]

            if not alert.customer_id and case.customer_id:
                alert.customer_id = case.customer_id
                alert_update_fields.append("customer")

            if case_update_fields:
                case.save(update_fields=case_update_fields)

            alert.case = case
            alert.status_before_merge = previous_status
            alert.status = Alert.Status.MERGED
            alert.save(update_fields=alert_update_fields)

            created_exchange_count = _materialize_alert_case_exchanges(
                case=case,
                alert=alert,
                actor=request.user,
                request=request,
            )

            TimelineItem.objects.create(
                event=case,
                alert=alert,
                date=date.today(),
                type="alert_linked",
                text=f"Alert linked: {alert.title}",
                actor=request.user,
            )

            audit_event(
                request,
                action="alert.linked_to_case",
                object_type="alert",
                object_id=str(alert.id),
                object_repr=alert.title or "",
                metadata={
                    "case_id": str(case.id),
                    "previous_status": previous_status,
                    "new_status": Alert.Status.MERGED,
                },
            )

            case_sources_after = _case_alert_sources_for_automation(case)

            transaction.on_commit(
                lambda case_id=str(case.id), actor=request.user, before_sources=case_sources_before, after_sources=case_sources_after, alert_id=str(alert.id): _run_automation_safely(
                    scope="case",
                    target=Event.objects.get(id=case_id),
                    event="case.alert_linked",
                    actor=actor,
                    data={
                        "alert_id": alert_id,
                        "before": {
                            "source": before_sources,
                        },
                        "after": {
                            "source": after_sources,
                        },
                    },
                )
            )

            return Response(
                {
                    "alert_id": str(alert.id),
                    "case_id": str(case.id),
                    "linked": True,
                    "status": Alert.Status.MERGED,
                    "previous_status": previous_status,
                    "created_exchange_count": created_exchange_count,
                },
                status=status.HTTP_200_OK,
            )


class AlertRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    serializer_class = AlertSerializer
    queryset = Alert.objects.filter(is_deleted=False)

    def initial(self, request, *args, **kwargs):
        if request.method == "DELETE":
            self.required_permission = "alert.delete"
        elif request.method in ("PATCH", "PUT"):
            self.required_permission = "alert.update"
        else:
            self.required_permission = "alert.view"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        user = self.request.user
        qs = Alert.objects.filter(is_deleted=False)

        if user.is_staff:
            return qs

        customer_ids = get_accessible_customer_ids(user)
        return qs.filter(customer_id__in=customer_ids)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["is_deleted", "deleted_at"])

        audit_event(
            self.request,
            action="alert.deleted",
            object_type="alert",
            object_id=str(instance.id),
            object_repr=instance.title or "",
            metadata=_audit_alert_meta(
                instance,
                {
                    "soft": True,
                },
            ),
        )

        if getattr(instance, "case_id", None):
            TimelineItem.objects.create(
                event=instance.case,
                alert=instance,
                date=date.today(),
                type="alert_deleted",
                text=f"Alert deleted: {instance.title}",
                actor=self.request.user,
            )

    def perform_update(self, serializer):
        inst = serializer.instance
        before = {
            "title": getattr(inst, "title", None),
            "description": getattr(inst, "description", None),
            "status": getattr(inst, "status", None),
            "severity": getattr(inst, "severity", None),
            "classification": getattr(inst, "classification", None),
            "source": getattr(inst, "source", None),
            "customer_id": str(getattr(inst, "customer_id", "") or ""),
            "owner_id": getattr(inst, "owner_id", None),
            "case_id": str(getattr(inst, "case_id", "") or ""),
            "iocs": list(getattr(inst, "iocs", None) or []),
            "assets": list(getattr(inst, "assets", None) or []),
        }

        if not self.request.user.is_staff and "customer" in serializer.validated_data:
            customer = serializer.validated_data.get("customer")
            allowed = set(str(x) for x in get_accessible_customer_ids(self.request.user))
            if customer and str(customer.id) not in allowed:
                raise PermissionDenied("Customer not accessible.")

        updated = serializer.save()

        after = {
            "title": getattr(updated, "title", None),
            "description": getattr(updated, "description", None),
            "status": getattr(updated, "status", None),
            "severity": getattr(updated, "severity", None),
            "classification": getattr(updated, "classification", None),
            "source": getattr(updated, "source", None),
            "customer_id": str(getattr(updated, "customer_id", "") or ""),
            "owner_id": getattr(updated, "owner_id", None),
            "case_id": str(getattr(updated, "case_id", "") or ""),
            "iocs": list(getattr(updated, "iocs", None) or []),
            "assets": list(getattr(updated, "assets", None) or []),
        }

        audit_event(
            self.request,
            action="alert.updated",
            object_type="alert",
            object_id=str(updated.id),
            object_repr=updated.title or "",
            metadata=_audit_alert_meta(
                updated,
                {
                    "updated_fields": [
                        key
                        for key in before.keys()
                        if before.get(key) != after.get(key)
                    ],
                    "content_redacted": True,
                },
            ),
        )

        _run_automation_safely(
            scope="alert",
            target=updated,
            event="alert.updated",
            actor=self.request.user,
            data={
                "before": before,
                "after": after,
            },
        )

        if getattr(updated, "case_id", None):
            TimelineItem.objects.create(
                event=updated.case,
                alert=updated,
                date=date.today(),
                type="alert_updated",
                text=f"Alert updated: {updated.title}",
                actor=self.request.user,
            )


class AlertUnmergeView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "alert.unmerge"

    def post(self, request, pk):
        with transaction.atomic():
            alert_qs = Alert.objects.select_for_update().filter(pk=pk, is_deleted=False)
            if not request.user.is_staff:
                customer_ids = get_accessible_customer_ids(request.user)
                alert_qs = alert_qs.filter(customer_id__in=customer_ids)

            alert = get_object_or_404(alert_qs)

            if alert.case_id is None:
                return Response({"detail": "Alert is not linked to a case."}, status=status.HTTP_400_BAD_REQUEST)

            case_event = alert.case
            _check_case_manage_access(request, case_event)
            case_sources_before = _case_alert_sources_for_automation(case_event)

            restored_status = _alert_status_before_merge(alert)

            alert.case = None
            alert.status = restored_status
            alert.status_before_merge = ""
            alert.save(update_fields=["case", "status", "status_before_merge"])

            TimelineItem.objects.create(
                event=case_event,
                alert=alert,
                date=date.today(),
                type="alert_unmerged",
                text=f"Alert unmerged: {alert.title}",
                actor=request.user,
            )

            audit_event(
                request,
                action="alert.unmerged",
                object_type="alert",
                object_id=str(alert.id),
                object_repr=alert.title or "",
                metadata={
                    "case_id": str(case_event.id),
                    "restored_status": restored_status,
                },
            )

            case_sources_after = _case_alert_sources_for_automation(case_event)

            transaction.on_commit(
                lambda case_id=str(case_event.id), actor=request.user, before_sources=case_sources_before, after_sources=case_sources_after, alert_id=str(alert.id): _run_automation_safely(
                    scope="case",
                    target=Event.objects.get(id=case_id),
                    event="case.alert_unmerged",
                    actor=actor,
                    data={
                        "alert_id": alert_id,
                        "before": {
                            "source": before_sources,
                        },
                        "after": {
                            "source": after_sources,
                        },
                    },
                )
            )

            return Response(
                {
                    "detail": "Alert unmerged.",
                    "alert_id": str(alert.id),
                    "case_id": str(case_event.id),
                    "status": restored_status,
                },
                status=status.HTTP_200_OK,
            )


class AlertDeleteView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "alert.delete"

    def post(self, request, pk):
        if request.user.is_staff:
            alert = get_object_or_404(Alert, pk=pk, is_deleted=False)
        else:
            customer_ids = get_accessible_customer_ids(request.user)
            alert = get_object_or_404(
                Alert.objects.filter(is_deleted=False, customer_id__in=customer_ids),
                pk=pk,
            )

        if (
            not request.user.is_staff
            and alert.created_by_id != request.user.id
            and not alert.members.filter(id=request.user.id).exists()
        ):
            raise PermissionDenied("Access denied.")

        case_event = alert.case
        alert.is_deleted = True
        alert.deleted_at = timezone.now()
        alert.save(update_fields=["is_deleted", "deleted_at"])

        audit_event(
            request,
            action="alert.deleted",
            object_type="alert",
            object_id=str(alert.id),
            object_repr=alert.title or "",
            metadata=_audit_alert_meta(
                alert,
                {
                    "soft": True,
                    "via": "alert.delete.endpoint",
                },
            ),
        )

        if case_event:
            TimelineItem.objects.create(
                event=case_event,
                alert=alert,
                date=date.today(),
                type="alert_deleted",
                text=f"Alert deleted: {alert.title}",
                actor=request.user,
            )

        return Response({"alert_id": str(alert.id), "deleted": True}, status=status.HTTP_200_OK)


class AlertCommentListCreateForAlertView(generics.ListCreateAPIView):
    serializer_class = AlertCommentSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    alert_id_kwarg = "alert_id"
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        self.required_permission = "alert.view" if request.method == "GET" else "alert.update"
        super().initial(request, *args, **kwargs)

    def get_alert(self) -> Alert:
        qs = Alert.objects.filter(id=self.kwargs["alert_id"], is_deleted=False)

        if not self.request.user.is_staff:
            customer_ids = get_accessible_customer_ids(self.request.user)
            qs = qs.filter(customer_id__in=customer_ids)

        alert = qs.first()
        if not alert:
            raise PermissionDenied("Alert not accessible.")
        return alert


    def get_queryset(self):
        alert = self.get_alert()
        return AlertComment.objects.filter(alert=alert).order_by("created_at")

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        data = self.get_serializer(qs, many=True).data
        return Response(data, status=status.HTTP_200_OK)

    def perform_create(self, serializer):
        alert = self.get_alert()
        inst = serializer.save(alert=alert, author=self.request.user)

        audit_event(
            self.request,
            action="alert.comment.created",
            object_type="alert_comment",
            object_id=str(inst.id),
            object_repr="Alert comment",
            metadata=_audit_alert_meta(
                alert,
                {
                    "updated_section": "comment",
                    "content_redacted": True,
                },
            ),
        )


class AlertCommentRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = AlertCommentSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = "alert.view" if request.method == "GET" else "alert.update"
        super().initial(request, *args, **kwargs)

    def get_object(self):
        obj = (
            AlertComment.objects
            .select_related("alert")
            .filter(id=self.kwargs["pk"], alert__is_deleted=False)
            .first()
        )
        if not obj:
            raise PermissionDenied("Comment not found.")

        if not self.request.user.is_staff:
            customer_ids = get_accessible_customer_ids(self.request.user)
            if obj.alert.customer_id not in customer_ids:
                raise PermissionDenied("Comment not accessible.")

        return obj

    def perform_update(self, serializer):
        inst = serializer.instance
        before = {
            "text": getattr(inst, "text", "") or "",
        }

        obj = serializer.save()

        audit_event(
            self.request,
            action="alert.comment.updated",
            object_type="alert_comment",
            object_id=str(obj.id),
            object_repr="Alert comment",
            metadata=_audit_alert_meta(
                obj.alert,
                {
                    "updated_section": "comment",
                    "updated_fields": ["text"],
                    "content_redacted": True,
                },
            ),
        )

    def perform_destroy(self, instance):
        alert = instance.alert
        comment_id = str(instance.id)

        instance.delete()

        audit_event(
            self.request,
            action="alert.comment.deleted",
            object_type="alert_comment",
            object_id=comment_id,
            object_repr="Alert comment",
            metadata=_audit_alert_meta(
                alert,
                {
                    "updated_section": "comment",
                    "content_redacted": True,
                },
            ),
        )


###############
### Cases
###############
def apply_case_template_to_payload(data: dict, tpl) -> dict:
    title = (data.get("title") or "").strip()
    prefix = (getattr(tpl, "title_prefix", None) or "").strip()
    if prefix:
        data["title"] = f"{prefix} {title}".strip()

    desc = (data.get("description") or "").strip()
    base = (getattr(tpl, "base_description", None) or "").rstrip()
    if base and desc:
        data["description"] = base + "\n\n" + desc
    elif base and not desc:
        data["description"] = base

    if not data.get("severity") and getattr(tpl, "default_severity", None):
        data["severity"] = tpl.default_severity

    if not data.get("classification") and getattr(tpl, "default_classification", None):
        data["classification"] = tpl.default_classification

    if not data.get("owner") and getattr(tpl, "default_owner_id", None):
        data["owner"] = tpl.default_owner_id

    if not data.get("customer") and getattr(tpl, "default_customer_id", None):
        data["customer"] = str(tpl.default_customer_id)

    if not data.get("workbook_template") and getattr(tpl, "workbook_template_id", None):
        data["workbook_template"] = str(tpl.workbook_template_id)

    return data


def create_workbook_instance_for_event(event: Event, template: WorkbookTemplate | None):
    if template is None:
        WorkbookInstance.objects.get_or_create(event=event, defaults={"template": None})
        return

    inst, created = WorkbookInstance.objects.get_or_create(
        event=event,
        defaults={"template": template},
    )
    if not created:
        return

    items = list(template.items.all().order_by("order", "id"))
    WorkbookInstanceItem.objects.bulk_create([
        WorkbookInstanceItem(
            instance=inst,
            label=it.label,
            order=it.order,
            is_done=False,
        )
        for it in items
    ])


class EventListCreateView(generics.ListCreateAPIView):
    serializer_class = EventSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    filter_backends = []

    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.view" if request.method == "GET" else "case.add"
        super().initial(request, *args, **kwargs)

    def get_serializer_class(self):
        if self.request.method == "GET":
            return EventListSerializer
        return EventSerializer
    
    def get_queryset(self):
        user = self.request.user
        qs = Event.objects.filter(is_deleted=False)

        recent_limit = timezone.now() - timezone.timedelta(hours=24)

        latest_comment_created_at = Comment.objects.filter(
            event_id=OuterRef("pk")
        ).order_by("-created_at").values("created_at")[:1]

        latest_inbound_exchange_created_at = CaseExchange.objects.filter(
            case_id=OuterRef("pk"),
            direction="inbound",
        ).order_by("-created_at").values("created_at")[:1]

        latest_auto_followup_exchange_created_at = CaseExchange.objects.filter(
            case_id=OuterRef("pk"),
            direction="outbound",
            raw__kind="auto_followup",
        ).order_by("-created_at").values("created_at")[:1]

        last_viewed_at = CaseUserState.objects.filter(
            event_id=OuterRef("pk"),
            user_id=self.request.user.id,
        ).values("last_viewed_at")[:1]

        qs = qs.annotate(
            latest_comment_created_at=Subquery(
                latest_comment_created_at,
                output_field=DateTimeField(),
            ),
            latest_inbound_exchange_created_at=Subquery(
                latest_inbound_exchange_created_at,
                output_field=DateTimeField(),
            ),
            latest_auto_followup_exchange_created_at=Subquery(
                latest_auto_followup_exchange_created_at,
                output_field=DateTimeField(),
            ),
            last_viewed_at=Subquery(
                last_viewed_at,
                output_field=DateTimeField(),
            ),
        )

        qs = qs.annotate(
            recent_activity_at=Greatest(
                Coalesce(
                    F("latest_comment_created_at"),
                    Value(datetime(1970, 1, 1, tzinfo=dt_timezone.utc), output_field=DateTimeField()),
                ),
                Coalesce(
                    F("latest_inbound_exchange_created_at"),
                    Value(datetime(1970, 1, 1, tzinfo=dt_timezone.utc), output_field=DateTimeField()),
                ),
                Coalesce(
                    F("latest_auto_followup_exchange_created_at"),
                    Value(datetime(1970, 1, 1, tzinfo=dt_timezone.utc), output_field=DateTimeField()),
                ),
            )
        )

        qs = qs.annotate(
            recent_activity_kind=Case(
                When(
                    latest_auto_followup_exchange_created_at__isnull=False,
                    recent_activity_at=F("latest_auto_followup_exchange_created_at"),
                    then=Value("auto_followup"),
                ),
                When(
                    latest_inbound_exchange_created_at__isnull=False,
                    recent_activity_at=F("latest_inbound_exchange_created_at"),
                    then=Value("inbound_exchange"),
                ),
                When(
                    latest_comment_created_at__isnull=False,
                    recent_activity_at=F("latest_comment_created_at"),
                    then=Value("comment"),
                ),
                default=Value(None),
                output_field=CharField(),
            ),
        )

        qs = qs.annotate(
            has_recent_activity=Case(
                When(
                    Q(recent_activity_at__isnull=False)
                    & Q(recent_activity_at__gte=recent_limit)
                    & (
                        Q(last_viewed_at__isnull=True)
                        | Q(recent_activity_at__gt=F("last_viewed_at"))
                    ),
                    then=Value(True),
                ),
                default=Value(False),
                output_field=BooleanField(),
            ),
        )

        def _get_list(param_name: str):
            vals = self.request.query_params.getlist(param_name)

            if len(vals) > 1:
                out = [v.strip() for v in vals if v and v.strip()]
            else:
                raw = (self.request.query_params.get(param_name) or "").strip()
                out = [x.strip() for x in raw.split(",") if x.strip()] if raw else []

            seen = set()
            dedup = []
            for v in out:
                if v not in seen:
                    dedup.append(v)
                    seen.add(v)
            return dedup

        qs = _apply_archived_filters(qs, self.request)

        customer_id = (self.request.query_params.get("customer") or "").strip()
        if customer_id:
            try:
                customer_id = str(UUID(str(customer_id)))
            except Exception:
                return qs.none()
            qs = qs.filter(customer_id=customer_id)

        if not user.is_staff:
            customer_ids = get_accessible_customer_ids(user)
            qs = qs.filter(customer_id__in=customer_ids)

        search = (self.request.query_params.get("search") or "").strip()
        if search:
            q_obj = Q(title__icontains=search) | Q(description__icontains=search)
            if search.isdigit():
                try:
                    q_obj = q_obj | Q(case_number=int(search))
                except Exception:
                    pass
            qs = qs.filter(q_obj)

        status_list = _get_list("status")
        if status_list:
            normalized_statuses = []
            wants_archived = False

            for value in status_list:
                v = (value or "").strip()
                if not v:
                    continue
                if v == Event.Status.ARCHIVED:
                    wants_archived = True
                else:
                    normalized_statuses.append(v)

            if wants_archived and normalized_statuses:
                qs = qs.filter(
                    Q(status__in=normalized_statuses) | Q(status=Event.Status.ARCHIVED)
                )
            elif wants_archived:
                qs = qs.filter(status=Event.Status.ARCHIVED)
            else:
                qs = qs.filter(status__in=normalized_statuses)


        severity_list = _get_list("severity")
        if severity_list:
            qs = qs.filter(severity__in=severity_list)

        classification_list = _get_list("classification")
        if classification_list:
            qs = qs.filter(classification__in=classification_list)

        outcome_list = _get_list("outcome")
        if outcome_list:
            qs = qs.filter(outcome__in=outcome_list)

        owner_raw = _get_list("owner")
        owner_ids = []
        for x in owner_raw:
            try:
                owner_ids.append(int(x))
            except Exception:
                pass
        if owner_ids:
            qs = qs.filter(owner_id__in=owner_ids)

        status_order = Case(
            When(status=Event.Status.OPEN, then=Value(0)),
            When(status=Event.Status.IN_PROGRESS, then=Value(1)),
            When(status=Event.Status.RESOLVED, then=Value(2)),
            When(status=Event.Status.CLOSED, then=Value(3)),
            When(status=Event.Status.ARCHIVED, then=Value(4)),
            default=Value(99),
            output_field=IntegerField(),
        )

        ordering = (self.request.query_params.get("ordering") or "-updated_at").strip()
        ordering_map = {
            "created_at": "created_at",
            "-created_at": "-created_at",
            "updated_at": "updated_at",
            "-updated_at": "-updated_at",
            "title": "title",
            "-title": "-title",
            "severity": "severity",
            "-severity": "-severity",
            "classification": "classification",
            "-classification": "-classification",
            "outcome": "outcome",
            "-outcome": "-outcome",
            "customer": "customer__name",
            "-customer": "-customer__name",
            "owner": "owner__username",
            "-owner": "-owner__username",
            "customer__name": "customer__name",
            "-customer__name": "-customer__name",
            "owner__username": "owner__username",
            "-owner__username": "-owner__username",
        }

        if ordering == "status":
            qs = qs.annotate(_so=status_order).order_by("_so", "-updated_at", "id")
        elif ordering == "-status":
            qs = qs.annotate(_so=status_order).order_by("-_so", "-updated_at", "id")
        elif ordering in ordering_map:
            qs = qs.order_by(ordering_map[ordering], "-updated_at", "id")
        else:
            qs = qs.order_by("-updated_at", "id")

        return qs

    def create(self, request, *args, **kwargs):
        data = request.data.copy()

        serializer = self.get_serializer(data=data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def perform_create(self, serializer):
        user = self.request.user

        workbook_template_id = serializer.validated_data.pop("workbook_template_id", None)

        requested_owner = serializer.validated_data.get("owner")

        if requested_owner and not user.is_staff and requested_owner != user:
            raise PermissionDenied("Only staff can assign another owner.")

        owner = requested_owner if requested_owner and user.is_staff else user

        if not user.is_staff:
            allowed = set(str(x) for x in get_accessible_customer_ids(user))
            cust = serializer.validated_data.get("customer", None)
            if cust is not None and str(getattr(cust, "id", "")) not in allowed:
                raise PermissionDenied("Customer not accessible.")

        event = serializer.save(owner=owner)

        if getattr(event, "customer_id", None) is None:
            default_customer = get_default_customer()
            if default_customer:
                event.customer = default_customer
                event.save(update_fields=["customer"])


        if workbook_template_id:
            wb = WorkbookTemplate.objects.filter(
                id=workbook_template_id, is_active=True
            ).first()
            create_workbook_instance_for_event(event, wb)

        TimelineItem.objects.create(
            event=event,
            date=date.today(),
            type="case_created",
            text="Case created",
            actor=user,
        )

        audit_event(
            self.request,
            action="case.created",
            object_type="case",
            object_id=str(event.id),
            object_repr=event.title or "",
            metadata=_audit_case_meta(
                event,
                {
                    "owner_id": getattr(event, "owner_id", None),
                    "severity": getattr(event, "severity", None),
                    "classification": getattr(event, "classification", None),
                    "status": getattr(event, "status", None),
                },
            ),
        )
        
        _run_automation_safely(
            scope="case",
            target=event,
            event="case.created",
            actor=self.request.user,
            data={},
        )


class EventRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated, IsOwnerOrMember, HasPermissionCode]
    http_method_names = ["get", "patch", "put", "delete"]

    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAuthenticated(), HasPermissionCode()]

        return [IsAuthenticated(), IsOwnerOrMember(), HasPermissionCode()]

    def initial(self, request, *args, **kwargs):
        if request.method == "DELETE":
            self.required_permission = "case.delete"
        elif request.method in ("PATCH", "PUT"):
            self.required_permission = "case.update"
        else:
            self.required_permission = "case.view"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        user = self.request.user
        qs = Event.objects.filter(is_deleted=False)

        if user.is_staff:
            return qs

        customer_ids = get_accessible_customer_ids(user)
        qs = qs.filter(customer_id__in=customer_ids)

        if self.request.method == "GET":
            return qs

        return qs.filter(Q(owner=user) | Q(members=user)).distinct()

    def get_serializer_class(self):
        if self.request.method == "GET":
            return EventDetailSerializer
        return EventSerializer

    def perform_update(self, serializer):
        event = self.get_object()
        old_status = event.status
        old_title = event.title
        old_description = event.description
        old_iocs = list(event.iocs or [])
        old_assets = list(event.assets or [])

        before = {
            "title": old_title,
            "description": old_description,
            "status": old_status,
            "severity": getattr(event, "severity", None),
            "classification": getattr(event, "classification", None),
            "outcome": getattr(event, "outcome", None),
            "customer_id": str(getattr(event, "customer_id", "") or ""),
            "iocs": old_iocs,
            "assets": old_assets,
            "owner_id": getattr(event, "owner_id", None),
        }

        updated_event = serializer.save()

        new_iocs = list(updated_event.iocs or [])
        new_assets = list(updated_event.assets or [])

        after = {
            "title": getattr(updated_event, "title", None),
            "description": getattr(updated_event, "description", None),
            "status": getattr(updated_event, "status", None),
            "severity": getattr(updated_event, "severity", None),
            "classification": getattr(updated_event, "classification", None),
            "outcome": getattr(updated_event, "outcome", None),
            "customer_id": str(getattr(updated_event, "customer_id", "") or ""),
            "iocs": new_iocs,
            "assets": new_assets,
            "owner_id": getattr(updated_event, "owner_id", None),
        }

        if old_status != updated_event.status:
            TimelineItem.objects.create(
                event=updated_event,
                date=date.today(),
                type="status_changed",
                text=f"Case status updated : {old_status} → {updated_event.status}",
                actor=self.request.user,
            )

        if old_title != updated_event.title or old_description != updated_event.description:
            TimelineItem.objects.create(
                event=updated_event,
                date=date.today(),
                type="case_updated",
                text="Case updated",
                actor=self.request.user,
            )

        if old_iocs != new_iocs:
            TimelineItem.objects.create(
                event=updated_event,
                date=date.today(),
                type="case_updated",
                text="IoCs updated",
                actor=self.request.user,
            )

            audit_event(
                self.request,
                action="case.iocs_updated",
                object_type="case",
                object_id=str(updated_event.id),
                object_repr=updated_event.title or "",
                metadata=_audit_case_meta(
                    updated_event,
                    {
                        "updated_section": "iocs",
                        "content_redacted": True,
                    },
                ),
            )

        if old_assets != new_assets:
            TimelineItem.objects.create(
                event=updated_event,
                date=date.today(),
                type="case_updated",
                text="Assets updated",
                actor=self.request.user,
            )

            audit_event(
                self.request,
                action="case.assets_updated",
                object_type="case",
                object_id=str(updated_event.id),
                object_repr=updated_event.title or "",
                metadata=_audit_case_meta(
                    updated_event,
                    {
                        "updated_section": "assets",
                        "content_redacted": True,
                    },
                ),
            )


        audit_event(
            self.request,
            action="case.updated",
            object_type="case",
            object_id=str(updated_event.id),
            object_repr=updated_event.title or "",
            metadata=_audit_case_meta(
                updated_event,
                {
                    "updated_sections": [
                        section
                        for section, changed in {
                            "summary": old_title != updated_event.title or old_description != updated_event.description,
                            "status": old_status != updated_event.status,
                            "iocs": old_iocs != new_iocs,
                            "assets": old_assets != new_assets,
                        }.items()
                        if changed
                    ],
                    "content_redacted": True,
                },
            ),
        )


        _run_automation_safely(
            scope="case",
            target=updated_event,
            event="case.updated",
            actor=self.request.user,
            data={
                "before": before,
                "after": after,
            },
        )

        try:
            from .services_automation import build_added_items_payload

            added_payload = build_added_items_payload(
                old_iocs,
                new_iocs,
                old_assets,
                new_assets,
            )

            for added_ioc in added_payload.get("added_iocs", []):
                _run_automation_safely(
                    scope="case",
                    target=updated_event,
                    event="case.ioc_added",
                    actor=self.request.user,
                    data={
                        "added_ioc": added_ioc,
                        "before": before,
                        "after": after,
                    },
                )

            for added_asset in added_payload.get("added_assets", []):
                _run_automation_safely(
                    scope="case",
                    target=updated_event,
                    event="case.asset_added",
                    actor=self.request.user,
                    data={
                        "added_asset": added_asset,
                        "before": before,
                        "after": after,
                    },
                )
        except Exception:
            pass


    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["is_deleted", "deleted_at"])

        TimelineItem.objects.create(
            event=instance,
            date=date.today(),
            type="case_deleted",
            text=f"Case deleted: {instance.title}",
            actor=self.request.user,
        )

        audit_event(
            self.request,
            action="case.deleted",
            object_type="case",
            object_id=str(instance.id),
            object_repr=instance.title or "",
            metadata=_audit_case_meta(
                instance,
                {
                    "soft": True,
                    "via": "case.detail.delete",
                },
            ),
        )


class CaseMarkViewedView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.view"

    def post(self, request, pk):
        if request.user.is_staff:
            event = get_object_or_404(Event.objects.filter(is_deleted=False), id=pk)
        else:
            customer_ids = get_accessible_customer_ids(request.user)
            event = get_object_or_404(
                Event.objects.filter(is_deleted=False, customer_id__in=customer_ids),
                id=pk,
            )
            _check_case_access(request, event)

        state, _ = CaseUserState.objects.get_or_create(
            event=event,
            user=request.user,
            defaults={"last_viewed_at": timezone.now()},
        )

        previous_last_viewed_at = state.last_viewed_at
        state.last_viewed_at = timezone.now()
        state.save(update_fields=["last_viewed_at"])

        audit_event(
            request,
            action="case.mark_viewed",
            object_type="case",
            object_id=str(event.id),
            object_repr=event.title or "",
            metadata=_audit_case_meta(
                event,
                {
                    "previous_last_viewed_at": previous_last_viewed_at.isoformat() if previous_last_viewed_at else None,
                    "last_viewed_at": state.last_viewed_at.isoformat() if state.last_viewed_at else None,
                },
            ),
        )

        return Response(
            {"detail": "Marked as viewed.", "last_viewed_at": state.last_viewed_at},
            status=status.HTTP_200_OK,
        )


class CaseListLiteView(generics.ListAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.view"

    def get_queryset(self):
        user = self.request.user

        qs = Event.objects.filter(is_deleted=False)

        qs = _apply_archived_filters(qs, self.request)

        if not user.is_staff:
            customer_ids = get_accessible_customer_ids(user)
            qs = qs.filter(customer_id__in=customer_ids)

        qs = qs.order_by("-updated_at")

        if user.is_staff:
            return qs

        return qs.filter(Q(owner=user) | Q(members=user)).distinct().order_by("-updated_at")

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        data = [
            {"id": str(x.id), "title": x.title, "status": x.status, "updated_at": x.updated_at.isoformat()}
            for x in qs[:200]
        ]
        return Response(data)


class CaseDeleteView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.delete"

    def post(self, request, pk):
        if request.user.is_staff:
            case = get_object_or_404(Event.objects.filter(is_deleted=False), pk=pk)
        else:
            customer_ids = get_accessible_customer_ids(request.user)
            case = get_object_or_404(
                Event.objects.filter(is_deleted=False, customer_id__in=customer_ids),
                pk=pk,
            )

        if (
            not request.user.is_staff
            and case.owner_id != request.user.id
            and not case.members.filter(id=request.user.id).exists()
        ):
            raise PermissionDenied("Access denied.")

        case.is_deleted = True
        case.deleted_at = timezone.now()
        case.save(update_fields=["is_deleted", "deleted_at"])

        TimelineItem.objects.create(
            event=case,
            date=date.today(),
            type="case_deleted",
            text=f"Case deleted: {case.title}",
            actor=request.user,
        )

        audit_event(
            request,
            action="case.deleted",
            object_type="case",
            object_id=str(case.id),
            object_repr=case.title or "",
            metadata=_audit_case_meta(
                case,
                {
                    "soft": True,
                    "via": "case.delete.endpoint",
                },
            ),
        )

        return Response({"case_id": str(case.id), "deleted": True}, status=status.HTTP_200_OK)


class CaseArchiveView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.update"

    def post(self, request, pk):
        if request.user.is_staff:
            event = get_object_or_404(Event.objects.filter(is_deleted=False), id=pk)
        else:
            customer_ids = get_accessible_customer_ids(request.user)
            event = get_object_or_404(
                Event.objects.filter(is_deleted=False, customer_id__in=customer_ids),
                id=pk,
            )

        if (
            not request.user.is_staff
            and event.owner_id != request.user.id
            and not event.members.filter(id=request.user.id).exists()
        ):
            raise PermissionDenied("Case not found.")

        updated_fields = []
        if not getattr(event, "archived_at", None):
            event.archived_at = timezone.now()
            updated_fields.append("archived_at")

        if getattr(event, "status", None) != Event.Status.ARCHIVED:
            event.status = Event.Status.ARCHIVED
            updated_fields.append("status")

        if updated_fields:
            event.save(update_fields=updated_fields)

        TimelineItem.objects.create(
            event=event,
            date=timezone.now().date(),
            type="case_archived",
            text="Case archived",
            actor=request.user,
        )

        audit_event(
            request,
            action="case.archived",
            object_type="case",
            object_id=str(event.id),
            object_repr=event.title or "",
            metadata={},
        )

        return Response({"detail": "Archived."}, status=status.HTTP_200_OK)


class CaseUnarchiveView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.update"

    def post(self, request, pk):
        if request.user.is_staff:
            event = get_object_or_404(Event.objects.filter(is_deleted=False), id=pk)
        else:
            customer_ids = get_accessible_customer_ids(request.user)
            event = get_object_or_404(
                Event.objects.filter(is_deleted=False, customer_id__in=customer_ids),
                id=pk,
            )

        if (
            not request.user.is_staff
            and event.owner_id != request.user.id
            and not event.members.filter(id=request.user.id).exists()
        ):
            raise PermissionDenied("Case not found.")

        now = timezone.now()
        updated_fields = []

        if getattr(event, "archived_at", None) is not None:
            event.archived_at = None
            updated_fields.append("archived_at")

        event.unarchived_at = now
        updated_fields.append("unarchived_at")

        if getattr(event, "status", None) == Event.Status.ARCHIVED:
            event.status = Event.Status.CLOSED
            updated_fields.append("status")

        if updated_fields:
            event.save(update_fields=updated_fields)

        TimelineItem.objects.create(
            event=event,
            date=now.date(),
            type="case_unarchived",
            text="Case unarchived",
            actor=request.user,
        )

        audit_event(
            request,
            action="case.unarchived",
            object_type="case",
            object_id=str(event.id),
            object_repr=event.title or "",
            metadata={},
        )

        return Response({"detail": "Unarchived."}, status=status.HTTP_200_OK)



###############
### Activity
###############
class TimelineItemListCreateForEventView(generics.ListCreateAPIView):
    serializer_class = TimelineItemSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    event_id_kwarg = "event_id"

    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.view" if request.method == "GET" else "case.update"
        super().initial(request, *args, **kwargs)

    def get_event(self) -> Event:
        event_id = self.kwargs["event_id"]
        qs = Event.objects.filter(is_deleted=False)
        if not self.request.user.is_staff:
            customer_ids = get_accessible_customer_ids(self.request.user)
            qs = qs.filter(customer_id__in=customer_ids)
        event = get_object_or_404(qs, id=event_id)
        _check_case_access(self.request, event)
        return event

    def get_queryset(self):
        event = self.get_event()
        return TimelineItem.objects.filter(event=event).order_by("date", "created_at")

    def perform_create(self, serializer):
        event = self.get_event()
        _check_case_manage_access(self.request, event)
        inst = serializer.save(event=event)

        audit_event(
            self.request,
            action="case.timeline.created",
            object_type="case",
            object_id=str(event.id),
            object_repr="Timeline event created",
            metadata={
                "case_id": str(event.id),
                "updated_section": "timeline",
                "timeline_type": getattr(inst, "type", None),
                "content_redacted": True,
            },
        )


class TimelineItemRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TimelineItemSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.view" if request.method == "GET" else "case.update"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        user = self.request.user
        qs = TimelineItem.objects.all()
        if user.is_staff:
            return qs
        customer_ids = get_accessible_customer_ids(user)
        return qs.filter(
            Q(event__customer_id__in=customer_ids),
            Q(event__owner=user) | Q(event__members=user),
        ).distinct()

    def perform_update(self, serializer):
        item = serializer.instance
        _check_case_manage_access(self.request, item.event)

        inst = serializer.save()
        audit_event(
            self.request,
            action="case.timeline.updated",
            object_type="timeline_item",
            object_id=str(inst.id),
            object_repr=(getattr(inst, "type", "") or "")[:80],
            metadata={"event_id": str(getattr(inst, "event_id", "") or "")},
        )

    def perform_destroy(self, instance):
        _check_case_manage_access(self.request, instance.event)

        audit_event(
            self.request,
            action="case.timeline.deleted",
            object_type="timeline_item",
            object_id=str(instance.id),
            object_repr=(getattr(instance, "type", "") or "")[:80],
            metadata={"event_id": str(getattr(instance, "event_id", "") or "")},
        )
        return super().perform_destroy(instance)


###############
### Comments
###############
class CommentListCreateForEventView(generics.ListCreateAPIView):
    serializer_class = CommentSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    event_id_kwarg = "event_id"
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.view" if request.method == "GET" else "case.update"
        super().initial(request, *args, **kwargs)

    def get_event(self) -> Event:
        event_id = self.kwargs["event_id"]
        qs = Event.objects.filter(is_deleted=False)
        if not self.request.user.is_staff:
            customer_ids = get_accessible_customer_ids(self.request.user)
            qs = qs.filter(customer_id__in=customer_ids)
        event = get_object_or_404(qs, id=event_id)
        _check_case_access(self.request, event)
        return event

    def get_queryset(self):
        event = self.get_event()
        return Comment.objects.filter(event=event).order_by("created_at")

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        data = self.get_serializer(qs, many=True).data
        return Response(data, status=status.HTTP_200_OK)

    def perform_create(self, serializer):
        event = self.get_event()
        _check_case_manage_access(self.request, event)
        inst = serializer.save(event=event, author=self.request.user)

        TimelineItem.objects.create(
            event=event,
            date=date.today(),
            type="comment_added",
            text="Comment added",
            actor=self.request.user,
        )

        audit_event(
            self.request,
            action="case.comment.created",
            object_type="comment",
            object_id=str(inst.id),
            object_repr="Case comment",
            metadata=_audit_case_meta(
                event,
                {
                    "updated_section": "comment",
                    "content_redacted": True,
                },
            ),
        )


class CommentRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CommentSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    
    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.view" if request.method == "GET" else "case.update"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        user = self.request.user
        qs = Comment.objects.all()
        if user.is_staff:
            return qs
        customer_ids = get_accessible_customer_ids(user)
        return qs.filter(
            Q(event__customer_id__in=customer_ids),
            Q(event__owner=user) | Q(event__members=user),
        ).distinct()

    def perform_update(self, serializer):
        inst = serializer.instance
        event = inst.event
        _check_case_manage_access(self.request, event)

        before = {
            "text": getattr(inst, "text", "") or "",
        }

        obj = serializer.save()

        TimelineItem.objects.create(
            event=event,
            date=date.today(),
            type="comment_updated",
            text="Comment updated",
            actor=self.request.user,
        )

        audit_event(
            self.request,
            action="case.comment.updated",
            object_type="comment",
            object_id=str(obj.id),
            object_repr="Case comment",
            metadata=_audit_case_meta(
                event,
                {
                    "updated_section": "comment",
                    "updated_fields": ["text"],
                    "content_redacted": True,
                },
            ),
        )

    def perform_destroy(self, instance):
        event = instance.event
        _check_case_manage_access(self.request, event)

        cid = str(instance.id)
        instance.delete()

        TimelineItem.objects.create(
            event=event,
            date=date.today(),
            type="comment_deleted",
            text="Comment delete",
            actor=self.request.user,
        )

        audit_event(
            self.request,
            action="case.comment.deleted",
            object_type="comment",
            object_id=cid,
            object_repr="Case comment",
            metadata=_audit_case_meta(
                event,
                {
                    "updated_section": "comment",
                    "content_redacted": True,
                },
            ),
        )


###############
### Attachments
###############
class AttachmentListCreateForEventView(generics.ListCreateAPIView):
    serializer_class = AttachmentSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    parser_classes = [MultiPartParser, FormParser]
    event_id_kwarg = "event_id"

    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.view" if request.method == "GET" else "case.update"
        super().initial(request, *args, **kwargs)

    def get_event(self) -> Event:
        event_id = self.kwargs["event_id"]
        qs = Event.objects.filter(is_deleted=False)
        if not self.request.user.is_staff:
            customer_ids = get_accessible_customer_ids(self.request.user)
            qs = qs.filter(customer_id__in=customer_ids)
        event = get_object_or_404(qs, id=event_id)
        _check_case_access(self.request, event)
        return event

    def get_queryset(self):
        event = self.get_event()
        return Attachment.objects.filter(event=event).order_by("created_at")

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx

    def perform_create(self, serializer):
        event = self.get_event()
        _check_case_manage_access(self.request, event)
        f = self.request.FILES.get("file")
        original_name = f.name if f else ""

        max_size = 25 * 1024 * 1024

        if not f:
            raise ValidationError({"file": "File is required."})

        if getattr(f, "size", 0) > max_size:
            raise ValidationError({"file": "File is too large."})

        inst = serializer.save(
            event=event,
            uploaded_by=self.request.user,
            original_name=original_name,
        )

        TimelineItem.objects.create(
            event=event,
            date=date.today(),
            type="attachment_added",
            text=f"Attachment added : {original_name}" if original_name else "Attachment added",
            actor=self.request.user,
        )

        audit_event(
            self.request,
            action="case.attachment.created",
            object_type="attachment",
            object_id=str(inst.id),
            object_repr=original_name or "",
            metadata={"case_id": str(event.id)},
        )


class AttachmentRetrieveDestroyView(generics.RetrieveDestroyAPIView):
    serializer_class = AttachmentSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.view" if request.method == "GET" else "case.update"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        user = self.request.user
        qs = Attachment.objects.all()
        if user.is_staff:
            return qs
        customer_ids = get_accessible_customer_ids(user)
        return qs.filter(
            Q(event__customer_id__in=customer_ids),
            Q(event__owner=user) | Q(event__members=user),
        ).distinct()

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["request"] = self.request
        return ctx

    def perform_destroy(self, instance):
        event = instance.event
        _check_case_manage_access(self.request, event)

        original_name = instance.original_name
        aid = str(instance.id)
        instance.file.delete(save=False)
        instance.delete()

        TimelineItem.objects.create(
            event=event,
            date=date.today(),
            type="attachment_deleted",
            text=f"Attachment deleted : {original_name}" if original_name else "Attachment deleted",
            actor=self.request.user,
        )

        audit_event(
            self.request,
            action="case.attachment.deleted",
            object_type="attachment",
            object_id=aid,
            object_repr=original_name or "",
            metadata={"case_id": str(event.id)},
        )


###############
### Datamodels
###############
class SettingsSeverityListCreateView(generics.ListCreateAPIView):
    serializer_class = SeveritySerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = "settings.data_models.view" if request.method == "GET" else "settings.data_models.manage"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        qs = Severity.objects.all().order_by("order", "label")
        if self.request.query_params.get("include_inactive") != "1":
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        inst = serializer.save()
        audit_event(
            self.request,
            action="settings.severity.created",
            object_type="severity",
            object_id=str(inst.id),
            object_repr=getattr(inst, "label", "") or "",
            metadata={},
        )


class SettingsSeverityRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = SeveritySerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    queryset = Severity.objects.all()

    def initial(self, request, *args, **kwargs):
        if request.method == "GET":
            self.required_permission = "settings.data_models.view"
        elif request.method == "DELETE":
            self.required_permission = "settings.data_models.delete"
        else:
            self.required_permission = "settings.data_models.manage"
        super().initial(request, *args, **kwargs)

    def perform_update(self, serializer):
        inst = serializer.save()
        audit_event(
            self.request,
            action="settings.severity.updated",
            object_type="severity",
            object_id=str(inst.id),
            object_repr=getattr(inst, "label", "") or "",
            metadata={},
        )

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        audit_event(
            self.request,
            action="settings.severity.disabled",
            object_type="severity",
            object_id=str(instance.id),
            object_repr=getattr(instance, "label", "") or "",
            metadata={},
        )


class SettingsClassificationListCreateView(generics.ListCreateAPIView):
    serializer_class = ClassificationSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = "settings.data_models.view" if request.method == "GET" else "settings.data_models.manage"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        qs = Classification.objects.all().order_by("label")
        if self.request.query_params.get("include_inactive") != "1":
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        inst = serializer.save()
        audit_event(
            self.request,
            action="settings.classification.created",
            object_type="classification",
            object_id=str(inst.id),
            object_repr=getattr(inst, "label", "") or "",
            metadata={},
        )


class SettingsClassificationRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ClassificationSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    queryset = Classification.objects.all()

    def initial(self, request, *args, **kwargs):
        if request.method == "GET":
            self.required_permission = "settings.data_models.view"
        elif request.method == "DELETE":
            self.required_permission = "settings.data_models.delete"
        else:
            self.required_permission = "settings.data_models.manage"
        super().initial(request, *args, **kwargs)

    def perform_update(self, serializer):
        inst = serializer.save()
        audit_event(
            self.request,
            action="settings.classification.updated",
            object_type="classification",
            object_id=str(inst.id),
            object_repr=getattr(inst, "label", "") or "",
            metadata={},
        )

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        audit_event(
            self.request,
            action="settings.classification.disabled",
            object_type="classification",
            object_id=str(instance.id),
            object_repr=getattr(instance, "label", "") or "",
            metadata={},
        )


###############
### Customers
###############
class SettingsCustomerListCreateView(generics.ListCreateAPIView):
    serializer_class = CustomerSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = "settings.customers.view" if request.method == "GET" else "settings.customers.manage"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        qs = Customer.objects.all().order_by("name")
        if self.request.query_params.get("include_inactive") != "1":
            qs = qs.filter(is_active=True)
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(name__icontains=q)
        return qs

    def perform_create(self, serializer):
        inst = serializer.save()
        audit_event(
            self.request,
            action="settings.customer.created",
            object_type="customer",
            object_id=str(inst.id),
            object_repr=getattr(inst, "name", "") or "",
            metadata={},
        )


class SettingsCustomerRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CustomerSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    queryset = Customer.objects.all()

    def initial(self, request, *args, **kwargs):
        if request.method == "GET":
            self.required_permission = "settings.customers.view"
        elif request.method == "DELETE":
            self.required_permission = "settings.customers.delete"
        else:
            self.required_permission = "settings.customers.manage"
        super().initial(request, *args, **kwargs)

    def perform_update(self, serializer):
        inst = serializer.instance

        if inst and is_default_customer(inst):
            next_is_active = serializer.validated_data.get("is_active", None)
            if next_is_active is False:
                raise ValidationError({"detail": "Default customer cannot be disabled."})

        inst = serializer.save()
        audit_event(
            self.request,
            action="settings.customer.updated",
            object_type="customer",
            object_id=str(inst.id),
            object_repr=getattr(inst, "name", "") or "",
            metadata={},
        )

    def perform_destroy(self, instance):
        if is_default_customer(instance):
            raise ValidationError({"detail": "Default customer cannot be disabled or deleted."})

        instance.is_active = False
        instance.save(update_fields=["is_active"])
        audit_event(
            self.request,
            action="settings.customer.disabled",
            object_type="customer",
            object_id=str(instance.id),
            object_repr=getattr(instance, "name", "") or "",
            metadata={},
        )


class SettingsCustomerContactListCreateView(generics.ListCreateAPIView):
    serializer_class = CustomerContactSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = "settings.customers.view" if request.method == "GET" else "settings.customers.manage"
        super().initial(request, *args, **kwargs)

    def get_customer(self):
        customer_id = self.kwargs["customer_id"]
        customer = Customer.objects.filter(id=customer_id).first()
        if not customer:
            raise PermissionDenied("Customer not found.")
        return customer

    def get_queryset(self):
        customer = self.get_customer()
        qs = CustomerContact.objects.filter(customer=customer).order_by("name")

        include_inactive = self.request.query_params.get("include_inactive") == "1"
        if not include_inactive:
            qs = qs.filter(is_active=True)

        q = (self.request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(name__icontains=q)

        return qs

    def perform_create(self, serializer):
        customer = self.get_customer()
        inst = serializer.save(customer=customer)

        audit_event(
            self.request,
            action="settings.customer_contact.created",
            object_type="customer_contact",
            object_id=str(inst.public_id if getattr(inst, "public_id", None) else inst.id),
            object_repr=getattr(inst, "name", "") or "",
            metadata={"customer_id": str(customer.id)},
        )


class SettingsCustomerContactRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CustomerContactSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    lookup_field = "public_id"
    queryset = CustomerContact.objects.all()

    def initial(self, request, *args, **kwargs):
        if request.method == "GET":
            self.required_permission = "settings.customers.view"
        elif request.method == "DELETE":
            self.required_permission = "settings.customers.delete"
        else:
            self.required_permission = "settings.customers.manage"
        super().initial(request, *args, **kwargs)

    def perform_update(self, serializer):
        inst = serializer.save()
        audit_event(
            self.request,
            action="settings.customer_contact.updated",
            object_type="customer_contact",
            object_id=str(getattr(inst, "public_id", None) or inst.id),
            object_repr=getattr(inst, "name", "") or "",
            metadata={"customer_id": str(getattr(inst, "customer_id", "") or "")},
        )

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        audit_event(
            self.request,
            action="settings.customer_contact.disabled",
            object_type="customer_contact",
            object_id=str(getattr(instance, "public_id", None) or instance.id),
            object_repr=getattr(instance, "name", "") or "",
            metadata={"customer_id": str(getattr(instance, "customer_id", "") or "")},
        )


###############
### Workbooks
###############
class SettingsWorkbookTemplateListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = "settings.workbooks.view" if request.method == "GET" else "settings.workbooks.manage"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        qs = WorkbookTemplate.objects.all().order_by("name")
        if self.request.query_params.get("include_inactive") != "1":
            qs = qs.filter(is_active=True)
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(name__icontains=q)
        return qs

    def get_serializer_class(self):
        if self.request.method == "POST":
            return WorkbookTemplateCreateSerializer
        return WorkbookTemplateSerializer

    def perform_create(self, serializer):
        inst = serializer.save()
        audit_event(
            self.request,
            action="settings.workbook_template.created",
            object_type="workbook_template",
            object_id=str(inst.id),
            object_repr=getattr(inst, "name", "") or "",
            metadata={"is_active": getattr(inst, "is_active", None)},
        )


class SettingsWorkbookTemplateRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    queryset = WorkbookTemplate.objects.all()

    def initial(self, request, *args, **kwargs):
        if request.method == "GET":
            self.required_permission = "settings.workbooks.view"
        elif request.method == "DELETE":
            self.required_permission = "settings.workbooks.delete"
        else:
            self.required_permission = "settings.workbooks.manage"
        super().initial(request, *args, **kwargs)

    serializer_class = WorkbookTemplateSerializer

    def perform_update(self, serializer):
        inst = serializer.save()
        audit_event(
            self.request,
            action="settings.workbook_template.updated",
            object_type="workbook_template",
            object_id=str(inst.id),
            object_repr=getattr(inst, "name", "") or "",
            metadata={},
        )

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active"])
        audit_event(
            self.request,
            action="settings.workbook_template.disabled",
            object_type="workbook_template",
            object_id=str(instance.id),
            object_repr=getattr(instance, "name", "") or "",
            metadata={},
        )


class SettingsWorkbookTemplateItemListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    serializer_class = WorkbookTemplateItemSerializer

    def initial(self, request, *args, **kwargs):
        self.required_permission = "settings.workbooks.view" if request.method == "GET" else "settings.workbooks.manage"
        super().initial(request, *args, **kwargs)

    def get_template(self):
        tpl_id = self.kwargs["template_id"]
        tpl = get_object_or_404(WorkbookTemplate, id=tpl_id)
        return tpl

    def get_queryset(self):
        tpl = self.get_template()
        return WorkbookTemplateItem.objects.filter(template=tpl).order_by("order", "label")

    def perform_create(self, serializer):
        tpl = self.get_template()

        last = (
            WorkbookTemplateItem.objects
            .filter(template=tpl)
            .aggregate(m=Max("order"))
            .get("m")
        )
        next_order = (int(last) + 1) if last is not None else 0

        inst = serializer.save(template=tpl, order=next_order)

        audit_event(
            self.request,
            action="settings.workbook_template_item.created",
            object_type="workbook_template_item",
            object_id=str(inst.id),
            object_repr=getattr(inst, "label", "") or "",
            metadata={"template_id": str(tpl.id)},
        )


class SettingsWorkbookTemplateItemRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    serializer_class = WorkbookTemplateItemSerializer
    queryset = WorkbookTemplateItem.objects.all()

    def initial(self, request, *args, **kwargs):
        if request.method == "GET":
            self.required_permission = "settings.workbooks.view"
        elif request.method == "DELETE":
            self.required_permission = "settings.workbooks.delete"
        else:
            self.required_permission = "settings.workbooks.manage"
        super().initial(request, *args, **kwargs)

    def perform_update(self, serializer):
        inst = serializer.save()
        audit_event(
            self.request,
            action="settings.workbook_template_item.updated",
            object_type="workbook_template_item",
            object_id=str(inst.id),
            object_repr=getattr(inst, "label", "") or "",
            metadata={"template_id": str(getattr(inst, "template_id", "") or "")},
        )

    def perform_destroy(self, instance):
        tid = str(getattr(instance, "template_id", "") or "")
        iid = str(instance.id)
        label = getattr(instance, "label", "") or ""
        instance.delete()
        audit_event(
            self.request,
            action="settings.workbook_template_item.deleted",
            object_type="workbook_template_item",
            object_id=iid,
            object_repr=label,
            metadata={"template_id": tid},
        )


class CaseWorkbookGetView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.view"
    case_id_kwarg = "case_id"

    def get(self, request, case_id):
        if request.user.is_staff:
            event = get_object_or_404(Event.objects.filter(is_deleted=False), id=case_id)
        else:
            customer_ids = get_accessible_customer_ids(request.user)
            event = get_object_or_404(
                Event.objects.filter(is_deleted=False, customer_id__in=customer_ids),
                id=case_id,
            )

        _check_case_access(request, event)

        inst = WorkbookInstance.objects.filter(event=event).first()
        if not inst:
            return Response({"workbook": None}, status=status.HTTP_200_OK)

        data = WorkbookInstanceSerializer(inst).data
        return Response({"workbook": data}, status=status.HTTP_200_OK)


class CaseWorkbookApplyTemplateView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.update"
    case_id_kwarg = "case_id"

    @transaction.atomic
    def post(self, request, case_id):
        template_id = request.data.get("template_id")

        if request.user.is_staff:
            event = get_object_or_404(Event.objects.filter(is_deleted=False), id=case_id)
        else:
            customer_ids = get_accessible_customer_ids(request.user)
            event = get_object_or_404(
                Event.objects.filter(is_deleted=False, customer_id__in=customer_ids),
                id=case_id,
            )

        _check_case_manage_access(request, event)

        inst, _created = WorkbookInstance.objects.get_or_create(event=event)

        if not template_id:
            inst.template = None
            inst.save(update_fields=["template"])
            WorkbookInstanceItem.objects.filter(instance=inst).delete()

            TimelineItem.objects.create(
                event=event,
                date=date.today(),
                type="workbook_removed_from_case",
                text="Workbook removed from case",
                actor=self.request.user,
            )

            audit_event(
                request,
                action="case.workbook.template_cleared",
                object_type="case",
                object_id=str(event.id),
                object_repr=event.title or "",
                metadata={},
            )

            return Response({"ok": True, "workbook": WorkbookInstanceSerializer(inst).data}, status=status.HTTP_200_OK)

        tpl = get_object_or_404(WorkbookTemplate, id=template_id, is_active=True)

        inst.template = tpl
        inst.save(update_fields=["template"])

        WorkbookInstanceItem.objects.filter(instance=inst).delete()

        tpl_items = WorkbookTemplateItem.objects.filter(template=tpl).order_by("order", "label")
        bulk = [WorkbookInstanceItem(instance=inst, label=it.label, order=it.order, is_done=False) for it in tpl_items]
        WorkbookInstanceItem.objects.bulk_create(bulk)

        inst = WorkbookInstance.objects.select_related("template").prefetch_related("items").get(id=inst.id)

        TimelineItem.objects.create(
            event=event,
            date=date.today(),
            type="workbook_applied_on_case",
            text=f"Workbook applied on case",
            actor=self.request.user,
        )

        audit_event(
            request,
            action="case.workbook.template_applied",
            object_type="case",
            object_id=str(event.id),
            object_repr=event.title or "",
            metadata={"template_id": str(tpl.id), "template_name": getattr(tpl, "name", "") or ""},
        )

        return Response({"ok": True, "workbook": WorkbookInstanceSerializer(inst).data}, status=status.HTTP_200_OK)


class WorkbookInstanceItemUpdateView(generics.UpdateAPIView):
    serializer_class = WorkbookInstanceItemSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    queryset = WorkbookInstanceItem.objects.select_related("instance__event")

    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.update"
        super().initial(request, *args, **kwargs)

    def perform_update(self, serializer):
        item = self.get_object()
        event = item.instance.event

        _check_case_manage_access(self.request, event)

        old_done = item.is_done
        updated = serializer.save()

        if old_done != updated.is_done:
            TimelineItem.objects.create(
                event=event,
                date=date.today(),
                type="workbook_instance_item_checked" if updated.is_done else "workbook_instance_item_unchecked",
                text=f'Workbook: {"checked" if updated.is_done else "unchecked"} "{updated.label}"',
                actor=self.request.user,
            )

        audit_event(
            self.request,
            action="case.workbook.item_toggled",
            object_type="workbook_instance_item",
            object_id=str(updated.id),
            object_repr=getattr(updated, "label", "") or "",
            metadata={"case_id": str(event.id), "is_done": bool(updated.is_done)},
        )


###############
### Reports
###############
class SettingsReportTemplateListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = "settings.reports.view" if request.method == "GET" else "settings.reports.manage"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        qs = ReportTemplate.objects.all().order_by("-updated_at")
        if self.request.query_params.get("include_inactive") != "1":
            qs = qs.filter(is_active=True)
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(name__icontains=q)
        return qs

    def get_serializer_class(self):
        if self.request.method == "GET":
            return ReportTemplateListSerializer
        return ReportTemplateSerializer

    def perform_create(self, serializer):
        inst = serializer.save(created_by=self.request.user)
        audit_event(
            self.request,
            action="settings.report_template.created",
            object_type="report_template",
            object_id=str(inst.id),
            object_repr=getattr(inst, "name", "") or "",
            metadata={"version": getattr(inst, "version", None)},
        )


class SettingsReportTemplateRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    queryset = ReportTemplate.objects.all()
    serializer_class = ReportTemplateSerializer

    def initial(self, request, *args, **kwargs):
        if request.method == "GET":
            self.required_permission = "settings.reports.view"
        elif request.method == "DELETE":
            self.required_permission = "settings.reports.delete"
        else:
            self.required_permission = "settings.reports.manage"
        super().initial(request, *args, **kwargs)

    def perform_update(self, serializer):
        inst = serializer.instance
        next_obj = serializer.save()
        bumped = False
        if any(k in serializer.validated_data for k in ["html", "css"]):
            next_obj.version = (inst.version or 1) + 1
            next_obj.save(update_fields=["version", "updated_at"])
            bumped = True

        audit_event(
            self.request,
            action="settings.report_template.updated",
            object_type="report_template",
            object_id=str(next_obj.id),
            object_repr=getattr(next_obj, "name", "") or "",
            metadata={"version": getattr(next_obj, "version", None), "version_bumped": bumped},
        )

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.save(update_fields=["is_active", "updated_at"])
        audit_event(
            self.request,
            action="settings.report_template.disabled",
            object_type="report_template",
            object_id=str(instance.id),
            object_repr=getattr(instance, "name", "") or "",
            metadata={"version": getattr(instance, "version", None)},
        )


class SettingsReportTemplatePreviewView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "settings.reports.manage"

    def post(self, request):
        ser = ReportPreviewRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        case_id = ser.validated_data["case_id"]
        html_tpl = ser.validated_data["html"]
        css = ser.validated_data.get("css", "") or ""
        params = ser.validated_data.get("params", {}) or {}
        case = get_object_or_404(Event.objects.filter(is_deleted=False), id=case_id)
        _check_case_access(request, case)

        wb = WorkbookInstance.objects.filter(event=case).prefetch_related("items").first()
        linked_alerts = Alert.objects.filter(case=case).order_by("-created_at")
        comments = Comment.objects.filter(event=case).select_related("author").order_by("created_at")
        attachments = Attachment.objects.filter(event=case).order_by("created_at")
        timeline = TimelineItem.objects.filter(event=case).select_related("actor", "alert").order_by("date", "created_at")
        exchanges = CaseExchange.objects.filter(case=case).select_related("created_by").order_by("created_at")
        incident_timeline = IncidentTimelineItem.objects.filter(case=case).select_related("created_by").order_by("occurred_at", "created_at")

        from jinja2 import TemplateError
        ctx = {
            "case": case,
            "workbook": wb,
            "linked_alerts": linked_alerts,
            "comments": comments,
            "attachments": attachments,
            "timeline": timeline,
            "exchanges": exchanges,
            "incident_timeline": incident_timeline,
            "params": params,
            "generated_at": timezone.now(),
            "generated_by": request.user,
        }

        try:
            rendered = render_report_html(html_tpl, ctx)
        except TemplateError as e:
            audit_event(
                request,
                action="settings.report_template.preview",
                object_type="case",
                object_id=str(case.id),
                object_repr=case.title or "",
                success=False,
                status_code=400,
                metadata={"error": str(e)[:500]},
            )
            return Response({"error": "Template error", "detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        audit_event(
            request,
            action="settings.report_template.preview",
            object_type="case",
            object_id=str(case.id),
            object_repr=case.title or "",
            metadata={"params_keys": sorted(list((params or {}).keys()))[:50]},
        )

        return Response({"html": rendered, "css": css}, status=status.HTTP_200_OK)


class CaseReportGenerateView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.update"
    case_id_kwarg = "case_id"

    @transaction.atomic
    def post(self, request, case_id):
        ser = ReportGenerateRequestSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        template_id = ser.validated_data["template_id"]
        params = ser.validated_data.get("params", {}) or {}

        case = get_object_or_404(Event.objects.filter(is_deleted=False), id=case_id)
        _check_case_manage_access(request, case)

        tpl = get_object_or_404(ReportTemplate, id=template_id, is_active=True)

        wb = WorkbookInstance.objects.filter(event=case).prefetch_related("items").first()
        linked_alerts = Alert.objects.filter(case=case).order_by("-created_at")
        comments = Comment.objects.filter(event=case).select_related("author").order_by("created_at")
        attachments = Attachment.objects.filter(event=case).order_by("created_at")
        timeline = TimelineItem.objects.filter(event=case).select_related("actor", "alert").order_by("date", "created_at")
        exchanges = CaseExchange.objects.filter(case=case).select_related("created_by").order_by("created_at")
        incident_timeline = IncidentTimelineItem.objects.filter(case=case).select_related("created_by").order_by("occurred_at", "created_at")

        from jinja2 import TemplateError
        ctx = {
            "case": case,
            "workbook": wb,
            "linked_alerts": linked_alerts,
            "comments": comments,
            "attachments": attachments,
            "timeline": timeline,
            "exchanges": exchanges,
            "incident_timeline": incident_timeline,
            "params": params,
            "generated_at": timezone.now(),
            "generated_by": request.user,
        }

        try:
            rendered_html = render_report_html(tpl.html, ctx)
        except TemplateError as e:
            audit_event(
                request,
                action="case.report.generate",
                object_type="case",
                object_id=str(case.id),
                object_repr=case.title or "",
                success=False,
                status_code=400,
                metadata={"template_id": str(tpl.id), "error": str(e)[:500]},
            )
            return Response({"error": "Template error", "detail": str(e)}, status=status.HTTP_400_BAD_REQUEST)

        from weasyprint import HTML, CSS

        base_url = getattr(settings, "WEASYPRINT_BASEURL", None) or str(getattr(settings, "BASE_DIR", "."))
        pdf_bytes = HTML(string=rendered_html, base_url=base_url).write_pdf(stylesheets=[CSS(string=tpl.css or "")])

        rep = ReportInstance.objects.create(
            case=case,
            template=tpl,
            template_name=tpl.name,
            template_version=tpl.version,
            template_html_snapshot=tpl.html,
            template_css_snapshot=tpl.css or "",
            params=params,
            generated_by=request.user,
        )
        rep.pdf.save(f"{rep.id}.pdf", ContentFile(pdf_bytes), save=True)

        TimelineItem.objects.create(
            event=case,
            date=date.today(),
            type="case_report_generated",
            text=f"Case report generated",
            actor=self.request.user,
        )

        audit_event(
            request,
            action="case.report.generated",
            object_type="report_instance",
            object_id=str(rep.id),
            object_repr=(tpl.name or "")[:255],
            metadata={"case_id": str(case.id), "template_id": str(tpl.id), "template_version": tpl.version},
        )

        out = ReportInstanceSerializer(rep, context={"request": request}).data
        return Response(out, status=status.HTTP_201_CREATED)


class CaseReportListView(generics.ListAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.view"
    serializer_class = ReportInstanceSerializer
    case_id_kwarg = "case_id"

    def get_queryset(self):
        case_id = self.kwargs["case_id"]
        case = get_object_or_404(Event.objects.filter(is_deleted=False), id=case_id)
        _check_case_access(self.request, case)
        return ReportInstance.objects.filter(case=case).order_by("-created_at")


###############
### Incident timeline
###############
class CaseIncidentTimelineListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    serializer_class = IncidentTimelineItemSerializer
    case_id_kwarg = "case_id"

    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.view" if request.method == "GET" else "case.update"
        super().initial(request, *args, **kwargs)

    def get_case(self) -> Event:
        case_id = self.kwargs["case_id"]
        case = get_object_or_404(Event.objects.filter(is_deleted=False), id=case_id)
        _check_case_access(self.request, case)
        return case

    def get_queryset(self):
        case = self.get_case()
        return IncidentTimelineItem.objects.filter(case=case).order_by("occurred_at", "created_at")

    def get_serializer_class(self):
        if self.request.method == "POST":
            return IncidentTimelineItemCreateSerializer
        return IncidentTimelineItemSerializer

    def perform_create(self, serializer):
        case = self.get_case()
        _check_case_manage_access(self.request, case)
        item = serializer.save(case=case, created_by=self.request.user)

        TimelineItem.objects.create(
            event=case,
            date=date.today(),
            type="incident_timeline_item_added",
            text=f"Incident timeline: added '{item.title}'",
            actor=self.request.user,
        )

        audit_event(
            self.request,
            action="case.incident_timeline.created",
            object_type="incident_timeline_item",
            object_id=str(item.id),
            object_repr=item.title or "",
            metadata={"case_id": str(case.id)},
        )


class IncidentTimelineItemRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    serializer_class = IncidentTimelineItemSerializer
    queryset = IncidentTimelineItem.objects.select_related("case")

    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.view" if request.method == "GET" else "case.update"
        super().initial(request, *args, **kwargs)

    def get_object(self):
        obj = super().get_object()
        _check_case_access(self.request, obj.case)
        return obj

    def perform_update(self, serializer):
        item = serializer.instance
        _check_case_manage_access(self.request, item.event)

        obj = serializer.save()

        TimelineItem.objects.create(
            event=obj.case,
            date=date.today(),
            type="incident_timeline_item_updated",
            text=f"Incident timeline: updated '{obj.title}'",
            actor=self.request.user,
        )

        audit_event(
            self.request,
            action="case.incident_timeline.updated",
            object_type="incident_timeline_item",
            object_id=str(obj.id),
            object_repr=obj.title or "",
            metadata={"case_id": str(obj.case_id)},
        )

    def perform_destroy(self, instance):
        case = instance.case
        _check_case_manage_access(self.request, case)

        title = instance.title
        iid = str(instance.id)
        instance.delete()

        TimelineItem.objects.create(
            event=case,
            date=date.today(),
            type="incident_timeline_item_deleted",
            text=f"Incident timeline: deleted '{title}'",
            actor=self.request.user,
        )

        audit_event(
            self.request,
            action="case.incident_timeline.deleted",
            object_type="incident_timeline_item",
            object_id=iid,
            object_repr=title or "",
            metadata={"case_id": str(case.id)},
        )


""" class MeView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAuthenticated]
    serializer_class = MeSerializer

    def get_object(self):
        UserProfile.objects.get_or_create(user=self.request.user)
        return self.request.user """


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        current_password = request.data.get("current_password", "")
        new_password = request.data.get("new_password", "")

        if not request.user.check_password(current_password):
            audit_event(
                request,
                action="me.password.change",
                object_type="user",
                object_id=str(request.user.id),
                object_repr=request.user.username or "",
                success=False,
                status_code=400,
                metadata={"reason": "current_password_incorrect"},
            )
            return Response({"detail": "Current password is incorrect."}, status=status.HTTP_400_BAD_REQUEST)

        validate_password(new_password, user=request.user)
        request.user.set_password(new_password)
        request.user.save()
        update_session_auth_hash(request, request.user)

        audit_event(
            request,
            action="me.password.change",
            object_type="user",
            object_id=str(request.user.id),
            object_repr=request.user.username or "",
            metadata={},
        )
        return Response({"detail": "Password updated."}, status=status.HTTP_200_OK)


class UpdateAvatarView(APIView):
    permission_classes = [IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        file = request.FILES.get("avatar")
        if not file:
            audit_event(
                request,
                action="me.avatar.update",
                object_type="user",
                object_id=str(request.user.id),
                object_repr=request.user.username or "",
                success=False,
                status_code=400,
                metadata={"reason": "missing_file"},
            )
            return Response({"detail": "Missing avatar file."}, status=status.HTTP_400_BAD_REQUEST)

        max_size = 5 * 1024 * 1024
        allowed_content_types = {"image/png", "image/jpeg", "image/webp", "image/gif"}

        if getattr(file, "size", 0) > max_size:
            return Response({"detail": "Avatar file is too large."}, status=status.HTTP_400_BAD_REQUEST)

        if (getattr(file, "content_type", "") or "").lower() not in allowed_content_types:
            return Response({"detail": "Unsupported avatar file type."}, status=status.HTTP_400_BAD_REQUEST)

        profile, _ = UserProfile.objects.get_or_create(user=request.user)
        profile.avatar = file
        profile.save()

        audit_event(
            request,
            action="me.avatar.update",
            object_type="user",
            object_id=str(request.user.id),
            object_repr=request.user.username or "",
            metadata={"filename": (getattr(file, "name", "") or "")[:200]},
        )

        data = MeSerializer(request.user, context={"request": request}).data
        return Response(data, status=status.HTTP_200_OK)


def _is_domain_allowed(hostname: str) -> bool:
    if not hostname:
        return False
    hostname = hostname.lower().strip(".")
    allowed = ConnectorAllowlistDomain.objects.filter(is_enabled=True).values_list("domain", flat=True)
    for d in allowed:
        d2 = (d or "").lower().strip(".")
        if not d2:
            continue
        if hostname == d2 or hostname.endswith("." + d2):
            return True
    return False


def _get_instance_secret(instance: ConnectorInstance) -> str:
    if hasattr(instance, "get_secret") and callable(getattr(instance, "get_secret")):
        try:
            return instance.get_secret() or ""
        except Exception:
            return ""
    return ""


def dispatch_case_exchange_webhooks(case: Event, exchange: CaseExchange, actor_user):
    endpoints = (
        ConnectorEndpoint.objects
        .select_related("instance")
        .filter(
            is_enabled=True,
            target_type="case",
            name__startswith="case_exchange_webhook",
            instance__is_enabled=True,
        )
    )

    payload = {
        "event_type": "case_exchange.created",
        "case": {
            "id": str(case.id),
            "case_number": case.case_number,
            "title": case.title,
            "status": case.status,
            "severity": case.severity,
            "classification": case.classification,
            "outcome": case.outcome,
            "customer_id": str(case.customer_id) if case.customer_id else None,
            "customer_name": case.customer.name if case.customer_id else None,
        },
        "exchange": {
            "id": str(exchange.id),
            "direction": exchange.direction,
            "channel": exchange.channel,
            "subject": exchange.subject,
            "body": exchange.body,
            "sender": exchange.sender,
            "to": exchange.to,
            "cc": exchange.cc,
            "bcc": exchange.bcc,
            "message_id": exchange.message_id,
            "references": exchange.references,
            "created_at": exchange.created_at.isoformat(),
        },
        "actor": {
            "id": getattr(actor_user, "id", None),
            "username": getattr(actor_user, "username", None),
        },
    }

    for ep in endpoints:
        inst = ep.instance

        base = (ep.base_url or "").strip()
        path = (ep.path_template or "").strip()
        if not base or not path:
            continue

        full_url = base.rstrip("/") + "/" + path.lstrip("/")
        u = urlparse(full_url)

        if (u.scheme or "").lower() != "https":
            continue
        if not _is_domain_allowed(u.hostname or ""):
            continue

        try:
            headers = json.loads(ep.headers_text or "{}")
            if not isinstance(headers, dict):
                headers = {}
        except Exception:
            headers = {}

        secret = _get_instance_secret(inst)

        http_status = None
        err = ""
        resp_payload = {}

        method = (ep.method or "POST").upper()

        if method not in {"POST", "PUT", "PATCH"}:
            continue

        timeout_s = min(60, max(1, int((ep.timeout_ms or 8000) / 1000)))

        blocked_headers = {
            "host",
            "content-length",
            "transfer-encoding",
            "connection",
            "upgrade",
            "proxy-authorization",
            "proxy-authenticate",
        }

        safe_headers = {}
        for hk, hv in headers.items():
            name = str(hk or "").strip()
            if not name:
                continue
            if name.lower() in blocked_headers:
                continue
            if "\r" in name or "\n" in name:
                continue
            if isinstance(hv, str):
                if "\r" in hv or "\n" in hv:
                    continue
                safe_headers[name] = hv.replace("{{secret}}", secret)

        if not any(k.lower() == "content-type" for k in safe_headers.keys()):
            safe_headers["Content-Type"] = "application/json"

        try:
            r = requests.request(
                method=method,
                url=full_url,
                headers=safe_headers,
                data=json.dumps(payload),
                timeout=timeout_s,
                allow_redirects=False,
                proxies=build_outbound_proxies(),
            )
            http_status = r.status_code
            try:
                resp_payload = r.json()
            except Exception:
                resp_payload = {"text": (r.text or "")[:2000]}
        except Exception as e:
            err = str(e)

        ConnectorResult.objects.create(
            case=case,
            instance=inst,
            endpoint=ep,
            action_id="case_exchange_webhook",
            target_type="case",
            target_key="exchange_id",
            target_value=str(exchange.id),
            request_payload=payload,
            response_payload=resp_payload if isinstance(resp_payload, dict) else {"raw": str(resp_payload)},
            status="success" if (http_status and 200 <= http_status < 300 and not err) else "error",
            error=err or "",
            created_by=actor_user if getattr(actor_user, "is_authenticated", False) else None,
        )


def _case_subject_prefix(case: Event) -> str:
    number = getattr(case, "case_number", None)
    if number:
        return f"[Case ID#{number}]"
    return f"[Case ID#{case.id}]"


def _ensure_case_subject_prefix(subject: str, case: Event) -> str:
    subject = (subject or "").strip()
    prefix = _case_subject_prefix(case)

    if prefix.lower() in subject.lower():
        return subject

    if subject.lower().startswith("re:"):
        return f"Re: {prefix} {subject[3:].strip()}".strip()

    return f"{prefix} {subject}".strip()



def dispatch_case_exchange_send(case: Event, exchange: CaseExchange, actor_user):
    settings_obj = CaseRetentionSettings.get_solo()
    template = getattr(settings_obj, "exchange_send_template", None)

    if template and not template.is_enabled:
        template = None

    if template:
        template = (
            InvestigationTemplate.objects
            .filter(
                id=template.id,
                is_enabled=True,
                soar_provider__is_enabled=True,
            )
            .select_related("soar_provider")
            .first()
        )

    raw = exchange.raw or {}
    if not isinstance(raw, dict):
        raw = {}

    references = [
        str(item or "").strip()
        for item in list(exchange.references or [])
        if str(item or "").strip()
    ]

    in_reply_to = str(raw.get("in_reply_to") or "").strip()
    if not in_reply_to and references:
        in_reply_to = references[-1]

    headers = {}

    if in_reply_to:
        headers["In-Reply-To"] = in_reply_to

    if references:
        headers["References"] = " ".join(references)

    exchange_payload = {
        "id": str(exchange.id),
        "case_id": str(case.id),
        "channel": exchange.channel,
        "subject": _ensure_case_subject_prefix(exchange.subject or "", case),
        "body": exchange.body or "",
        "sender": exchange.sender or "",
        "to": exchange.to or [],
        "cc": exchange.cc or [],
        "bcc": exchange.bcc or [],
        "message_id": exchange.message_id or "",
        "in_reply_to": in_reply_to,
        "references": references,
        "headers": headers,
        "created_at": exchange.created_at.isoformat() if exchange.created_at else "",
    }

    raw["send_payload"] = exchange_payload
    raw["sent_at"] = timezone.now().isoformat()

    if not template:
        raw["send_status"] = "sent"
        raw["send_skipped_reason"] = "no_investigation_template_configured"
        exchange.raw = raw
        exchange.save(update_fields=["raw"])
        return None

    try:
        from .services_soar import SOARService

        result = SOARService(template.soar_provider).execute_template(
            template=template,
            variables={
                "doko_output": exchange_payload,
                "exchange_payload": exchange_payload,
                "exchange_id": exchange_payload["id"],
                "case_id": exchange_payload["case_id"],
            },
        )
    except Exception as exc:
        raw["send_status"] = "error"
        raw["send_error"] = str(exc)[:1000]
        raw["soar_template_id"] = str(template.id)
        raw["soar_template_code"] = template.code
        exchange.raw = raw
        exchange.save(update_fields=["raw"])
        raise

    raw["send_status"] = "sent"
    raw["soar_template_id"] = str(template.id)
    raw["soar_template_code"] = template.code
    raw["soar_result"] = result
    exchange.raw = raw
    exchange.save(update_fields=["raw"])

    return result


class CaseExchangeListCreateForCaseView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.update"
    case_id_kwarg = "case_id"

    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.view" if request.method == "GET" else "case.update"
        super().initial(request, *args, **kwargs)

    def _get_case(self, request, case_id: str) -> Event:
        if request.user.is_staff:
            case = get_object_or_404(Event.objects.filter(is_deleted=False), id=case_id)
        else:
            customer_ids = get_accessible_customer_ids(request.user)
            case = get_object_or_404(
                Event.objects.filter(is_deleted=False, customer_id__in=customer_ids),
                id=case_id,
            )
        _check_case_access(request, case)
        return case

    def get(self, request, case_id: str):
        case = self._get_case(request, case_id)
        qs = CaseExchange.objects.filter(case=case).select_related("created_by").order_by("created_at")
        return Response(CaseExchangeSerializer(qs, many=True).data, status=status.HTTP_200_OK)

    def post(self, request, case_id: str):
        case = self._get_case(request, case_id)
        _check_case_manage_access(request, case)

        ser = CaseExchangeCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        payload = dict(ser.validated_data)
        payload["subject"] = _ensure_case_subject_prefix(payload.get("subject", ""), case)

        with transaction.atomic():
            ex = CaseExchange.objects.create(
                case=case,
                created_by=request.user,
                **payload,
            )

        TimelineItem.objects.create(
            event=case,
            date=date.today(),
            type="case_exchange_created",
            text=f"Exchange created: {(ex.subject or '(no subject)')}",
            actor=request.user,
        )

        audit_event(
            request,
            action="case.exchange.created",
            object_type="case_exchange",
            object_id=str(ex.id),
            object_repr=(ex.subject or "")[:255],
            metadata={"case_id": str(case.id), "direction": ex.direction, "channel": ex.channel},
        )

        try:
            dispatch_case_exchange_webhooks(case, ex, request.user)
        except Exception:
            pass


        exchange_event = (
            "case.exchange_inbound_received"
            if ex.direction == "inbound"
            else "case.exchange_outbound_created"
        )

        _run_automation_safely(
            scope="case",
            target=case,
            event=exchange_event,
            actor=request.user,
            data={
                "exchange": ex,
                "exchange_id": str(ex.id),
                "direction": ex.direction,
            },
        )

        return Response(CaseExchangeSerializer(ex).data, status=status.HTTP_201_CREATED)


class CaseExchangeSendView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.update"

    def post(self, request, case_id: str):
        if request.user.is_staff:
            case = get_object_or_404(Event.objects.filter(is_deleted=False), id=case_id)
        else:
            customer_ids = get_accessible_customer_ids(request.user)
            case = get_object_or_404(Event.objects.filter(is_deleted=False, customer_id__in=customer_ids), id=case_id)

        _check_case_manage_access(request, case)

        ser = CaseExchangeCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        payload = dict(ser.validated_data)
        payload["direction"] = "outbound"

        raw = payload.get("raw") or {}
        if not isinstance(raw, dict):
            raw = {}
        raw["kind"] = raw.get("kind") or "manual_send"
        raw["send_status"] = "pending"
        payload["raw"] = raw

        with transaction.atomic():
            ex = CaseExchange.objects.create(
                case=case,
                created_by=request.user,
                **payload,
            )

            TimelineItem.objects.create(
                event=case,
                date=date.today(),
                type="case_exchange_created",
                text=f"Exchange sent: {(ex.subject or '(no subject)')}",
                actor=request.user,
            )

        try:
            result = dispatch_case_exchange_send(case, ex, request.user)
        except Exception as e:
            raw = ex.raw or {}
            if not isinstance(raw, dict):
                raw = {}
            raw["send_status"] = "error"
            raw["send_error"] = str(e)[:1000]
            ex.raw = raw
            ex.save(update_fields=["raw"])

            audit_event(
                request,
                action="case.exchange.send_failed",
                object_type="case_exchange",
                object_id=str(ex.id),
                object_repr=(ex.subject or "")[:255],
                success=False,
                status_code=500,
                metadata={"case_id": str(case.id), "error": str(e)[:500]},
            )
            return Response(CaseExchangeSerializer(ex).data, status=status.HTTP_502_BAD_GATEWAY)

        audit_event(
            request,
            action="case.exchange.sent",
            object_type="case_exchange",
            object_id=str(ex.id),
            object_repr=(ex.subject or "")[:255],
            status_code=201,
            metadata={
                "case_id": str(case.id),
                "soar_status": result.get("status") if isinstance(result, dict) else None,
                "remote_run_id": (
                    result.get("response", {}).get("playbook_run_id")
                    if isinstance(result, dict) and isinstance(result.get("response"), dict)
                    else None
                ),
            },
        )


        _run_automation_safely(
            scope="case",
            target=case,
            event="case.exchange_outbound_created",
            actor=request.user,
            data={
                "exchange": ex,
                "exchange_id": str(ex.id),
                "direction": ex.direction,
            },
        )

        return Response(CaseExchangeSerializer(ex).data, status=status.HTTP_201_CREATED)


class CaseExchangeFollowupBulkView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.update"

    def post(self, request, case_id: str):
        if request.user.is_staff:
            case = get_object_or_404(Event.objects.filter(is_deleted=False), id=case_id)
        else:
            customer_ids = get_accessible_customer_ids(request.user)
            case = get_object_or_404(Event.objects.filter(is_deleted=False, customer_id__in=customer_ids), id=case_id)

        _check_case_manage_access(request, case)

        exchange_ids = request.data.get("exchange_ids") or []
        if not isinstance(exchange_ids, list) or not exchange_ids:
            return Response({"detail": "exchange_ids_required"}, status=status.HTTP_400_BAD_REQUEST)

        delay_value = int(request.data.get("delay_value") or 24)
        delay_value = max(1, delay_value)

        delay_unit = request.data.get("delay_unit") or "hour"
        if delay_unit not in {"minute", "hour", "day", "week", "month"}:
            delay_unit = "hour"

        action = request.data.get("action") or "save"
        if action not in {"save", "send"}:
            action = "save"

        quickpart_id = request.data.get("quickpart_id") or None
        quickpart = None
        if quickpart_id:
            quickpart = get_object_or_404(CaseExchangeReplyQuickpart.objects.filter(is_active=True), id=quickpart_id)

        exchanges = CaseExchange.objects.filter(case=case, id__in=exchange_ids)
        found = set(str(x.id) for x in exchanges)
        if len(found) != len(set(str(x) for x in exchange_ids)):
            return Response({"detail": "one_or_more_exchanges_not_found"}, status=status.HTTP_404_NOT_FOUND)

        updated = []
        with transaction.atomic():
            for exchange in exchanges:
                cfg, _ = CaseExchangeFollowup.objects.get_or_create(exchange=exchange)
                cfg.enabled = bool(request.data.get("enabled", True))
                cfg.delay_value = delay_value
                cfg.delay_unit = delay_unit
                cfg.quickpart = quickpart
                cfg.action = action
                cfg.save(update_fields=["enabled", "delay_value", "delay_unit", "quickpart", "action", "updated_at"])
                updated.append(cfg)

        audit_event(
            request,
            action="case.exchange.followup_configured",
            object_type="case",
            object_id=str(case.id),
            object_repr=case.title or "",
            metadata={"exchange_ids": [str(x) for x in exchange_ids], "action": action},
        )

        return Response(CaseExchangeFollowupSerializer(updated, many=True).data, status=status.HTTP_200_OK)
    

class CaseExchangeRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.update"
    serializer_class = CaseExchangeSerializer
    queryset = CaseExchange.objects.select_related("case", "created_by")

    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.view" if request.method == "GET" else "case.update"
        super().initial(request, *args, **kwargs)

    def get_object(self):
        obj = super().get_object()
        _check_case_access(self.request, obj.case)
        return obj

    def perform_update(self, serializer):
        inst = serializer.instance
        _check_case_manage_access(self.request, inst.case)

        before = {
            "subject": getattr(inst, "subject", None),
            "body": getattr(inst, "body", None),
            "to": getattr(inst, "to", None),
            "cc": getattr(inst, "cc", None),
            "bcc": getattr(inst, "bcc", None),
            "direction": getattr(inst, "direction", None),
            "channel": getattr(inst, "channel", None),
        }
        updated = serializer.save()
        after = {
            "subject": getattr(updated, "subject", None),
            "body": getattr(updated, "body", None),
            "to": getattr(updated, "to", None),
            "cc": getattr(updated, "cc", None),
            "bcc": getattr(updated, "bcc", None),
            "direction": getattr(updated, "direction", None),
            "channel": getattr(updated, "channel", None),
        }

        TimelineItem.objects.create(
            event=updated.case,
            date=date.today(),
            type="case_exchange_updated",
            text=f"Exchange updated: {(updated.subject or '(no subject)')}",
            actor=self.request.user,
        )

        audit_event(
            self.request,
            action="case.exchange.updated",
            object_type="case_exchange",
            object_id=str(updated.id),
            object_repr="Case exchange",
            metadata={
                "case_id": str(updated.case_id),
                "updated_section": "exchange",
                "updated_fields": [
                    key
                    for key in before.keys()
                    if before.get(key) != after.get(key)
                ],
                "content_redacted": True,
            },
        )

    def perform_destroy(self, instance):
        case = instance.case
        _check_case_manage_access(self.request, case)
        
        sid = str(instance.id)
        subj = (instance.subject or "")[:255]
        instance.delete()

        TimelineItem.objects.create(
            event=case,
            date=date.today(),
            type="case_exchange_deleted",
            text=f"Exchange deleted: {(subj or '(no subject)')}",
            actor=self.request.user,
        )

        audit_event(
            self.request,
            action="case.exchange.deleted",
            object_type="case_exchange",
            object_id=sid,
            object_repr=subj,
            metadata={"case_id": str(case.id)},
        )


class CaseExchangeReplyQuickpartViewSet(viewsets.ModelViewSet):
    serializer_class = CaseExchangeReplyQuickpartSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.update"

    def initial(self, request, *args, **kwargs):
        self.required_permission = "case.view" if request.method == "GET" else "case.update"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        qs = CaseExchangeReplyQuickpart.objects.all()
        q = (self.request.query_params.get("q") or "").strip()
        if q:
            qs = qs.filter(is_active=True)
            qs = qs.filter(Q(name__icontains=q) | Q(description__icontains=q))
        return qs

    def perform_create(self, serializer):
        inst = serializer.save()
        audit_event(
            self.request,
            action="settings.quickpart.created",
            object_type="case_exchange_reply_quickpart",
            object_id=str(inst.id),
            object_repr=getattr(inst, "name", "") or "",
            metadata={"is_active": getattr(inst, "is_active", None)},
        )

    def perform_update(self, serializer):
        inst = serializer.save()
        audit_event(
            self.request,
            action="settings.quickpart.updated",
            object_type="case_exchange_reply_quickpart",
            object_id=str(inst.id),
            object_repr=getattr(inst, "name", "") or "",
            metadata={"is_active": getattr(inst, "is_active", None)},
        )

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        if obj.is_active:
            obj.is_active = False
            obj.save(update_fields=["is_active", "updated_at"])

        audit_event(
            request,
            action="settings.quickpart.disabled",
            object_type="case_exchange_reply_quickpart",
            object_id=str(obj.id),
            object_repr=getattr(obj, "name", "") or "",
            metadata={},
        )

        return Response(status=204)


def _filter_hunts_for_user(qs, user):
    if user.is_staff:
        return qs
    customer_ids = get_accessible_customer_ids(user)
    return qs.filter(customer_id__in=customer_ids)


def _get_hunt_for_user_or_404(request, **filters):
    qs = _filter_hunts_for_user(Hunt.objects.filter(is_deleted=False), request.user)
    return get_object_or_404(qs, **filters)


class HuntListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = "hunt.view" if request.method == "GET" else "hunt.create"
        super().initial(request, *args, **kwargs)

    def get_serializer_class(self):
        return HuntListSerializer

    def get_queryset(self):
        qs = Hunt.objects.filter(is_deleted=False).select_related("owner", "customer").prefetch_related("reviewers")

        if not self.request.user.is_staff:
            customer_ids = get_accessible_customer_ids(self.request.user)
            qs = qs.filter(customer_id__in=customer_ids)

        customer_ids_filter = self.request.query_params.getlist("customer")
        if customer_ids_filter:
            valid_customer_ids = []
            for raw in customer_ids_filter:
                try:
                    valid_customer_ids.append(str(UUID(str(raw))))
                except Exception:
                    qs = qs.none()
                    break

            if valid_customer_ids:
                qs = qs.filter(customer_id__in=valid_customer_ids)

        search = (self.request.query_params.get("search") or "").strip()
        if search:
            qs = qs.filter(
                Q(title__icontains=search)
                | Q(context__icontains=search)
                | Q(conclusion__icontains=search)
            )

        statuses = self.request.query_params.getlist("status")
        if statuses:
            qs = qs.filter(status__in=statuses)

        verdicts = self.request.query_params.getlist("verdict")
        if verdicts:
            qs = qs.filter(verdict__in=verdicts)

        owners = self.request.query_params.getlist("owner")
        if owners:
            qs = qs.filter(owner_id__in=owners)

        include_archived = (self.request.query_params.get("include_archived") or "").strip().lower()
        if include_archived not in {"1", "true", "yes"}:
            qs = qs.filter(archived_at__isnull=True)

        ordering = (self.request.query_params.get("ordering") or "-updated_at").strip()
        allowed = {
            "title", "-title",
            "created_at", "-created_at",
            "updated_at", "-updated_at",
            "status", "-status",
            "investigation_started_at", "-investigation_started_at",
        }
        if ordering not in allowed:
            ordering = "-updated_at"

        return qs.order_by(ordering)

    def perform_create(self, serializer):
        if not self.request.user.is_staff:
            customer = serializer.validated_data.get("customer")
            allowed = set(str(x) for x in get_accessible_customer_ids(self.request.user))
            if customer and str(customer.id) not in allowed:
                raise PermissionDenied("Customer not accessible.")

        obj = serializer.save(created_by=self.request.user if self.request.user.is_authenticated else None)
        audit_event(
            self.request,
            action="hunt.create",
            object_type="hunt",
            object_id=str(obj.id),
            object_repr=obj.title,
            metadata=_audit_hunt_meta(
                obj,
                {
                    "status": obj.status,
                    "verdict": obj.verdict,
                    "owner_id": obj.owner_id,
                },
            ),
        )
        _run_automation_safely(
            scope="hunt",
            target=obj,
            event="hunt.created",
            actor=self.request.user,
            data={},
        )


class HuntRetrieveUpdateDestroyView(generics.RetrieveUpdateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    queryset = Hunt.objects.filter(is_deleted=False).select_related("owner", "customer").prefetch_related("reviewers", "journal_entries", "case_links__case")
    serializer_class = HuntDetailSerializer
    required_permission = "hunt.view"

    def get_queryset(self):
        qs = Hunt.objects.filter(is_deleted=False).select_related("owner", "customer").prefetch_related(
            "reviewers",
            "journal_entries",
            "case_links__case",
        )
        return _filter_hunts_for_user(qs, self.request.user)

    def get_permissions(self):
        if self.request.method in {"PATCH", "PUT"}:
            self.required_permission = "hunt.manage"
        else:
            self.required_permission = "hunt.view"
        return super().get_permissions()

    def perform_update(self, serializer):
        inst = serializer.instance

        before = {
            "title": inst.title,
            "context": inst.context,
            "conclusion": inst.conclusion,
            "status": inst.status,
            "verdict": inst.verdict,
            "owner_id": inst.owner_id,
            "customer_id": str(inst.customer_id or ""),
            "investigation_started_at": inst.investigation_started_at.isoformat() if inst.investigation_started_at else None,
            "investigation_finished_at": inst.investigation_finished_at.isoformat() if inst.investigation_finished_at else None,
            "search_timeframe_start": inst.search_timeframe_start.isoformat() if inst.search_timeframe_start else None,
            "search_timeframe_end": inst.search_timeframe_end.isoformat() if inst.search_timeframe_end else None,
        }

        if not self.request.user.is_staff and "customer" in serializer.validated_data:
            customer = serializer.validated_data.get("customer")
            allowed = set(str(x) for x in get_accessible_customer_ids(self.request.user))
            if customer and str(customer.id) not in allowed:
                raise PermissionDenied("Customer not accessible.")
            
        obj = serializer.save()

        after = {
            "title": obj.title,
            "context": obj.context,
            "conclusion": obj.conclusion,
            "status": obj.status,
            "verdict": obj.verdict,
            "owner_id": obj.owner_id,
            "customer_id": str(obj.customer_id or ""),
            "investigation_started_at": obj.investigation_started_at.isoformat() if obj.investigation_started_at else None,
            "investigation_finished_at": obj.investigation_finished_at.isoformat() if obj.investigation_finished_at else None,
            "search_timeframe_start": obj.search_timeframe_start.isoformat() if obj.search_timeframe_start else None,
            "search_timeframe_end": obj.search_timeframe_end.isoformat() if obj.search_timeframe_end else None,
        }

        audit_event(
            self.request,
            action="hunt.update",
            object_type="hunt",
            object_id=str(obj.id),
            object_repr=obj.title,
            metadata=_audit_hunt_meta(
                obj,
                {
                    "before": before,
                    "after": after,
                },
            ),
        )

        _run_automation_safely(
            scope="hunt",
            target=obj,
            event="hunt.updated",
            actor=self.request.user,
            data={
                "before": before,
                "after": after,
            },
        )


class HuntDeleteView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "hunt.manage"

    def post(self, request, pk):
        hunt = _get_hunt_for_user_or_404(request, id=pk)

        hunt.is_deleted = True
        hunt.deleted_at = timezone.now()
        hunt.save(update_fields=["is_deleted", "deleted_at", "updated_at"])

        audit_event(
            request,
            action="hunt.delete",
            object_type="hunt",
            object_id=str(hunt.id),
            object_repr=hunt.title,
            metadata=_audit_hunt_meta(
                hunt,
                {
                    "soft": True,
                    "deleted_at": hunt.deleted_at.isoformat() if hunt.deleted_at else None,
                },
            ),
        )
        return Response(status=204)


class HuntJournalEntryListCreateForHuntView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    hunt_id_kwarg = "hunt_id"
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        self.required_permission = "hunt.view" if request.method == "GET" else "hunt.manage"
        super().initial(request, *args, **kwargs)

    def get_hunt(self):
        return _get_hunt_for_user_or_404(self.request, id=self.kwargs["hunt_id"])

    def get_queryset(self):
        hunt = self.get_hunt()
        return HuntJournalEntry.objects.filter(hunt=hunt).select_related("author")

    def get_serializer_class(self):
        return HuntJournalEntrySerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["hunt"] = self.get_hunt()
        return ctx

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        data = self.get_serializer(qs, many=True).data
        return Response(data, status=status.HTTP_200_OK)

    def perform_create(self, serializer):
        hunt = self.get_hunt()
        obj = serializer.save(
            hunt=hunt,
            author=self.request.user if self.request.user.is_authenticated else None,
        )
        audit_event(
            self.request,
            action="hunt.journal.create",
            object_type="hunt_journal_entry",
            object_id=str(obj.id),
            object_repr="Hunt journal entry",
            metadata=_audit_hunt_meta(
                hunt,
                {
                    "updated_section": "journal",
                    "entry_type": obj.entry_type,
                    "content_redacted": True,
                },
            ),
        )


class HuntJournalEntryRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    queryset = HuntJournalEntry.objects.select_related("hunt", "author")
    serializer_class = HuntJournalEntrySerializer
    required_permission = "hunt.manage"

    def get_queryset(self):
        qs = HuntJournalEntry.objects.select_related("hunt", "author")
        if self.request.user.is_staff:
            return qs
        customer_ids = get_accessible_customer_ids(self.request.user)
        return qs.filter(hunt__customer_id__in=customer_ids)

    def perform_update(self, serializer):
        inst = serializer.instance

        before = {
            "entry_type": inst.entry_type,
            "text": inst.text,
            "occurred_at": inst.occurred_at.isoformat() if inst.occurred_at else None,
            "linked_ioc_value": inst.linked_ioc_value,
            "linked_asset_value": inst.linked_asset_value,
            "linked_action_run_id": inst.linked_action_run_id,
        }

        obj = serializer.save()

        after = {
            "entry_type": obj.entry_type,
            "text": obj.text,
            "occurred_at": obj.occurred_at.isoformat() if obj.occurred_at else None,
            "linked_ioc_value": obj.linked_ioc_value,
            "linked_asset_value": obj.linked_asset_value,
            "linked_action_run_id": obj.linked_action_run_id,
        }

        audit_event(
            self.request,
            action="hunt.journal.update",
            object_type="hunt_journal_entry",
            object_id=str(obj.id),
            object_repr="Hunt journal entry",
            metadata=_audit_hunt_meta(
                obj.hunt,
                {
                    "updated_section": "journal",
                    "updated_fields": [
                        key
                        for key in before.keys()
                        if before.get(key) != after.get(key)
                    ],
                    "content_redacted": True,
                },
            ),
        )

    def perform_destroy(self, instance):
        hunt = instance.hunt
        audit_event(
            self.request,
            action="hunt.journal.delete",
            object_type="hunt_journal_entry",
            object_id=str(instance.id),
            object_repr="Hunt journal entry",
            metadata=_audit_hunt_meta(
                hunt,
                {
                    "updated_section": "journal",
                    "entry_type": instance.entry_type,
                    "content_redacted": True,
                },
            ),
        )
        instance.delete()


class HuntCaseLinkListCreateForHuntView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    hunt_id_kwarg = "hunt_id"

    def initial(self, request, *args, **kwargs):
        self.required_permission = "hunt.view" if request.method == "GET" else "hunt.manage"
        super().initial(request, *args, **kwargs)

    def get_hunt(self):
        return _get_hunt_for_user_or_404(self.request, id=self.kwargs["hunt_id"])
    
    def get_queryset(self):
        hunt = self.get_hunt()
        return HuntCaseLink.objects.filter(hunt=hunt).select_related("case", "created_by")

    def get_serializer_class(self):
        return HuntCaseLinkSerializer

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["hunt"] = self.get_hunt()
        return ctx

    def perform_create(self, serializer):
        hunt = self.get_hunt()
        obj = serializer.save()
        audit_event(
            self.request,
            action="hunt.case_link.create",
            object_type="hunt_case_link",
            object_id=str(obj.id),
            object_repr=f"{obj.hunt_id}->{obj.case_id}",
            metadata={
                "hunt_id": str(hunt.id),
                "case_id": str(obj.case_id),
                "customer_id": str(hunt.customer_id or ""),
                "link_type": obj.link_type,
            },
        )


class HuntCaseLinkRetrieveDestroyView(generics.RetrieveDestroyAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    queryset = HuntCaseLink.objects.select_related("hunt", "case", "created_by")
    serializer_class = HuntCaseLinkSerializer
    required_permission = "hunt.manage"

    def get_queryset(self):
        qs = HuntCaseLink.objects.select_related("hunt", "case", "created_by")
        if self.request.user.is_staff:
            return qs
        customer_ids = get_accessible_customer_ids(self.request.user)
        return qs.filter(hunt__customer_id__in=customer_ids)
    
    def perform_destroy(self, instance):
        hunt = instance.hunt
        audit_event(
            self.request,
            action="hunt.case_link.delete",
            object_type="hunt_case_link",
            object_id=str(instance.id),
            object_repr=f"{instance.hunt_id}->{instance.case_id}",
            metadata={
                "hunt_id": str(hunt.id),
                "case_id": str(instance.case_id),
                "customer_id": str(hunt.customer_id or ""),
                "link_type": instance.link_type,
            },
        )
        instance.delete()


class HuntTimelineView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "hunt.view"
    hunt_id_kwarg = "hunt_id"

    def get(self, request, hunt_id):
        hunt = _get_hunt_for_user_or_404(request, id=hunt_id)

        entries = (
            HuntJournalEntry.objects
            .filter(hunt=hunt)
            .select_related("author")
            .order_by("occurred_at", "created_at")
        )

        items = [
            {
                "id": f"hunt-created:{hunt.id}",
                "kind": "hunt_created",
                "occurred_at": hunt.created_at,
                "title": "Hunt created",
                "details": hunt.title,
                "author_username": getattr(hunt.created_by, "username", None),
            }
        ]

        for entry in entries:
            items.append(
                {
                    "id": str(entry.id),
                    "kind": entry.entry_type,
                    "occurred_at": entry.occurred_at,
                    "title": entry.get_entry_type_display(),
                    "details": entry.text,
                    "author_username": getattr(entry.author, "username", None),
                    "linked_ioc_value": entry.linked_ioc_value,
                    "linked_asset_value": entry.linked_asset_value,
                    "linked_action_run_id": entry.linked_action_run_id,
                    "created_at": entry.created_at,
                    "updated_at": entry.updated_at,
                }
            )

        links = HuntCaseLink.objects.filter(hunt=hunt).select_related("case", "created_by").order_by("created_at")
        for link in links:
            items.append(
                {
                    "id": f"hunt-case-link:{link.id}",
                    "kind": "case_link",
                    "occurred_at": link.created_at,
                    "title": "Case linked",
                    "details": f"{link.case.title} ({link.link_type})",
                    "author_username": getattr(link.created_by, "username", None),
                    "case_id": str(link.case_id),
                    "case_title": link.case.title,
                    "case_number": link.case.case_number,
                }
            )

        items.sort(key=lambda x: (x.get("occurred_at") or "", x.get("id") or ""))
        return Response(items, status=200)


class HuntArchiveView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "hunt.manage"

    def post(self, request, pk):
        hunt = _get_hunt_for_user_or_404(request, id=pk)

        if hunt.archived_at is None:
            hunt.archived_at = timezone.now()
            hunt.save(update_fields=["archived_at", "updated_at"])

        audit_event(
            request,
            action="hunt.archive",
            object_type="hunt",
            object_id=str(hunt.id),
            object_repr=hunt.title,
            metadata=_audit_hunt_meta(
                hunt,
                {
                    "archived_at": hunt.archived_at.isoformat() if hunt.archived_at else None,
                },
            ),
        )
        return Response(status=204)


class HuntUnarchiveView(APIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "hunt.manage"

    def post(self, request, pk):
        hunt = _get_hunt_for_user_or_404(request, id=pk)

        if hunt.archived_at is not None:
            hunt.archived_at = None
            hunt.save(update_fields=["archived_at", "updated_at"])

        audit_event(
            request,
            action="hunt.unarchive",
            object_type="hunt",
            object_id=str(hunt.id),
            object_repr=hunt.title,
            metadata=_audit_hunt_meta(
                hunt,
                {
                    "archived_at": hunt.archived_at.isoformat() if hunt.archived_at else None,
                },
            ),
        )
        return Response(status=204)


def _user_has_permission(user, code: str) -> bool:
    if not user or not getattr(user, "is_authenticated", False):
        return False
    if getattr(user, "is_staff", False):
        return True
    return code in get_user_permissions(user)


def _user_can_manage_tasks(user) -> bool:
    return _user_has_permission(user, "task.manage")


def _user_can_add_tasks(user) -> bool:
    return _user_has_permission(user, "task.add") or _user_can_manage_tasks(user)


def _user_can_view_tasks(user) -> bool:
    return _user_has_permission(user, "task.view") or _user_can_manage_tasks(user)


class TaskListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        if request.method == "GET":
            self.required_permission = "task.manage" if _user_can_manage_tasks(request.user) else "task.view"
        else:
            self.required_permission = "task.manage" if _user_can_manage_tasks(request.user) else "task.add"
        super().initial(request, *args, **kwargs)

    def get_serializer_class(self):
        return TaskListSerializer if self.request.method == "GET" else TaskDetailSerializer

    def get_queryset(self):
        user = self.request.user
        can_manage = _user_can_manage_tasks(user)
        scope = (self.request.query_params.get("scope") or "mine").strip().lower()

        qs = (
            Task.objects
            .filter(is_deleted=False)
            .select_related("owner")
            .prefetch_related("customers", "case_links")
            .annotate(linked_case_count=Count("case_links", distinct=True))
        )

        if not can_manage or scope != "all":
            qs = qs.filter(owner=user)

        search = (self.request.query_params.get("search") or "").strip()
        if search:
            qs = qs.filter(Q(title__icontains=search) | Q(description__icontains=search))

        status_list = self.request.query_params.getlist("status")
        if status_list:
            qs = qs.filter(status__in=[x for x in status_list if x])

        priority_list = self.request.query_params.getlist("priority")
        if priority_list:
            qs = qs.filter(priority__in=[x for x in priority_list if x])

        owner_ids = []
        for raw in self.request.query_params.getlist("owner"):
            try:
                owner_ids.append(int(raw))
            except Exception:
                pass
        if owner_ids and can_manage:
            qs = qs.filter(owner_id__in=owner_ids)

        customer_ids_filter = self.request.query_params.getlist("customer")
        if customer_ids_filter:
            qs = qs.filter(customers__id__in=customer_ids_filter).distinct()

        ordering = (self.request.query_params.get("ordering") or "-updated_at").strip()
        allowed = {
            "title", "-title",
            "status", "-status",
            "priority", "-priority",
            "due_date", "-due_date",
            "created_at", "-created_at",
            "updated_at", "-updated_at",
        }
        if ordering in allowed:
            qs = qs.order_by(ordering, "-updated_at")
        else:
            qs = qs.order_by("-updated_at")

        return qs.distinct()

    def perform_create(self, serializer):
        user = self.request.user
        can_manage = _user_can_manage_tasks(user)

        requested_owner = serializer.validated_data.get("owner")

        if requested_owner and not can_manage and requested_owner != user:
            raise PermissionDenied("Only task managers can assign another owner.")

        if not can_manage:
            allowed = set(str(x) for x in get_accessible_customer_ids(user))
            requested_customers = serializer.validated_data.get("customers", [])
            requested_customer_ids = set(str(getattr(x, "id", x)) for x in requested_customers)

            if requested_customer_ids and not requested_customer_ids.issubset(allowed):
                raise PermissionDenied("Customer not accessible.")

        task = serializer.save(created_by=user)

        if can_manage:
            if requested_owner and task.owner_id != requested_owner.id:
                task.owner = requested_owner
                task.save(update_fields=["owner", "updated_at"])
            elif not task.owner_id:
                task.owner = user
                task.save(update_fields=["owner", "updated_at"])
        else:
            task.owner = user
            task.save(update_fields=["owner", "updated_at"])

        audit_event(
            self.request,
            action="task.created",
            object_type="task",
            object_id=str(task.id),
            object_repr=task.title or "",
            metadata=_audit_task_meta(
                task,
                {
                    "status": task.status,
                    "priority": task.priority,
                    "owner_id": task.owner_id,
                },
            ),
        )


class TaskRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        if request.method in ("DELETE", "PATCH", "PUT"):
            self.required_permission = "task.manage" if _user_can_manage_tasks(request.user) else "task.add"
        else:
            self.required_permission = "task.manage" if _user_can_manage_tasks(request.user) else "task.view"
        super().initial(request, *args, **kwargs)

    def get_queryset(self):
        qs = (
            Task.objects
            .filter(is_deleted=False)
            .select_related("owner")
            .prefetch_related("customers", "case_links")
            .annotate(linked_case_count=Count("case_links", distinct=True))
        )

        if _user_can_manage_tasks(self.request.user):
            return qs

        return qs.filter(owner=self.request.user).distinct()

    def get_serializer_class(self):
        return TaskDetailSerializer

    def perform_update(self, serializer):
        inst = serializer.instance
        before = {
            "title": inst.title,
            "description": inst.description,
            "status": inst.status,
            "priority": inst.priority,
            "due_date": inst.due_date.isoformat() if inst.due_date else None,
            "owner_id": inst.owner_id,
            "customer_ids": [str(x) for x in inst.customers.values_list("id", flat=True)],
        }

        if not _user_can_manage_tasks(self.request.user):
            requested_owner = serializer.validated_data.get("owner")
            if requested_owner and requested_owner != self.request.user:
                raise PermissionDenied("Only task managers can assign another owner.")

            if "customers" in serializer.validated_data:
                allowed = set(str(x) for x in get_accessible_customer_ids(self.request.user))
                requested_customer_ids = {
                    str(getattr(x, "id", x))
                    for x in serializer.validated_data.get("customers", [])
                }

                if requested_customer_ids and not requested_customer_ids.issubset(allowed):
                    raise PermissionDenied("Customer not accessible.")
        
        obj = serializer.save()

        after = {
            "title": obj.title,
            "description": obj.description,
            "status": obj.status,
            "priority": obj.priority,
            "due_date": obj.due_date.isoformat() if obj.due_date else None,
            "owner_id": obj.owner_id,
            "customer_ids": [str(x) for x in obj.customers.values_list("id", flat=True)],
        }

        audit_event(
            self.request,
            action="task.updated",
            object_type="task",
            object_id=str(obj.id),
            object_repr="Task updated",
            metadata=_audit_task_meta(
                obj,
                {
                    "updated_fields": [
                        key
                        for key in before.keys()
                        if before.get(key) != after.get(key)
                    ],
                    "content_redacted": True,
                },
            ),
        )

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.deleted_at = timezone.now()
        instance.save(update_fields=["is_deleted", "deleted_at", "updated_at"])

        audit_event(
            self.request,
            action="task.deleted",
            object_type="task",
            object_id=str(instance.id),
            object_repr=instance.title or "",
            metadata=_audit_task_meta(
                instance,
                {
                    "soft": True,
                    "deleted_at": instance.deleted_at.isoformat() if instance.deleted_at else None,
                },
            ),
        )


class TaskCommentListCreateView(generics.ListCreateAPIView):
    serializer_class = TaskCommentSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    task_id_kwarg = "task_id"
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        self.required_permission = "task.view" if request.method == "GET" else "task.manage"
        super().initial(request, *args, **kwargs)

    def get_task(self) -> Task:
        qs = Task.objects.filter(id=self.kwargs["task_id"], is_deleted=False)

        if not self.request.user.is_staff:
            customer_ids = get_accessible_customer_ids(self.request.user)
            qs = qs.filter(
                Q(customers__id__in=customer_ids) |
                Q(owner=self.request.user) |
                Q(members=self.request.user)
            ).distinct()

        task = qs.first()
        if not task:
            raise PermissionDenied("Task not accessible.")
        return task

    def get_queryset(self):
        task = self.get_task()
        return TaskComment.objects.filter(task=task).order_by("created_at")

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        data = self.get_serializer(qs, many=True).data
        return Response(data, status=status.HTTP_200_OK)

    def perform_create(self, serializer):
        task = self.get_task()
        inst = serializer.save(task=task, author=self.request.user)

        audit_event(
            self.request,
            action="task.comment.created",
            object_type="task_comment",
            object_id=str(inst.id),
            object_repr="Task comment",
            metadata=_audit_task_meta(
                task,
                {
                    "updated_section": "comment",
                    "content_redacted": True,
                },
            ),
        )


class TaskCommentRetrieveUpdateDestroyView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TaskCommentSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]

    def initial(self, request, *args, **kwargs):
        self.required_permission = "task.view" if request.method == "GET" else "task.manage"
        super().initial(request, *args, **kwargs)

    def get_object(self):
        obj = (
            TaskComment.objects
            .select_related("task")
            .filter(id=self.kwargs["pk"], task__is_deleted=False)
            .first()
        )
        if not obj:
            raise PermissionDenied("Comment not found.")

        if not self.request.user.is_staff:
            customer_ids = get_accessible_customer_ids(self.request.user)
            allowed = (
                obj.task.owner_id == self.request.user.id
                or obj.task.members.filter(id=self.request.user.id).exists()
                or obj.task.customers.filter(id__in=customer_ids).exists()
            )
            if not allowed:
                raise PermissionDenied("Comment not accessible.")

        return obj

    def perform_update(self, serializer):
        before = {
            "text": getattr(serializer.instance, "text", "") or "",
        }

        inst = serializer.save()

        audit_event(
            self.request,
            action="task.comment.updated",
            object_type="task_comment",
            object_id=str(inst.id),
            object_repr="Task comment",
            metadata=_audit_task_meta(
                inst.task,
                {
                    "updated_section": "comment",
                    "updated_fields": ["text"],
                    "content_redacted": True,
                },
            ),
        )

    def perform_destroy(self, instance):
        task = instance.task
        cid = str(instance.id)
        preview = (getattr(instance, "text", "") or "")[:80]
        deleted = {
            "text": getattr(instance, "text", "") or "",
        }
        instance.delete()

        audit_event(
            self.request,
            action="task.comment.deleted",
            object_type="task_comment",
            object_id=cid,
            object_repr="Task comment",
            metadata=_audit_task_meta(
                task,
                {
                    "updated_section": "comment",
                    "content_redacted": True,
                },
            ),
        )


class TaskCaseLinkListCreateView(generics.ListCreateAPIView):
    serializer_class = TaskCaseLinkSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    task_id_kwarg = "task_id"

    def initial(self, request, *args, **kwargs):
        self.required_permission = "task.view" if request.method == "GET" else "task.manage"
        super().initial(request, *args, **kwargs)

    def get_task(self) -> Task:
        qs = Task.objects.filter(id=self.kwargs["task_id"], is_deleted=False)

        if not self.request.user.is_staff:
            customer_ids = get_accessible_customer_ids(self.request.user)
            qs = qs.filter(
                Q(customers__id__in=customer_ids) |
                Q(owner=self.request.user) |
                Q(members=self.request.user)
            ).distinct()

        task = qs.first()
        if not task:
            raise PermissionDenied("Task not accessible.")
        return task

    def get_queryset(self):
        task = self.get_task()
        return (
            TaskCaseLink.objects
            .filter(task=task)
            .select_related("case", "created_by", "case__customer")
            .order_by("created_at")
        )

    def get_serializer_context(self):
        ctx = super().get_serializer_context()
        ctx["task"] = self.get_task()
        return ctx

    def perform_create(self, serializer):
        task = self.get_task()
        inst = serializer.save()

        audit_event(
            self.request,
            action="task.case_link.created",
            object_type="task_case_link",
            object_id=str(inst.id),
            object_repr=f"{task.title} -> {getattr(inst.case, 'title', '')}",
            metadata={
                "task_id": str(task.id),
                "case_id": str(inst.case_id),
            },
        )


class TaskCaseLinkRetrieveDestroyView(generics.RetrieveDestroyAPIView):
    serializer_class = TaskCaseLinkSerializer
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "task.manage"

    def get_object(self):
        obj = (
            TaskCaseLink.objects
            .select_related("task", "case", "case__customer")
            .filter(id=self.kwargs["pk"], task__is_deleted=False, case__is_deleted=False)
            .first()
        )
        if not obj:
            raise PermissionDenied("Task case link not found.")

        if not self.request.user.is_staff:
            customer_ids = get_accessible_customer_ids(self.request.user)
            allowed = (
                obj.task.owner_id == self.request.user.id
                or obj.task.members.filter(id=self.request.user.id).exists()
                or obj.task.customers.filter(id__in=customer_ids).exists()
            )
            if not allowed:
                raise PermissionDenied("Task case link not accessible.")

        return obj

    def perform_destroy(self, instance):
        lid = str(instance.id)
        task_id = str(instance.task_id)
        case_id = str(instance.case_id)
        object_repr = f"{getattr(instance.task, 'title', '')} -> {getattr(instance.case, 'title', '')}"
        instance.delete()

        audit_event(
            self.request,
            action="task.case_link.deleted",
            object_type="task_case_link",
            object_id=lid,
            object_repr=object_repr,
            metadata={
                "task_id": task_id,
                "case_id": case_id,
            },
        )


class TaskListForEventView(generics.ListAPIView):
    permission_classes = [IsAuthenticated, HasPermissionCode]
    required_permission = "case.view"
    serializer_class = TaskListSerializer
    event_id_kwarg = "event_id"

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)

        if not _user_can_view_tasks(request.user):
            raise PermissionDenied("Task not accessible.")

    def get_event(self):
        event_id = self.kwargs["event_id"]
        qs = Event.objects.filter(is_deleted=False)

        if not self.request.user.is_staff:
            customer_ids = get_accessible_customer_ids(self.request.user)
            qs = qs.filter(customer_id__in=customer_ids)

        event = get_object_or_404(qs, id=event_id)
        _check_case_access(self.request, event)
        return event

    def get_queryset(self):
        event = self.get_event()
        user = self.request.user

        qs = (
            Task.objects
            .filter(is_deleted=False, case_links__case=event)
            .select_related("owner")
            .prefetch_related("customers", "case_links")
            .annotate(linked_case_count=Count("case_links", distinct=True))
            .distinct()
        )

        if not _user_can_manage_tasks(user):
            qs = qs.filter(owner=user)

        return qs.order_by("-updated_at", "id")