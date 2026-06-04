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


class BaseContextProvider:
    required_permission = ""

    def check(self, user, customer_id=None):
        return user_has_perm(user, self.required_permission, customer_id=customer_id)

    def build(self, req: ChatContextRequest) -> dict:
        raise NotImplementedError


CHAT_CONTEXT_LIMIT = 100

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

    return list(qs.values(*selected))


def _order_recent(qs):
    available = _model_field_names(qs.model)

    if "created_at" in available:
        return qs.order_by("-created_at")

    if "updated_at" in available:
        return qs.order_by("-updated_at")

    return qs.order_by("-id")


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
        return {
            "page_type": "dashboard",
            "filters": {},
            "widgets": [],
            "selected_period": None,
        }


class AuditContextProvider(BaseContextProvider):
    required_permission = "chat.read.audit"

    def build(self, req: ChatContextRequest) -> dict:
        return {
            "page_type": "audit",
            "filters": {},
            "events": [],
        }


class GlobalContextProvider(BaseContextProvider):
    required_permission = "chat.use"

    def build(self, req: ChatContextRequest) -> dict:
        from . import models as core_models

        Alert = core_models.Alert
        Event = core_models.Event
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

        if user_has_perm(req.user, "chat.read.case", customer_id=req.customer_id):
            cases_qs = _scope_queryset(Event.objects.all(), req.user, req.customer_id)

            payload["recent_cases"] = _safe_values(
                _order_recent(cases_qs)[:CHAT_CONTEXT_LIMIT],
                [
                    "id",
                    "case_number",
                    "title",
                    "description",
                    "status",
                    "severity",
                    "classification",
                    "outcome",
                    "iocs",
                    "assets",
                    "customer_id",
                    "owner_id",
                    "created_at",
                    "updated_at",
                ],
            )

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

        if user_has_perm(req.user, "chat.read.alert", customer_id=req.customer_id):
            alerts_qs = _scope_queryset(Alert.objects.all(), req.user, req.customer_id)

            payload["recent_alerts"] = _safe_values(
                _order_recent(alerts_qs)[:CHAT_CONTEXT_LIMIT],
                [
                    "id",
                    "title",
                    "description",
                    "status",
                    "severity",
                    "classification",
                    "source",
                    "outcome",
                    "iocs",
                    "assets",
                    "case_id",
                    "customer_id",
                    "owner_id",
                    "created_at",
                    "updated_at",
                ],
            )

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

        if user_has_perm(req.user, "chat.read.hunt", customer_id=req.customer_id):
            hunts_qs = _scope_queryset(Hunt.objects.all(), req.user, req.customer_id)

            payload["recent_hunts"] = _safe_values(
                _order_recent(hunts_qs)[:CHAT_CONTEXT_LIMIT],
                [
                    "id",
                    "title",
                    "context",
                    "conclusion",
                    "status",
                    "verdict",
                    "iocs",
                    "assets",
                    "customer_id",
                    "owner_id",
                    "investigation_started_at",
                    "investigation_finished_at",
                    "search_timeframe_start",
                    "search_timeframe_end",
                    "created_at",
                    "updated_at",
                ],
            )

            hunts_7d = _recent_window(hunts_qs, since_7d)

            payload["hunt_metrics_7d"] = {
                "total": hunts_7d.count(),
                "by_status": _count_by_field(
                    hunts_7d,
                    "status",
                    ["draft", "running", "completed", "closed"],
                ),
                "by_verdict": _count_by_field(
                    hunts_7d,
                    "verdict",
                    ["true_positive", "false_positive", "inconclusive"],
                ),
            }

        if Task and user_has_perm(req.user, "chat.read.task", customer_id=req.customer_id):
            tasks_qs = _scope_task_queryset(Task.objects.all(), req.user, req.customer_id)

            payload["recent_tasks"] = _safe_values(
                _order_recent(tasks_qs)[:CHAT_CONTEXT_LIMIT],
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

    def build(self, req: ChatContextRequest) -> dict:
        from .models import Alert, CaseExchange, Comment, Event, TimelineItem

        if not req.object_id:
            return {
                "page_type": "case",
                "object_id": None,
                "error": "missing_object_id",
            }

        case = (
            _scope_queryset(Event.objects.all(), req.user, req.customer_id)
            .filter(id=req.object_id)
            .select_related("customer", "owner")
            .first()
        )

        if not case:
            return {"page_type": "case", "missing": True}

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

        case_iocs = case.iocs or []
        case_assets = case.assets or []

        comments = list(
            Comment.objects
            .filter(event_id=case.id)
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
        )

        timeline = list(
            TimelineItem.objects
            .filter(event_id=case.id)
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
        )

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
        )

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
        )

        return {
            "page_type": "case",
            "current_tab": req.current_tab or "summary",
            "header": case_header,
            "iocs": case_iocs,
            "assets": case_assets,
            "comments": comments,
            "timeline": timeline,
            "exchanges": exchanges,
            "linked_alerts": linked_alerts,
        }


class AlertContextProvider(BaseContextProvider):
    required_permission = "chat.read.alert"

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
        )

        linked_case = None
        if alert.case_id and alert.case:
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
            "header": alert_header,
            "iocs": alert.iocs or [],
            "assets": alert.assets or [],
            "comments": comments,
            "linked_case": linked_case,
        }


class HuntContextProvider(BaseContextProvider):
    required_permission = "chat.read.hunt"

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
        )

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
        )

        return {
            "page_type": "hunt",
            "current_tab": req.current_tab or "journal",
            "header": hunt_header,
            "journal": journal_entries,
            "iocs": hunt.iocs or [],
            "assets": hunt.assets or [],
            "linked_cases": linked_cases,
            "timeline": [],
            "evidences": [],
        }


class TaskContextProvider(BaseContextProvider):
    required_permission = "chat.read.task"

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
            "header": task_data[0] if task_data else {"id": str(task.id)},
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
    return provider.build(req)