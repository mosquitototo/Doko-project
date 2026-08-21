from dataclasses import dataclass
from typing import Any
from datetime import timedelta

from django.utils import timezone
from django.db.models import Q, Count

from .rbac import user_has_perm, get_accessible_customer_ids


@dataclass
class ChatContextRequest:
    user: Any
    page_type: str
    object_id: str | None
    current_tab: str | None
    inclusions: list[str]
    customer_id: str | None


def _requested_inclusions(req: ChatContextRequest) -> set[str]:
    values = req.inclusions
    if not isinstance(values, (list, tuple, set)):
        return set()
    return {
        str(value or "").strip().lower()
        for value in list(values)[:25]
        if str(value or "").strip()
    }


class BaseContextProvider:
    required_permission = ""
    resource_permission = ""

    def check(self, user, customer_id=None):
        return user_has_perm(
            user,
            self.required_permission,
            customer_id=customer_id,
        ) and (
            not self.resource_permission
            or user_has_perm(user, self.resource_permission, customer_id=customer_id)
        )

    def build(self, req: ChatContextRequest) -> dict:
        raise NotImplementedError


CHAT_CONTEXT_LIMIT = 25
CHAT_CONTEXT_SENSITIVE_KEYS = {
    "password",
    "secret",
    "token",
    "authorization",
    "cookie",
    "headers",
    "raw",
    "request_payload",
    "response_payload",
}


def _minimize_context(value, depth=0):
    if depth >= 7:
        return "[truncated]"
    if isinstance(value, dict):
        return {
            str(key): "[redacted]"
            if str(key).lower() in CHAT_CONTEXT_SENSITIVE_KEYS
            else _minimize_context(item, depth + 1)
            for key, item in list(value.items())[:100]
        }
    if isinstance(value, (list, tuple)):
        return [_minimize_context(item, depth + 1) for item in value[:50]]
    if isinstance(value, str):
        return value[:4000]
    return value

def _model_field_names(model) -> set[str]:
    names = set()

    for field in model._meta.get_fields():
        if not getattr(field, "concrete", False):
            continue

        names.add(field.name)

        attname = getattr(field, "attname", None)
        if attname:
            names.add(attname)

    return names


def _safe_values(qs, fields: list[str]) -> list[dict]:
    available = _model_field_names(qs.model)
    selected = [field for field in fields if field in available]

    if not selected:
        return []

    return _minimize_context(list(qs.values(*selected)))


def _scope_queryset(qs, user, customer_id=None):
    available = _model_field_names(qs.model)

    if "is_deleted" in available:
        qs = qs.filter(is_deleted=False)

    if "customer_id" not in available:
        return qs if getattr(user, "is_staff", False) else qs.none()

    if getattr(user, "is_staff", False):
        if customer_id:
            return qs.filter(customer_id=customer_id)
        return qs

    allowed_customer_ids = list(get_accessible_customer_ids(user))
    if not allowed_customer_ids:
        return qs.none()

    if customer_id:
        if str(customer_id) not in {str(x) for x in allowed_customer_ids}:
            return qs.none()
        return qs.filter(customer_id=customer_id)

    return qs.filter(customer_id__in=allowed_customer_ids)


def _count_by_field(qs, field_name, values):
    if field_name not in _model_field_names(qs.model):
        return {}

    aggregates = {
        value: Count("id", filter=Q(**{field_name: value}))
        for value in values
    }
    result = qs.aggregate(**aggregates)
    return {value: result[value] or 0 for value in values}


def _recent_window(qs, since):
    available = _model_field_names(qs.model)
    if "created_at" not in available:
        return qs.none()

    return qs.filter(created_at__gte=since)


def _scope_task_queryset(qs, user, customer_id=None):
    if "is_deleted" in _model_field_names(qs.model):
        qs = qs.filter(is_deleted=False)

    if getattr(user, "is_staff", False):
        if customer_id:
            return qs.filter(customers__id=customer_id).distinct()
        return qs

    allowed_customer_ids = list(get_accessible_customer_ids(user))
    if customer_id:
        if str(customer_id) not in {str(x) for x in allowed_customer_ids}:
            return qs.none()
        return qs.filter(customers__id=customer_id).distinct()

    if allowed_customer_ids:
        return qs.filter(customers__id__in=allowed_customer_ids).distinct()

    return qs.filter(Q(owner=user) | Q(members=user)).distinct()


class DashboardContextProvider(BaseContextProvider):
    required_permission = "chat.read.dashboard"

    def build(self, req: ChatContextRequest) -> dict:
        global_payload = GlobalContextProvider().build(req)
        return {
            "page_type": "dashboard",
            "generated_at": global_payload.get("generated_at"),
            "case_metrics_2d": global_payload.get("case_metrics_2d", {}),
            "case_metrics_7d": global_payload.get("case_metrics_7d", {}),
            "alert_metrics_2d": global_payload.get("alert_metrics_2d", {}),
            "alert_metrics_7d": global_payload.get("alert_metrics_7d", {}),
            "hunt_metrics_7d": global_payload.get("hunt_metrics_7d", {}),
            "task_metrics_2d": global_payload.get("task_metrics_2d", {}),
            "task_metrics_7d": global_payload.get("task_metrics_7d", {}),
        }


class AuditContextProvider(BaseContextProvider):
    required_permission = "chat.read.audit"
    resource_permission = "settings.audit.view"

    def build(self, req: ChatContextRequest) -> dict:
        from .models import AuditLog

        events = list(
            AuditLog.objects.order_by("-created_at").values(
                "id",
                "action",
                "success",
                "status_code",
                "object_type",
                "object_id",
                "created_at",
            )[:50]
        )
        return {
            "page_type": "audit",
            "events": events,
        }


class GlobalContextProvider(BaseContextProvider):
    required_permission = "chat.use"

    def build(self, req: ChatContextRequest) -> dict:
        from . import models as core_models

        Alert = core_models.Alert
        Case = core_models.Case
        Hunt = core_models.Hunt
        Task = getattr(core_models, "Task", None)

        now = timezone.now()
        since_2d = now - timedelta(days=2)
        since_7d = now - timedelta(days=7)

        payload = {
            "page_type": "global",
            "generated_at": now,
            "limits": {
                "recent_items_per_type": CHAT_CONTEXT_LIMIT,
            },
            "recent_cases": [],
            "recent_alerts": [],
            "recent_hunts": [],
            "recent_tasks": [],
            "case_metrics_2d": {},
            "case_metrics_7d": {},
            "alert_metrics_2d": {},
            "alert_metrics_7d": {},
            "hunt_metrics_7d": {},
            "task_metrics_2d": {},
            "task_metrics_7d": {},
        }

        if user_has_perm(req.user, "chat.read.case", customer_id=req.customer_id) and user_has_perm(req.user, "case.view", customer_id=req.customer_id):
            cases_qs = _scope_queryset(Case.objects.all(), req.user, req.customer_id)

            cases_2d = _recent_window(cases_qs, since_2d)
            cases_7d = _recent_window(cases_qs, since_7d)

            payload["case_metrics_2d"] = {
                "total": cases_2d.count(),
                "by_severity": _count_by_field(
                    cases_2d,
                    "severity",
                    ["low", "medium", "high", "critical"],
                ),
                "by_status": _count_by_field(
                    cases_2d,
                    "status",
                    ["open", "in_progress", "closed"],
                ),
            }

            payload["case_metrics_7d"] = {
                "total": cases_7d.count(),
                "by_severity": _count_by_field(
                    cases_7d,
                    "severity",
                    ["low", "medium", "high", "critical"],
                ),
                "by_status": _count_by_field(
                    cases_7d,
                    "status",
                    ["open", "in_progress", "closed"],
                ),
            }

        if user_has_perm(req.user, "chat.read.alert", customer_id=req.customer_id) and user_has_perm(req.user, "alert.view", customer_id=req.customer_id):
            alerts_qs = _scope_queryset(Alert.objects.all(), req.user, req.customer_id)

            alerts_2d = _recent_window(alerts_qs, since_2d)
            alerts_7d = _recent_window(alerts_qs, since_7d)

            payload["alert_metrics_2d"] = {
                "total": alerts_2d.count(),
                "by_severity": _count_by_field(
                    alerts_2d,
                    "severity",
                    ["low", "medium", "high", "critical"],
                ),
                "by_status": _count_by_field(
                    alerts_2d,
                    "status",
                    ["open", "in_progress", "closed"],
                ),
            }

            payload["alert_metrics_7d"] = {
                "total": alerts_7d.count(),
                "by_severity": _count_by_field(
                    alerts_7d,
                    "severity",
                    ["low", "medium", "high", "critical"],
                ),
                "by_status": _count_by_field(
                    alerts_7d,
                    "status",
                    ["open", "in_progress", "closed"],
                ),
            }

        if user_has_perm(req.user, "chat.read.hunt", customer_id=req.customer_id) and user_has_perm(req.user, "hunt.view", customer_id=req.customer_id):
            hunts_qs = _scope_queryset(Hunt.objects.all(), req.user, req.customer_id)

            hunts_7d = _recent_window(hunts_qs, since_7d)

            payload["hunt_metrics_7d"] = {
                "total": hunts_7d.count(),
                "by_status": _count_by_field(
                    hunts_7d,
                    "status",
                    ["to_do", "in_progress", "completed", "abandoned"],
                ),
                "by_verdict": _count_by_field(
                    hunts_7d,
                    "verdict",
                    ["unknown", "suspicious", "malicious", "benign", "false_positive"],
                ),
            }

        if Task and user_has_perm(req.user, "chat.read.task", customer_id=req.customer_id) and user_has_perm(req.user, "task.view", customer_id=req.customer_id):
            tasks_qs = _scope_task_queryset(Task.objects.all(), req.user, req.customer_id)

            tasks_2d = _recent_window(tasks_qs, since_2d)
            tasks_7d = _recent_window(tasks_qs, since_7d)

            payload["task_metrics_2d"] = {
                "total": tasks_2d.count(),
                "by_status": _count_by_field(
                    tasks_2d,
                    "status",
                    ["to_do", "in_progress", "done", "canceled"],
                ),
                "by_priority": _count_by_field(
                    tasks_2d,
                    "priority",
                    ["low", "medium", "high", "critical"],
                ),
            }

            payload["task_metrics_7d"] = {
                "total": tasks_7d.count(),
                "by_status": _count_by_field(
                    tasks_7d,
                    "status",
                    ["to_do", "in_progress", "done", "canceled"],
                ),
                "by_priority": _count_by_field(
                    tasks_7d,
                    "priority",
                    ["low", "medium", "high", "critical"],
                ),
            }

        return payload


class CaseContextProvider(BaseContextProvider):
    required_permission = "chat.read.case"
    resource_permission = "case.view"

    def build(self, req: ChatContextRequest) -> dict:
        from .models import Alert, CaseExchange, Comment, Case, TimelineItem

        if not req.object_id:
            return {
                "page_type": "case",
                "object_id": None,
                "error": "missing_object_id",
            }

        case = (
            _scope_queryset(Case.objects.all(), req.user, req.customer_id)
            .filter(id=req.object_id)
            .select_related("customer", "owner")
            .first()
        )

        if not case:
            return {"page_type": "case", "missing": True}

        requested = _requested_inclusions(req)
        include_summary = not requested or "summary" in requested
        include_comments = "comments" in requested
        include_timeline = bool({"timeline", "incident_timeline"} & requested)
        include_exchanges = "exchanges" in requested
        include_linked_alerts = bool({"alerts", "linked_alerts"} & requested)

        case_header = {
            "id": str(case.id),
            "case_number": case.case_number,
            "title": case.title,
            "description": case.description or "",
            "status": case.status,
            "severity": case.severity,
            "classification": case.classification,
            "outcome": case.outcome,
            "owner_id": str(case.owner_id) if case.owner_id else None,
            "owner_username": case.owner.username if case.owner_id and case.owner else None,
            "customer_id": str(case.customer_id) if case.customer_id else None,
            "customer_name": case.customer.name if case.customer_id and case.customer else None,
            "created_at": case.created_at,
            "updated_at": case.updated_at,
        }

        case_iocs = (case.iocs or []) if "iocs" in requested else []
        case_assets = (case.assets or []) if "assets" in requested else []

        comments = list(
            Comment.objects
            .filter(case_id=case.id)
            .select_related("author")
            .order_by("created_at")
            .values(
                "id",
                "text",
                "created_at",
                "updated_at",
                "author_id",
                "author__username",
            )
        ) if include_comments else []

        timeline = list(
            TimelineItem.objects
            .filter(case_id=case.id)
            .select_related("actor", "alert")
            .order_by("date", "created_at")
            .values(
                "id",
                "date",
                "type",
                "text",
                "created_at",
                "updated_at",
                "actor_id",
                "actor__username",
                "alert_id",
                "alert__title",
            )
        ) if include_timeline else []

        exchanges = list(
            CaseExchange.objects
            .filter(case_id=case.id)
            .select_related("created_by")
            .order_by("created_at")
            .values(
                "id",
                "direction",
                "channel",
                "subject",
                "body",
                "sender",
                "to",
                "cc",
                "bcc",
                "message_id",
                "references",
                "created_by_id",
                "created_by__username",
                "created_at",
            )
        ) if include_exchanges else []

        linked_alerts = list(
            Alert.objects
            .filter(case_id=case.id, is_deleted=False)
            .select_related("customer", "owner")
            .order_by("-created_at")
            .values(
                "id",
                "title",
                "description",
                "classification",
                "severity",
                "status",
                "source",
                "outcome",
                "owner_id",
                "owner__username",
                "customer_id",
                "customer__name",
                "created_at",
                "updated_at",
            )
        ) if include_linked_alerts else []

        return {
            "page_type": "case",
            "current_tab": req.current_tab or "summary",
            "header": case_header if include_summary else {},
            "iocs": case_iocs,
            "assets": case_assets,
            "comments": comments,
            "timeline": timeline,
            "exchanges": exchanges,
            "linked_alerts": linked_alerts,
        }


class AlertContextProvider(BaseContextProvider):
    required_permission = "chat.read.alert"
    resource_permission = "alert.view"

    def build(self, req: ChatContextRequest) -> dict:
        from .models import Alert, AlertComment

        if not req.object_id:
            return {
                "page_type": "alert",
                "object_id": None,
                "error": "missing_object_id",
            }

        alert = (
            _scope_queryset(Alert.objects.all(), req.user, req.customer_id)
            .filter(id=req.object_id)
            .select_related("customer", "owner", "case")
            .first()
        )

        if not alert:
            return {"page_type": "alert", "missing": True}

        requested = _requested_inclusions(req)
        include_summary = not requested or "summary" in requested
        include_comments = "comments" in requested
        include_linked_case = bool({"case", "linked_case"} & requested)

        alert_header = {
            "id": str(alert.id),
            "title": alert.title,
            "description": alert.description or "",
            "classification": alert.classification,
            "severity": alert.severity,
            "status": alert.status,
            "source": alert.source or "",
            "outcome": alert.outcome,
            "owner_id": str(alert.owner_id) if alert.owner_id else None,
            "owner_username": alert.owner.username if alert.owner_id and alert.owner else None,
            "customer_id": str(alert.customer_id) if alert.customer_id else None,
            "customer_name": alert.customer.name if alert.customer_id and alert.customer else None,
            "case_id": str(alert.case_id) if alert.case_id else None,
            "created_at": alert.created_at,
            "updated_at": alert.updated_at,
        }

        comments = list(
            AlertComment.objects
            .filter(alert_id=alert.id)
            .select_related("author")
            .order_by("created_at")
            .values(
                "id",
                "text",
                "created_at",
                "updated_at",
                "author_id",
                "author__username",
            )
        ) if include_comments else []

        linked_case = None
        if include_linked_case and alert.case_id and alert.case:
            linked_case = {
                "id": str(alert.case.id),
                "case_number": alert.case.case_number,
                "title": alert.case.title,
                "status": alert.case.status,
                "severity": alert.case.severity,
                "classification": alert.case.classification,
                "customer_id": str(alert.case.customer_id) if alert.case.customer_id else None,
                "owner_id": str(alert.case.owner_id) if alert.case.owner_id else None,
                "created_at": alert.case.created_at,
                "updated_at": alert.case.updated_at,
            }

        return {
            "page_type": "alert",
            "current_tab": req.current_tab or "overview",
            "header": alert_header if include_summary else {},
            "iocs": (alert.iocs or []) if "iocs" in requested else [],
            "assets": (alert.assets or []) if "assets" in requested else [],
            "comments": comments,
            "linked_case": linked_case,
        }


class HuntContextProvider(BaseContextProvider):
    required_permission = "chat.read.hunt"
    resource_permission = "hunt.view"

    def build(self, req: ChatContextRequest) -> dict:
        from .models import Hunt, HuntCaseLink, HuntJournalEntry

        if not req.object_id:
            return {
                "page_type": "hunt",
                "object_id": None,
                "error": "missing_object_id",
            }

        hunt = (
            _scope_queryset(Hunt.objects.all(), req.user, req.customer_id)
            .filter(id=req.object_id)
            .select_related("customer", "owner")
            .first()
        )

        if not hunt:
            return {"page_type": "hunt", "missing": True}

        requested = _requested_inclusions(req)
        include_summary = not requested or "summary" in requested
        include_journal = "journal" in requested
        include_case_links = bool({"case_links", "linked_cases"} & requested)

        hunt_header = {
            "id": str(hunt.id),
            "title": hunt.title,
            "context": hunt.context or "",
            "conclusion": hunt.conclusion or "",
            "status": hunt.status,
            "verdict": hunt.verdict,
            "owner_id": str(hunt.owner_id) if hunt.owner_id else None,
            "owner_username": hunt.owner.username if hunt.owner_id and hunt.owner else None,
            "customer_id": str(hunt.customer_id) if hunt.customer_id else None,
            "customer_name": hunt.customer.name if hunt.customer_id and hunt.customer else None,
            "investigation_started_at": hunt.investigation_started_at,
            "investigation_finished_at": hunt.investigation_finished_at,
            "search_timeframe_start": hunt.search_timeframe_start,
            "search_timeframe_end": hunt.search_timeframe_end,
            "created_at": hunt.created_at,
            "updated_at": hunt.updated_at,
        }

        journal_entries = list(
            HuntJournalEntry.objects
            .filter(hunt_id=hunt.id)
            .select_related("author")
            .order_by("occurred_at", "created_at")
            .values(
                "id",
                "entry_type",
                "text",
                "occurred_at",
                "linked_ioc_value",
                "linked_asset_value",
                "linked_action_run_id",
                "created_at",
                "updated_at",
                "author_id",
                "author__username",
            )
        ) if include_journal else []

        linked_cases = list(
            HuntCaseLink.objects
            .filter(hunt_id=hunt.id)
            .select_related("case", "created_by")
            .order_by("created_at")
            .values(
                "id",
                "link_type",
                "created_at",
                "created_by_id",
                "created_by__username",
                "case_id",
                "case__case_number",
                "case__title",
                "case__status",
                "case__severity",
                "case__classification",
                "case__customer_id",
                "case__owner_id",
            )
        ) if include_case_links else []

        return {
            "page_type": "hunt",
            "current_tab": req.current_tab or "journal",
            "header": hunt_header if include_summary else {},
            "journal": journal_entries,
            "iocs": (hunt.iocs or []) if "iocs" in requested else [],
            "assets": (hunt.assets or []) if "assets" in requested else [],
            "linked_cases": linked_cases,
            "timeline": [],
            "evidences": [],
        }


class TaskContextProvider(BaseContextProvider):
    required_permission = "chat.read.task"
    resource_permission = "task.view"

    def build(self, req: ChatContextRequest) -> dict:
        from . import models as core_models

        Task = getattr(core_models, "Task", None)
        if not Task:
            return {
                "page_type": "task",
                "missing": True,
                "error": "task_model_not_found",
            }

        if not req.object_id:
            return {
                "page_type": "task",
                "object_id": None,
                "error": "missing_object_id",
            }

        tasks_qs = _scope_task_queryset(Task.objects.all(), req.user, req.customer_id)
        task = tasks_qs.filter(id=req.object_id).first()

        if not task:
            return {
                "page_type": "task",
                "missing": True,
            }

        requested = _requested_inclusions(req)
        include_summary = not requested or "summary" in requested

        task_data = _safe_values(
            tasks_qs.filter(id=task.id),
            [
                "id",
                "title",
                "description",
                "status",
                "priority",
                "due_date",
                "owner_id",
                "created_by_id",
                "created_at",
                "updated_at",
            ],
        )

        return {
            "page_type": "task",
            "current_tab": req.current_tab or "overview",
            "header": (
                task_data[0] if task_data else {"id": str(task.id)}
            ) if include_summary else {},
        }
    

PROVIDERS = {
    "global": GlobalContextProvider(),
    "dashboard": DashboardContextProvider(),
    "audit": AuditContextProvider(),
    "case": CaseContextProvider(),
    "alert": AlertContextProvider(),
    "hunt": HuntContextProvider(),
    "task": TaskContextProvider(),
}


def build_chat_context_snapshot(req: ChatContextRequest) -> dict:
    provider = PROVIDERS.get(req.page_type)
    if not provider:
        return {"page_type": req.page_type or "global", "context": {}}
    if not provider.check(req.user, customer_id=req.customer_id):
        raise PermissionError("You do not have permission to read this chat context")
    return _minimize_context(provider.build(req))
