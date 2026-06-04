from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any
import json
import time
from html import escape

from django.utils import timezone
from django.contrib.auth import get_user_model
from django.db import transaction

from .html_sanitizer import sanitize_html
from .models import (
    Alert,
    AlertComment,
    AutomationExecutionLog,
    AutomationRule,
    CaseExchange,
    CaseExchangeReplyQuickpart,
    Classification,
    Comment,
    Customer,
    Event,
    Hunt,
    HuntJournalEntry,
    InvestigationTemplate,
    Severity,
    TimelineItem,
    WorkbookTemplate,
    WorkbookInstance,
    WorkbookInstanceItem,
    AIProvider,
)
from .services_soar import SOARService
from .services_llm import LLMService
from .services_chat import _build_system_prompt



EMPTY_VALUE = "__empty__"
SYSTEM_AUTHOR_LABEL = "Doko Automation"

ALLOWED_CONDITION_FIELDS = {
    "event",
    "title",
    "status",
    "owner",
    "classification",
    "severity",
    "customer",
    "source",
    "linked_alert_count",
    "object_age_hours",
    "ioc_count",
    "asset_count",
    "inbound_exchange_delay_minutes",
    "ioc",
    "asset",
    "ioc_status",
    "asset_status",
    "scheduled_time",
}

ALLOWED_OPERATORS = {
    "EQUAL",
    "NOT EQUAL",
    "CONTAINS",
    "DOES NOT CONTAIN",
    "GREATER THAN",
    "LESS THAN",
    "BETWEEN",
}

ACTION_TYPES = {
    "add_comment",
    "exchange_message",
    "exchange_reply_last_inbound",
    "exchange_reply_all_inbound",
    "apply_workbook_template",
    "change_status",
    "change_classification",
    "change_owner",
    "change_customer",
    "change_severity",
    "run_investigation_template",
}


@dataclass
class AutomationContext:
    scope: str
    target: Any
    event: str
    actor: Any = None
    data: dict | None = None
    rule: AutomationRule | None = None

    @property
    def target_id(self) -> str:
        return str(getattr(self.target, "id", "") or "")


def to_json_safe(value):
    if value is None:
        return None

    if isinstance(value, uuid.UUID):
        return str(value)

    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass

    if isinstance(value, dict):
        return {str(k): to_json_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [to_json_safe(v) for v in value]

    return value


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _normalize(value: Any) -> str:
    return _as_text(value).strip().lower()


def _is_empty(value: Any) -> bool:
    return value in (None, "", [], {})


def _contains(left: Any, right: Any) -> bool:
    if _is_empty(right):
        return False

    needle = _normalize(right)

    if isinstance(left, list):
        for item in left:
            if isinstance(item, dict):
                candidates = [
                    item.get("value"),
                    item.get("name"),
                    item.get("type"),
                    item.get("kind"),
                    item.get("status"),
                    item.get("state"),
                ]
                if any(needle in _normalize(x) for x in candidates):
                    return True
            elif needle in _normalize(item):
                return True
        return False

    if isinstance(left, dict):
        return needle in _normalize(left)

    return needle in _normalize(left)


def _as_number(value: Any):
    try:
        return float(value)
    except Exception:
        return None


def _as_time_minutes(value: Any):
    text = str(value or "").strip()
    parts = text.split(":")

    if len(parts) < 2:
        return None

    try:
        hours = int(parts[0])
        minutes = int(parts[1])
    except Exception:
        return None

    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        return None

    return hours * 60 + minutes


def _between(left: Any, value: Any) -> bool:
    if not isinstance(value, dict):
        return False

    start = value.get("from")
    end = value.get("to")

    left_minutes = _as_time_minutes(left)
    start_minutes = _as_time_minutes(start)
    end_minutes = _as_time_minutes(end)

    if left_minutes is not None and start_minutes is not None and end_minutes is not None:
        if start_minutes <= end_minutes:
            return start_minutes <= left_minutes <= end_minutes

        return left_minutes >= start_minutes or left_minutes <= end_minutes

    left_number = _as_number(left)
    start_number = _as_number(start)
    end_number = _as_number(end)

    if left_number is not None and start_number is not None and end_number is not None:
        return start_number <= left_number <= end_number

    return False


def _compare(left: Any, operator: str, right: Any) -> bool:
    op = (operator or "").strip().upper()

    if op == "IS":
        op = "EQUAL"
    elif op == "IS NOT":
        op = "NOT EQUAL"

    if right == EMPTY_VALUE:
        is_match = _is_empty(left)
    elif isinstance(left, list):
        is_match = any(_normalize(item) == _normalize(right) for item in left)
    else:
        is_match = _normalize(left) == _normalize(right)

    if op == "EQUAL":
        return is_match

    if op == "NOT EQUAL":
        return not is_match

    if op == "CONTAINS":
        return _contains(left, right)

    if op == "DOES NOT CONTAIN":
        return not _contains(left, right)

    if op in {"GREATER THAN", "LESS THAN"}:
        left_number = _as_number(left)
        right_number = _as_number(right)

        if left_number is None or right_number is None:
            return False

        if op == "GREATER THAN":
            return left_number > right_number

        return left_number < right_number

    if op == "BETWEEN":
        return _between(left, right)

    return False


def _extract_item_value(item: Any) -> str:
    if isinstance(item, dict):
        for key in ("value", "name", "id", "key"):
            value = item.get(key)
            if value not in (None, ""):
                return str(value)
        return str(item)

    return str(item) if item is not None else ""


def _extract_item_type(item: Any) -> str:
    if isinstance(item, dict):
        return str(item.get("type") or item.get("kind") or item.get("key") or "")
    return ""


def _extract_item_status(item: Any) -> str:
    if isinstance(item, dict):
        return str(item.get("status") or item.get("state") or "")
    return ""


def _extract_item_context_id(item: Any) -> str:
    if isinstance(item, dict):
        for key in (
            "container_id",
            "incident_id",
            "soar_container_id",
            "soar_incident_id",
            "external_id",
            "remote_id",
        ):
            value = item.get(key)
            if value not in (None, ""):
                return str(value)
    return ""


def _target_description(target: Any) -> str:
    return str(getattr(target, "description", "") or "")


def _target_kind(item: Any, fallback: str = "") -> str:
    if isinstance(item, dict):
        value = item.get("kind") or item.get("category") or fallback
        return str(value or "")
    return fallback


def _target_context_ids(ctx: AutomationContext, item: Any | None = None) -> dict:
    data = ctx.data or {}
    target = ctx.target

    item_context_id = _extract_item_context_id(item)

    raw = getattr(target, "raw", None)
    if not isinstance(raw, dict):
        raw = {}

    provider_execution = getattr(target, "provider_execution", None)
    if not isinstance(provider_execution, dict):
        provider_execution = {}

    container_id = (
        item_context_id
        or data.get("container_id")
        or data.get("incident_id")
        or raw.get("container_id")
        or raw.get("incident_id")
        or provider_execution.get("container_id")
        or provider_execution.get("incident_id")
        or ""
    )

    incident_id = (
        item_context_id
        or data.get("incident_id")
        or raw.get("incident_id")
        or provider_execution.get("incident_id")
        or container_id
        or ""
    )

    return {
        "container_id": str(container_id or ""),
        "incident_id": str(incident_id or ""),
    }


def _added_items(before: list, after: list) -> list:
    before_values = {_normalize(_extract_item_value(x)) for x in before or []}
    return [
        x
        for x in (after or [])
        if _normalize(_extract_item_value(x)) not in before_values
    ]


def _target_customer_id(target: Any) -> str:
    return str(getattr(target, "customer_id", "") or "")


def _target_owner_id(target: Any) -> str:
    return str(getattr(target, "owner_id", "") or "")


def _case_alert_sources(target: Any) -> list[str]:
    if not isinstance(target, Event):
        return []

    sources = []
    seen = set()

    qs = (
        Alert.objects
        .filter(case=target, is_deleted=False)
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


def _target_source(target: Any):
    if isinstance(target, Event):
        return _case_alert_sources(target)

    return str(getattr(target, "source", "") or "").strip()


def _target_source_text(target: Any) -> str:
    value = _target_source(target)

    if isinstance(value, list):
        return ", ".join(value)

    return str(value or "").strip()


def _linked_alert_count(target: Any) -> int:
    if isinstance(target, Event):
        return Alert.objects.filter(case=target, is_deleted=False).count()
    return 0


def _object_age_hours(target: Any) -> int:
    created_at = getattr(target, "created_at", None)
    if not created_at:
        return 0

    delta = timezone.now() - created_at
    return max(0, int(delta.total_seconds() // 3600))


def _inbound_exchange_delay_minutes(target: Any) -> int:
    if not isinstance(target, Event):
        return 0

    last_inbound = (
        CaseExchange.objects
        .filter(case=target, direction="inbound")
        .order_by("-created_at")
        .first()
    )

    if not last_inbound:
        return 0

    delta = timezone.now() - last_inbound.created_at
    return max(0, int(delta.total_seconds() // 60))


TRANSITION_CONDITION_FIELDS = {
    "title",
    "status",
    "owner",
    "classification",
    "severity",
    "customer",
    "source",
    "ioc_count",
    "asset_count",
    "ioc",
    "asset",
    "ioc_status",
    "asset_status",
}


PROCESSED_AUTOMATION_STATUSES = [
    AutomationExecutionLog.Status.RUNNING,
    AutomationExecutionLog.Status.SUCCESS,
    AutomationExecutionLog.Status.PARTIAL_SUCCESS,
    AutomationExecutionLog.Status.FAILED,
]


def _previous_snapshot(ctx: AutomationContext) -> dict:
    data = ctx.data or {}
    before = data.get("before") or {}
    return before if isinstance(before, dict) else {}


def _has_previous_snapshot(ctx: AutomationContext) -> bool:
    return bool(_previous_snapshot(ctx))


def _condition_tree_has_transition_field(tree: dict | None) -> bool:
    if not isinstance(tree, dict):
        return False

    children = tree.get("children")

    if isinstance(children, list):
        return any(_condition_tree_has_transition_field(child) for child in children)

    return str(tree.get("field") or "").strip() in TRANSITION_CONDITION_FIELDS


def _previous_field_value(ctx: AutomationContext, field: str):
    before = _previous_snapshot(ctx)

    if field == "event":
        return ctx.event

    if field == "owner":
        return str(before.get("owner_id") or before.get("owner") or "")

    if field == "customer":
        return str(before.get("customer_id") or before.get("customer") or "")

    if field == "source":
        return before.get("source", "")

    if field == "ioc_count":
        return len(before.get("iocs") or [])

    if field == "asset_count":
        return len(before.get("assets") or [])

    if field == "ioc":
        return [_extract_item_value(x) for x in (before.get("iocs") or [])]

    if field == "asset":
        return [_extract_item_value(x) for x in (before.get("assets") or [])]

    if field == "ioc_status":
        return [_extract_item_status(x) for x in (before.get("iocs") or [])]

    if field == "asset_status":
        return [_extract_item_status(x) for x in (before.get("assets") or [])]

    if field in TRANSITION_CONDITION_FIELDS:
        return before.get(field, "")

    return _field_value(ctx, field, previous=False)


def _field_value(ctx: AutomationContext, field: str, previous: bool = False):
    if previous:
        return _previous_field_value(ctx, field)

    target = ctx.target
    data = ctx.data or {}

    if field == "event":
        return ctx.event

    if field == "owner":
        return _target_owner_id(target)

    if field == "customer":
        return _target_customer_id(target)
    
    if field == "source":
        return _target_source(target)

    if field == "linked_alert_count":
        return _linked_alert_count(target)

    if field == "object_age_hours":
        return _object_age_hours(target)

    if field == "ioc_count":
        return len(getattr(target, "iocs", None) or [])

    if field == "asset_count":
        return len(getattr(target, "assets", None) or [])

    if field == "inbound_exchange_delay_minutes":
        return _inbound_exchange_delay_minutes(target)

    if field == "ioc":
        added = data.get("added_ioc")
        if added is not None:
            return _extract_item_value(added)
        return [_extract_item_value(x) for x in (getattr(target, "iocs", None) or [])]

    if field == "asset":
        added = data.get("added_asset")
        if added is not None:
            return _extract_item_value(added)
        return [_extract_item_value(x) for x in (getattr(target, "assets", None) or [])]

    if field == "ioc_status":
        ioc = data.get("added_ioc")
        if ioc is not None:
            return _extract_item_status(ioc)
        return [_extract_item_status(x) for x in (getattr(target, "iocs", None) or [])]

    if field == "asset_status":
        asset = data.get("added_asset")
        if asset is not None:
            return _extract_item_status(asset)
        return [_extract_item_status(x) for x in (getattr(target, "assets", None) or [])]

    if field == "scheduled_time":
        return data.get("scheduled_time") or timezone.localtime().strftime("%H:%M")

    return getattr(target, field, "")


def evaluate_condition_tree(
    tree: dict | None,
    ctx: AutomationContext,
    previous: bool = False,
) -> bool:
    if not tree:
        return False

    if not isinstance(tree, dict):
        return False

    children = tree.get("children")

    if isinstance(children, list):
        logic = str(tree.get("operator") or "AND").upper()
        results = [
            evaluate_condition_tree(child, ctx, previous=previous)
            for child in children
        ]

        if not results:
            return False

        if logic == "OR":
            return any(results)

        return all(results)

    field = str(tree.get("field") or "").strip()
    operator = str(tree.get("operator") or "IS").strip().upper()
    value = tree.get("value")

    if field not in ALLOWED_CONDITION_FIELDS:
        return False

    if operator not in ALLOWED_OPERATORS:
        return False

    return _compare(_field_value(ctx, field, previous=previous), operator, value)


def evaluate_rule_conditions(rule: AutomationRule, ctx: AutomationContext) -> bool:
    tree = rule.conditions or {}

    current_match = evaluate_condition_tree(tree, ctx, previous=False)

    if not current_match:
        return False

    if not _has_previous_snapshot(ctx):
        return True

    if not _condition_tree_has_transition_field(tree):
        return True

    previous_match = evaluate_condition_tree(tree, ctx, previous=True)

    return not previous_match


def _target_payload(target: Any) -> dict:
    data = {
        "id": str(getattr(target, "id", "") or ""),
        "title": getattr(target, "title", "") or "",
        "status": getattr(target, "status", "") or "",
        "severity": getattr(target, "severity", "") or "",
        "classification": getattr(target, "classification", "") or "",
        "source": _target_source_text(target),
        "sources": _target_source(target) if isinstance(target, Event) else [],
        "customer_id": _target_customer_id(target) or None,
        "owner_id": _target_owner_id(target) or None,
    }

    if hasattr(target, "case_number"):
        data["case_number"] = getattr(target, "case_number", None)

    return data


def _runtime_variables(ctx: AutomationContext, extra: dict | None = None) -> dict:
    data = ctx.data or {}
    added_ioc = data.get("added_ioc")
    added_asset = data.get("added_asset")
    exchange = data.get("exchange")
    context_ids = _target_context_ids(ctx)

    variables = {
        "scope": ctx.scope,
        "event": ctx.event,

        "target.id": ctx.target_id,
        "target.title": getattr(ctx.target, "title", "") or "",
        "target.description": _target_description(ctx.target),
        "target.status": getattr(ctx.target, "status", "") or "",
        "target.severity": getattr(ctx.target, "severity", "") or "",
        "target.classification": getattr(ctx.target, "classification", "") or "",
        "target.source": _target_source_text(ctx.target),
        "target.sources": _target_source(ctx.target) if isinstance(ctx.target, Event) else [],
        "target.customer_id": _target_customer_id(ctx.target),
        "target.owner_id": _target_owner_id(ctx.target),

        "case.id": ctx.target_id if isinstance(ctx.target, Event) else "",
        "case.title": getattr(ctx.target, "title", "") if isinstance(ctx.target, Event) else "",
        "case.description": _target_description(ctx.target) if isinstance(ctx.target, Event) else "",
        "case.source": _target_source_text(ctx.target) if isinstance(ctx.target, Event) else "",
        "case.sources": _target_source(ctx.target) if isinstance(ctx.target, Event) else [],

        "alert.id": ctx.target_id if isinstance(ctx.target, Alert) else "",
        "alert.title": getattr(ctx.target, "title", "") if isinstance(ctx.target, Alert) else "",
        "alert.description": _target_description(ctx.target) if isinstance(ctx.target, Alert) else "",
        "alert.source": _target_source_text(ctx.target) if isinstance(ctx.target, Alert) else "",

        "hunt.id": ctx.target_id if isinstance(ctx.target, Hunt) else "",
        "hunt.title": getattr(ctx.target, "title", "") if isinstance(ctx.target, Hunt) else "",
        "hunt.description": _target_description(ctx.target) if isinstance(ctx.target, Hunt) else "",

        "ioc.value": _extract_item_value(added_ioc),
        "ioc.type": _extract_item_type(added_ioc),
        "ioc.status": _extract_item_status(added_ioc),

        "asset.value": _extract_item_value(added_asset),
        "asset.type": _extract_item_type(added_asset),
        "asset.status": _extract_item_status(added_asset),

        "container_id": context_ids["container_id"],
        "incident_id": context_ids["incident_id"],
    }

    if exchange:
        variables.update({
            "exchange.id": str(getattr(exchange, "id", "") or ""),
            "exchange.subject": getattr(exchange, "subject", "") or "",
            "exchange.sender": getattr(exchange, "sender", "") or "",
        })

    if extra:
        variables.update(extra)

    return variables


def _render_template_string(value: str, variables: dict) -> str:
    out = str(value or "")
    for key, replacement in variables.items():
        out = out.replace("{{" + key + "}}", _as_text(replacement))
    return out


def _render_mapping(value, ctx: AutomationContext, extra: dict | None = None):
    variables = _runtime_variables(ctx, extra=extra)

    if isinstance(value, str):
        return _render_template_string(value, variables)

    if isinstance(value, list):
        return [_render_mapping(item, ctx, extra=extra) for item in value]

    if isinstance(value, dict):
        return {
            str(key): _render_mapping(item, ctx, extra=extra)
            for key, item in value.items()
        }

    return value


def _create_timeline(case: Event, text: str, item_type: str = "automation_action"):
    TimelineItem.objects.create(
        event=case,
        date=timezone.now().date(),
        type=item_type,
        text=text,
        actor=None,
    )


def _get_case_for_action(ctx: AutomationContext) -> Event | None:
    if isinstance(ctx.target, Event):
        return ctx.target

    if isinstance(ctx.target, Alert) and ctx.target.case_id:
        return ctx.target.case

    return None


def _add_comment(ctx: AutomationContext, action: dict) -> dict:
    body = sanitize_html(
        _render_template_string(
            action.get("body") or "",
            _runtime_variables(ctx),
        )
    )

    if ctx.scope == "case":
        case = _get_case_for_action(ctx)
        if not case:
            raise ValueError("Case not found")

        comment = Comment.objects.create(
            event=case,
            author=None,
            author_label=SYSTEM_AUTHOR_LABEL,
            text=body,
        )
        _create_timeline(case, "Automation comment added", "comment_added")
        return {"comment_id": str(comment.id)}

    if ctx.scope == "alert":
        comment = AlertComment.objects.create(
            alert=ctx.target,
            author=None,
            author_label=SYSTEM_AUTHOR_LABEL,
            text=body,
        )
        return {"comment_id": str(comment.id)}

    if ctx.scope == "hunt":
        note = HuntJournalEntry.objects.create(
            hunt=ctx.target,
            author=None,
            entry_type=HuntJournalEntry.EntryType.NOTE,
            text=body,
        )
        return {"journal_entry_id": str(note.id)}

    raise ValueError("Unsupported comment scope")


def _normalize_recipients(value):
    if value is None:
        return []

    if isinstance(value, list):
        return [
            str(item).strip()
            for item in value
            if str(item or "").strip()
        ]

    if isinstance(value, str):
        return [
            item.strip()
            for item in value.replace(";", ",").split(",")
            if item.strip()
        ]

    return []


def _normalize_subject_for_reply(value: Any) -> str:
    subject = str(value or "").strip()

    if not subject:
        return ""

    lowered = subject.lower()

    if lowered.startswith("re:") or lowered.startswith("re :"):
        return subject

    return f"Re: {subject}"


def _reply_recipients_from_source(source: CaseExchange) -> list[str]:
    return _normalize_recipients([getattr(source, "sender", "")])


def _reply_references_from_source(source: CaseExchange) -> list[str]:
    references = []

    for item in list(source.references or []):
        value = str(item or "").strip()
        if value and value not in references:
            references.append(value)

    parent_message_id = str(source.message_id or "").strip()

    if parent_message_id and parent_message_id not in references:
        references.append(parent_message_id)

    return references


def _reply_in_reply_to_from_source(source: CaseExchange) -> str:
    return str(source.message_id or "").strip()


def _automation_rule_id(ctx: AutomationContext) -> str:
    return str(getattr(ctx.rule, "id", "") or "")


def _automation_action_index(action: dict) -> int | None:
    try:
        return int(action.get("_automation_action_index"))
    except Exception:
        return None


def _automation_exchange_exists(
    *,
    case: Event,
    ctx: AutomationContext,
    action: dict,
    source: CaseExchange | None,
) -> bool:
    rule_id = _automation_rule_id(ctx)

    if not rule_id:
        return False

    source_exchange_id = str(source.id) if source else ""
    action_key = _automation_action_key(action)

    return CaseExchange.objects.filter(
        case=case,
        direction="outbound",
        raw__kind="automation_rule",
        raw__automation_rule_id=rule_id,
        raw__automation_action_key=action_key,
        raw__source_exchange_id=source_exchange_id,
    ).exists()


def _create_exchange_from_source(
    *,
    case: Event,
    source: CaseExchange | None,
    action: dict,
    ctx: AutomationContext,
) -> CaseExchange:
    quickpart = None
    quickpart_id = action.get("quickpart_id")

    if quickpart_id:
        quickpart = CaseExchangeReplyQuickpart.objects.filter(
            id=quickpart_id,
            is_active=True,
        ).first()

    body_template = quickpart.body if quickpart else action.get("body") or ""
    body = sanitize_html(
        _render_template_string(
            body_template,
            _runtime_variables(ctx),
        )
    )

    if source:
        subject = _normalize_subject_for_reply(source.subject)
        channel = source.channel or "email"
        to = _reply_recipients_from_source(source)
        cc = []
        bcc = []
        references = _reply_references_from_source(source)
        in_reply_to = _reply_in_reply_to_from_source(source)
        message_id = ""
    else:
        subject = action.get("subject") or ""
        channel = action.get("channel") or "email"
        to = _normalize_recipients(action.get("to"))
        cc = _normalize_recipients(action.get("cc"))
        bcc = _normalize_recipients(action.get("bcc"))
        references = []
        in_reply_to = ""
        message_id = ""

    if action.get("send_mode") == "send" and not to:
        raise ValueError("At least one recipient is required to send an Exchange message")

    exchange = CaseExchange.objects.create(
        case=case,
        created_by=None,
        direction="outbound",
        channel=channel,
        subject=subject,
        body=body,
        sender="",
        to=to if isinstance(to, list) else [],
        cc=cc if isinstance(cc, list) else [],
        bcc=bcc if isinstance(bcc, list) else [],
        message_id=message_id,
        references=references,
        raw={
            "kind": "automation_rule",
            "automation_rule_id": _automation_rule_id(ctx),
            "automation_action_index": _automation_action_index(action),
            "automation_action_key": _automation_action_key(action),
            "source_exchange_id": str(source.id) if source else "",
            "quickpart_id": str(quickpart.id) if quickpart else "",
            "send_mode": action.get("send_mode") or "save",
            "in_reply_to": in_reply_to,
        },
    )

    _create_timeline(
        case,
        f"Automation exchange created: {(exchange.subject or '(no subject)')}",
        "case_exchange_created",
    )

    if action.get("send_mode") == "send":
        from .views import dispatch_case_exchange_send

        dispatch_case_exchange_send(case, exchange, None)

    return exchange


def _exchange_action(ctx: AutomationContext, action: dict) -> dict:
    case = _get_case_for_action(ctx)

    if not case:
        raise ValueError("Exchange actions require a case")

    action_type = action.get("type")
    send_mode = action.get("send_mode") or "save"

    if action_type == "exchange_message":
        if _automation_exchange_exists(
            case=case,
            ctx=ctx,
            action=action,
            source=None,
        ):
            return {
                "exchange_ids": [],
                "automation_action_key": _automation_action_key(action),
                "skipped": "automation_exchange_already_created",
            }

        exchange = _create_exchange_from_source(
            case=case,
            source=None,
            action=action,
            ctx=ctx,
        )
        return {
            "exchange_ids": [str(exchange.id)],
            "automation_action_key": _automation_action_key(action),
        }

    inbound_qs = (
        CaseExchange.objects
        .filter(case=case, direction="inbound")
        .order_by("-created_at")
    )

    def source_skip_reason(source: CaseExchange) -> str:
        if _automation_exchange_exists(
            case=case,
            ctx=ctx,
            action=action,
            source=source,
        ):
            return "automation_reply_already_created"

        if send_mode == "send" and not _reply_recipients_from_source(source):
            return "missing_reply_recipient"

        return ""

    if action_type == "exchange_reply_last_inbound":
        source = inbound_qs.first()

        if not source:
            return {
                "exchange_ids": [],
                "automation_action_key": _automation_action_key(action),
                "skipped": "no_inbound_exchange",
            }

        reason = source_skip_reason(source)

        if reason:
            return {
                "exchange_ids": [],
                "automation_action_key": _automation_action_key(action),
                "skipped": reason,
                "source_exchange_id": str(source.id),
            }

        exchange = _create_exchange_from_source(
            case=case,
            source=source,
            action=action,
            ctx=ctx,
        )
        return {
            "exchange_ids": [str(exchange.id)],
            "source_exchange_ids": [str(source.id)],
            "automation_action_key": _automation_action_key(action),
        }

    if action_type == "exchange_reply_all_inbound":
        created_ids = []
        source_ids = []
        skipped_sources = []

        for source in inbound_qs[:20]:
            reason = source_skip_reason(source)

            if reason:
                skipped_sources.append({
                    "source_exchange_id": str(source.id),
                    "reason": reason,
                })
                continue

            exchange = _create_exchange_from_source(
                case=case,
                source=source,
                action=action,
                ctx=ctx,
            )
            created_ids.append(str(exchange.id))
            source_ids.append(str(source.id))

        return {
            "exchange_ids": created_ids,
            "source_exchange_ids": source_ids,
            "skipped_sources": skipped_sources,
            "automation_action_key": _automation_action_key(action),
            "skipped": "no_eligible_inbound_exchange" if not created_ids else "",
        }

    raise ValueError("Unsupported exchange action")


def _validate_change_field_value(ctx: AutomationContext, field: str, value):
    if value in (None, ""):
        return value

    if field == "owner_id":
        User = get_user_model()
        if not User.objects.filter(id=value, is_active=True).exists():
            raise ValueError("Unknown or inactive owner")
        return value

    if field == "customer_id":
        if not Customer.objects.filter(id=value, is_active=True).exists():
            raise ValueError("Unknown or inactive customer")
        return value

    if field == "severity":
        if isinstance(ctx.target, Hunt):
            raise ValueError("Severity is not available for this scope")

        if not Severity.objects.filter(code=str(value), is_active=True).exists():
            raise ValueError("Unknown or inactive severity")
        return str(value)

    if field == "classification":
        if not Classification.objects.filter(code=str(value), is_active=True).exists():
            raise ValueError("Unknown or inactive classification")
        return str(value)

    return value


def _change_field(ctx: AutomationContext, action: dict) -> dict:
    field_map = {
        "change_status": "status",
        "change_classification": "classification",
        "change_severity": "severity",
        "change_owner": "owner_id",
        "change_customer": "customer_id",
    }

    field = field_map.get(action.get("type"))
    if not field:
        raise ValueError("Unsupported field update action")

    if not hasattr(ctx.target, field):
        raise ValueError(f"Field {field} is not available for this scope")

    value = action.get("value")
    if value == EMPTY_VALUE:
        value = None

    value = _validate_change_field_value(ctx, field, value)

    setattr(ctx.target, field, value)

    update_fields = [field]
    if hasattr(ctx.target, "updated_at"):
        update_fields.append("updated_at")

    ctx.target.save(update_fields=update_fields)

    case = _get_case_for_action(ctx)
    if case:
        _create_timeline(case, f"Automation updated {field}", "automation_action")

    return {"field": field, "value": value}


def _target_items(ctx: AutomationContext, action: dict) -> list[dict]:
    selected_items = action.get("_selected_items")

    if isinstance(selected_items, list):
        return [
            item
            for item in selected_items
            if isinstance(item, dict)
        ]
    
    source = action.get("target_source") or "all_assets"
    target_value = _normalize(action.get("target_value"))

    iocs = list(getattr(ctx.target, "iocs", None) or [])
    assets = list(getattr(ctx.target, "assets", None) or [])

    if source == "trigger_asset":
        item = (ctx.data or {}).get("added_asset")
        return [_normalize_target_item(item, "asset")] if item else []

    if source == "trigger_ioc":
        item = (ctx.data or {}).get("added_ioc")
        return [_normalize_target_item(item, "ioc")] if item else []

    if source == "first_asset":
        return [_normalize_target_item(assets[0], "asset")] if assets else []

    if source == "first_ioc":
        return [_normalize_target_item(iocs[0], "ioc")] if iocs else []

    if source == "all_assets":
        return [_normalize_target_item(item, "asset") for item in assets]

    if source == "all_iocs":
        return [_normalize_target_item(item, "ioc") for item in iocs]

    if source == "all_iocs_and_assets":
        return [
            *[_normalize_target_item(item, "ioc") for item in iocs],
            *[_normalize_target_item(item, "asset") for item in assets],
        ]

    if source == "specific_asset":
        return [
            _normalize_target_item(item, "asset")
            for item in assets
            if _normalize(_extract_item_value(item)) == target_value
        ]

    if source == "specific_ioc":
        return [
            _normalize_target_item(item, "ioc")
            for item in iocs
            if _normalize(_extract_item_value(item)) == target_value
        ]

    if source == "description":
        description = _target_description(ctx.target)
        return [{
            "kind": "description",
            "type": "description",
            "value": description,
            "status": "",
            "raw": {},
        }] if description else []

    if source == "manual":
        return [{
            "kind": "manual",
            "type": action.get("target_type") or "",
            "value": action.get("target_value") or "",
            "status": "",
            "raw": {},
        }]

    return []


def _manual_soar_context_variables(action: dict) -> dict:
    object_id = str(action.get("soar_object_id") or "").strip()
    object_id_type = str(action.get("soar_object_id_type") or "container_id").strip()

    if not object_id:
        return {}

    if object_id_type == "incident_id":
        return {
            "incident_id": object_id,
        }

    return {
        "container_id": object_id,
    }


def _items_values(items: list[dict]) -> list[str]:
    return [
        str(item.get("value") or "")
        for item in items
        if str(item.get("value") or "").strip()
    ]


def _items_payload(items: list[dict]) -> list[dict]:
    return [
        {
            "kind": item.get("kind") or "",
            "type": item.get("type") or "",
            "value": item.get("value") or "",
            "status": item.get("status") or "",
        }
        for item in items
        if item.get("value") not in (None, "")
    ]


def _source_collection_variables(ctx: AutomationContext) -> dict:
    ioc_items = [
        _normalize_target_item(item, "ioc")
        for item in list(getattr(ctx.target, "iocs", None) or [])
    ]
    asset_items = [
        _normalize_target_item(item, "asset")
        for item in list(getattr(ctx.target, "assets", None) or [])
    ]

    return {
        "iocs": _items_payload(ioc_items),
        "ioc_values": _items_values(ioc_items),
        "assets": _items_payload(asset_items),
        "asset_values": _items_values(asset_items),
    }


def _investigation_variables_for_item(
    *,
    ctx: AutomationContext,
    action: dict,
    item: dict,
    index: int,
) -> dict:
    context_ids = _target_context_ids(ctx, item)

    target_kind = item.get("kind") or ""
    target_value = item.get("value") or ""
    target_type = item.get("type") or ""
    target_status = item.get("status") or ""

    extra = {
        "target.kind": target_kind,
        "target.value": target_value,
        "target.type": target_type,
        "target.status": target_status,
        "target.index": index,

        "observable.kind": target_kind,
        "observable.value": target_value,
        "observable.type": target_type,
        "observable.status": target_status,

        "target_kind": target_kind,
        "target_value": target_value,
        "target_type": target_type,
        "target_status": target_status,
        "target_index": index,

        "observable_kind": target_kind,
        "observable_value": target_value,
        "observable_type": target_type,
        "observable_status": target_status,

        "doko_output": target_value,

        "target_object_id": context_ids["container_id"] or context_ids["incident_id"],
        "container_id": context_ids["container_id"],
        "incident_id": context_ids["incident_id"],
    }

    rendered = _render_mapping(action.get("variables") or {}, ctx, extra=extra)
    manual_soar_context = _manual_soar_context_variables(action)

    variables = {
        **_runtime_variables(ctx, extra=extra),
        **manual_soar_context,
        **(rendered if isinstance(rendered, dict) else {}),
    }

    return {
        key: value
        for key, value in variables.items()
        if value not in (None, "", [], {})
    }


def _investigation_variables_for_items(
    *,
    ctx: AutomationContext,
    action: dict,
    items: list[dict],
) -> dict:
    first_item = items[0] if items else {}
    context_ids = _target_context_ids(ctx, first_item)

    for item in items:
        item_context_ids = _target_context_ids(ctx, item)
        if item_context_ids.get("container_id") or item_context_ids.get("incident_id"):
            context_ids = item_context_ids
            break

    selected_items = _items_payload(items)
    selected_values = _items_values(items)

    first_kind = str(first_item.get("kind") or "")
    first_type = str(first_item.get("type") or "")
    first_status = str(first_item.get("status") or "")
    first_value = str(first_item.get("value") or "")

    doko_output = selected_values[0] if len(selected_values) == 1 else selected_values

    extra = {
        "target.kind": first_kind,
        "target.value": first_value,
        "target.type": first_type,
        "target.status": first_status,
        "target.index": 0,

        "observable.kind": first_kind,
        "observable.value": first_value,
        "observable.type": first_type,
        "observable.status": first_status,

        "target_kind": first_kind,
        "target_value": first_value,
        "target_type": first_type,
        "target_status": first_status,
        "target_index": 0,

        "observable_kind": first_kind,
        "observable_value": first_value,
        "observable_type": first_type,
        "observable_status": first_status,

        "target_items": selected_items,
        "target_values": selected_values,
        "observable_items": selected_items,
        "observable_values": selected_values,
        "doko_output": doko_output,
        "doko_outputs": selected_values,

        "target_object_id": context_ids["container_id"] or context_ids["incident_id"],
        "container_id": context_ids["container_id"],
        "incident_id": context_ids["incident_id"],
    }

    rendered = _render_mapping(action.get("variables") or {}, ctx, extra=extra)
    manual_soar_context = _manual_soar_context_variables(action)

    variables = {
        **_runtime_variables(ctx, extra=extra),
        **manual_soar_context,
        **(rendered if isinstance(rendered, dict) else {}),
    }

    return {
        key: value
        for key, value in variables.items()
        if value not in (None, "", [], {})
    }


def _normalize_target_item(item: Any, kind: str) -> dict:
    return {
        "kind": kind,
        "type": _extract_item_type(item),
        "value": _extract_item_value(item),
        "status": _extract_item_status(item),
        "context_id": _extract_item_context_id(item),
        "raw": item if isinstance(item, dict) else {"value": item},
    }


ITEM_DEDUPE_TARGET_SOURCES = {
    "all_iocs",
    "all_assets",
    "all_iocs_and_assets",
    "specific_ioc",
    "specific_asset",
    "trigger_ioc",
    "trigger_asset",
    "first_ioc",
    "first_asset",
}


def _automation_item_key(item: Any, fallback_kind: str = "") -> str:
    normalized = _normalize_target_item(item, fallback_kind)

    kind = _normalize(normalized.get("kind") or fallback_kind)
    item_type = _normalize(normalized.get("type"))
    value = _normalize(normalized.get("value"))

    if not value:
        return ""

    return f"{kind}:{item_type}:{value}"


def _trigger_item_key(ctx: AutomationContext) -> str:
    data = ctx.data or {}

    if data.get("added_ioc") is not None:
        return _automation_item_key(data.get("added_ioc"), "ioc")

    if data.get("added_asset") is not None:
        return _automation_item_key(data.get("added_asset"), "asset")

    return ""


def _already_processed_trigger_item(rule: AutomationRule, ctx: AutomationContext) -> bool:
    key = _trigger_item_key(ctx)

    if not key:
        return False

    return AutomationExecutionLog.objects.filter(
        rule=rule,
        scope=ctx.scope,
        target_id=ctx.target_id,
        matched=True,
        context__trigger_item_key=key,
        status__in=PROCESSED_AUTOMATION_STATUSES,
    ).exists()


def _automation_action_key(action: dict) -> str:
    return json.dumps(
        {
            "index": action.get("_automation_action_index"),
            "type": action.get("type") or "",
            "template_id": str(action.get("template_id") or ""),
            "target_source": action.get("target_source") or "",
            "target_value": _normalize(action.get("target_value")),
        },
        sort_keys=True,
        ensure_ascii=False,
    )


def _processed_action_item_keys(ctx: AutomationContext, action: dict) -> set[str]:
    if not ctx.rule:
        return set()

    action_key = _automation_action_key(action)
    keys = set()

    logs = (
        AutomationExecutionLog.objects
        .filter(
            rule=ctx.rule,
            scope=ctx.scope,
            target_id=ctx.target_id,
            matched=True,
            status__in=PROCESSED_AUTOMATION_STATUSES,
        )
        .only("actions_results")
    )

    for log in logs:
        for item in list(log.actions_results or []):
            if not isinstance(item, dict):
                continue

            result = item.get("result") or {}

            if not isinstance(result, dict):
                continue

            if result.get("automation_action_key") != action_key:
                continue

            for key in result.get("processed_item_keys") or []:
                value = str(key or "").strip()

                if value:
                    keys.add(value)

    return keys


def _filter_unprocessed_items(
    ctx: AutomationContext,
    action: dict,
    items: list[dict],
) -> tuple[list[dict], list[str], list[str]]:
    target_source = str(action.get("target_source") or "").strip()

    if target_source not in ITEM_DEDUPE_TARGET_SOURCES:
        return items, [], []

    previous_keys = _processed_action_item_keys(ctx, action)

    pending = []
    processed_keys = []
    skipped_keys = []

    for item in items:
        key = _automation_item_key(item, item.get("kind") or "")

        if not key:
            continue

        if key in previous_keys:
            skipped_keys.append(key)
            continue

        pending.append(item)
        processed_keys.append(key)

    return pending, processed_keys, skipped_keys


def _prepare_investigation_items(
    ctx: AutomationContext,
    action: dict,
) -> tuple[list[dict], list[str], list[str]]:
    items = _target_items(ctx, action)
    items, processed_item_keys, skipped_item_keys = _filter_unprocessed_items(
        ctx,
        action,
        items,
    )

    action["_automation_action_key"] = _automation_action_key(action)
    action["_processed_item_keys"] = processed_item_keys
    action["_skipped_item_keys"] = skipped_item_keys
    action["_selected_items"] = items

    return items, processed_item_keys, skipped_item_keys


def _apply_workbook_template(ctx: AutomationContext, action: dict) -> dict:
    case = _get_case_for_action(ctx)

    if not case:
        raise ValueError("Workbook actions require a case")

    template_id = action.get("workbook_template_id")
    template = WorkbookTemplate.objects.filter(
        id=template_id,
        is_active=True,
    ).first()

    if not template:
        raise ValueError("Unknown or inactive workbook template")

    instance, _ = WorkbookInstance.objects.get_or_create(
        event=case,
        defaults={"template": template},
    )

    instance.template = template
    instance.save(update_fields=["template"])

    WorkbookInstanceItem.objects.filter(instance=instance).delete()

    items = template.items.all().order_by("order", "id")
    WorkbookInstanceItem.objects.bulk_create([
        WorkbookInstanceItem(
            instance=instance,
            label=item.label,
            order=item.order,
            is_done=False,
        )
        for item in items
    ])

    _create_timeline(
        case,
        f"Automation applied workbook: {template.name}",
        "workbook_applied_on_case",
    )

    return {
        "workbook_template_id": str(template.id),
        "workbook_template_name": template.name,
    }


def _schema_properties_and_required(schema: dict | None) -> tuple[dict, set[str]]:
    if not isinstance(schema, dict):
        return {}, set()

    if isinstance(schema.get("properties"), dict):
        properties = schema.get("properties") or {}
        required = {
            str(item)
            for item in (schema.get("required") or [])
            if str(item or "").strip()
        }
        return properties, required

    properties = {}
    required = set()

    for key, value in schema.items():
        if isinstance(value, dict):
            key = str(key)
            properties[key] = value

            if value.get("required") is True:
                required.add(key)

    return properties, required


def _input_mapping_variable_keys(value) -> set[str]:
    keys = set()

    if isinstance(value, dict):
        from_variable = value.get("from_variable")
        if from_variable:
            keys.add(str(from_variable))

        for item in value.values():
            keys.update(_input_mapping_variable_keys(item))

    elif isinstance(value, list):
        for item in value:
            keys.update(_input_mapping_variable_keys(item))

    return keys


def _automation_target_value(variables: dict) -> str:
    for key in (
        "observable_value",
        "target_value",
        "target.value",
        "ioc.value",
        "asset.value",
    ):
        value = variables.get(key)
        if value not in (None, "", [], {}):
            return str(value)

    return ""


def _template_target_variable_candidates(
    *,
    template: InvestigationTemplate,
    variables: dict,
) -> list[str]:
    properties, required = _schema_properties_and_required(
        template.allowed_variables_schema or {}
    )

    if not properties:
        return []

    excluded = {
        "scope",
        "event",
        "container_id",
        "incident_id",
        "target_object_id",
        "case_id",
        "object_id",
        "playbook_id",
        "remote_template_code",
        "observable_value",
        "observable_type",
        "target_value",
        "target_type",
        "target_kind",
        "target_status",
        "target_index",
        "observable_kind",
        "observable_status",
    }

    candidates = [
        key
        for key in required
        if key in properties
        and key not in excluded
        and variables.get(key) in (None, "", [], {})
    ]

    if candidates:
        return candidates

    preferred = [
        "user_input",
        "input",
        "query",
        "value",
        "target",
        "observable",
        "indicator",
        "artifact",
    ]

    for key in preferred:
        if key in properties and key not in excluded and variables.get(key) in (None, "", [], {}):
            return [key]

    non_context_keys = [
        key
        for key in properties.keys()
        if key not in excluded and variables.get(key) in (None, "", [], {})
    ]

    if len(non_context_keys) == 1:
        return non_context_keys

    return []


def _variables_for_template(template: InvestigationTemplate, variables: dict) -> dict:
    template_defaults = template.default_variables or {}
    if not isinstance(template_defaults, dict):
        template_defaults = {}

    variables = {
        **template_defaults,
        **(variables or {}),
    }

    target_value = _automation_target_value(variables)

    if target_value:
        for key in _template_target_variable_candidates(
            template=template,
            variables=variables,
        ):
            variables.setdefault(key, target_value)

    properties, _ = _schema_properties_and_required(
        template.allowed_variables_schema or {}
    )
    allowed_keys = set(properties.keys())

    mapping_keys = _input_mapping_variable_keys(template.input_mapping or {})

    keep_keys = allowed_keys | mapping_keys

    if not keep_keys:
        return {
            key: value
            for key, value in variables.items()
            if value not in (None, "", [], {})
        }

    return {
        key: value
        for key, value in variables.items()
        if key in keep_keys and value not in (None, "", [], {})
    }


def _normalize_remote_status_name(value: str) -> str:
    return str(value or "").strip().lower()


def _resolve_automation_action_state(template: InvestigationTemplate, remote_status: str) -> str:
    template_status_mapping = template.status_mapping or {}
    provider_status_config = template.soar_provider.status_config or {}

    success_statuses = {
        _normalize_remote_status_name(v)
        for v in (
            template_status_mapping.get("completed")
            or provider_status_config.get("success_statuses")
            or ["completed", "success", "done", "finished"]
        )
    }

    failed_statuses = {
        _normalize_remote_status_name(v)
        for v in (
            template_status_mapping.get("failed")
            or provider_status_config.get("failed_statuses")
            or ["failed", "error", "cancelled", "canceled"]
        )
    }

    running_statuses = {
        _normalize_remote_status_name(v)
        for v in (
            template_status_mapping.get("running")
            or provider_status_config.get("running_statuses")
            or ["queued", "pending", "running", "processing"]
        )
    }

    normalized = _normalize_remote_status_name(remote_status)

    if normalized in failed_statuses:
        return "failed"

    if normalized in success_statuses:
        return "completed"

    if normalized in running_statuses:
        return "running"

    return "running" if normalized else "completed"


def _automation_polling_settings(template: InvestigationTemplate, action: dict) -> tuple[int, int]:
    execution_config = template.execution_config or {}

    max_wait_seconds = action.get("max_wait_seconds")
    poll_interval_seconds = action.get("poll_interval_seconds")

    if max_wait_seconds in (None, "") and isinstance(execution_config, dict):
        max_wait_seconds = (
            execution_config.get("timeout_seconds")
            or execution_config.get("max_wait_seconds")
        )

    if poll_interval_seconds in (None, "") and isinstance(execution_config, dict):
        poll_interval_seconds = execution_config.get("poll_interval_seconds")

    try:
        max_wait = int(max_wait_seconds)
    except Exception:
        max_wait = 300

    try:
        poll_interval = int(poll_interval_seconds)
    except Exception:
        poll_interval = 3

    max_wait = min(max(max_wait, 0), 600)
    poll_interval = min(max(poll_interval, 1), 60)

    return max_wait, poll_interval


def _extract_statuses_from_value(value) -> list[str]:
    value = _parse_json_like(value)
    statuses = []

    if isinstance(value, dict):
        for key in ("status", "state"):
            raw = value.get(key)
            if raw not in (None, "", [], {}):
                statuses.append(_normalize_remote_status_name(raw))

        for key in ("message", "body", "data", "result", "results", "output", "outputs", "raw"):
            nested = value.get(key)
            if nested not in (None, "", [], {}):
                statuses.extend(_extract_statuses_from_value(nested))

    elif isinstance(value, list):
        for item in value:
            statuses.extend(_extract_statuses_from_value(item))

    return [
        status
        for status in statuses
        if status
    ]


def _automation_result_state(
    *,
    template: InvestigationTemplate,
    provider_execution: dict,
    result: dict,
) -> str:
    statuses = []

    if isinstance(provider_execution, dict):
        statuses.extend(_extract_statuses_from_value({
            "status": provider_execution.get("status"),
            "poll_response": provider_execution.get("poll_response"),
        }))

    statuses.extend(_extract_statuses_from_value(result))

    if not statuses:
        return "completed"

    resolved_states = [
        _resolve_automation_action_state(template, status)
        for status in statuses
    ]

    if "running" in resolved_states:
        return "running"

    if "failed" in resolved_states:
        return "failed"

    return "completed"


def _run_and_collect_automation_investigation(
    *,
    service: SOARService,
    template: InvestigationTemplate,
    action: dict,
    variables: dict,
    prompt: str,
) -> tuple[dict, dict]:
    provider_execution = service.launch_execution(
        run=None,
        template=template,
        variables=variables,
        prompt=prompt,
    ) or {}

    should_wait = bool(action.get("post_result_comment"))
    external_run_id = str(provider_execution.get("external_run_id") or "").strip()

    if not should_wait or not external_run_id:
        result = service.collect_result(
            template=template,
            provider_execution=provider_execution,
        ) or {}
        return provider_execution, result

    max_wait, poll_interval = _automation_polling_settings(template, action)

    if max_wait <= 0:
        max_wait = 240

    deadline = time.monotonic() + max_wait
    current = provider_execution

    while True:
        poll_result = service.poll_execution(
            template=template,
            provider_execution=current,
        ) or {}

        current = {
            **current,
            **poll_result,
        }

        remote_status = str(poll_result.get("status") or current.get("status") or "")
        state = _resolve_automation_action_state(template, remote_status)

        if state == "completed":
            result = service.collect_result(
                template=template,
                provider_execution=current,
            ) or {}
            return current, result

        if state == "failed":
            result = service.collect_result(
                template=template,
                provider_execution=current,
            ) or {}
            return current, result

        if time.monotonic() >= deadline:
            raise TimeoutError(
                f"Investigation template did not complete before timeout. Remote status: {remote_status or 'unknown'}"
            )

        time.sleep(poll_interval)


def _parse_json_like(value):
    if not isinstance(value, str):
        return value

    text = value.strip()

    if not text:
        return ""

    if not (
        (text.startswith("{") and text.endswith("}"))
        or (text.startswith("[") and text.endswith("]"))
    ):
        return value

    try:
        return json.loads(text)
    except Exception:
        return value


def _is_meaningful_result(value) -> bool:
    return value not in (None, "", [], {})


def _clean_investigation_result_value(value):
    value = _parse_json_like(value)

    if isinstance(value, list):
        cleaned = [
            _clean_investigation_result_value(item)
            for item in value
        ]
        cleaned = [
            item
            for item in cleaned
            if _is_meaningful_result(item)
        ]

        if len(cleaned) == 1:
            return cleaned[0]

        return cleaned

    if isinstance(value, dict):
        preferred_keys = [
            "doko_results",
            "result",
            "results",
            "output",
            "outputs",
            "data",
            "body",
            "message",
        ]

        for key in preferred_keys:
            if key in value and _is_meaningful_result(value.get(key)):
                return _clean_investigation_result_value(value.get(key))

        if len(value) == 1:
            return _clean_investigation_result_value(next(iter(value.values())))

        return value

    return value


def _clean_investigation_comment_result(result):
    if not isinstance(result, dict):
        return _clean_investigation_result_value(result)

    for key in [
        "outputs",
        "output",
        "results",
        "result",
        "data",
        "body",
        "message",
    ]:
        if key in result and _is_meaningful_result(result.get(key)):
            return _clean_investigation_result_value(result.get(key))

    raw = result.get("raw")

    if isinstance(raw, dict):
        for key in [
            "outputs",
            "output",
            "results",
            "result",
            "data",
            "body",
            "message",
        ]:
            if key in raw and _is_meaningful_result(raw.get(key)):
                return _clean_investigation_result_value(raw.get(key))

    return _clean_investigation_result_value(result)


def _build_automation_investigation_ai_comment(
    *,
    ctx: AutomationContext,
    template: InvestigationTemplate,
    variables: dict,
    result_payload,
    provider_execution: dict,
) -> str:
    provider = AIProvider.objects.filter(is_enabled=True, is_default=True).first()

    if not provider:
        raise ValueError("No enabled default AI provider configured")

    service = LLMService(provider)
    target = ctx.target

    payload = {
        "task": "automation_investigation_result_comment",
        "automation": {
            "scope": ctx.scope,
            "event": ctx.event,
        },
        "target": {
            "id": ctx.target_id,
            "title": getattr(target, "title", "") or "",
            "status": getattr(target, "status", "") or "",
            "severity": getattr(target, "severity", "") or "",
        },
        "template": {
            "name": template.name,
            "code": template.code,
        },
        "remote_execution": {
            "run_id": provider_execution.get("external_run_id") or "",
            "status": provider_execution.get("status") or "",
        },
        "input_payload": to_json_safe(variables or {}),
        "output_payload": to_json_safe(result_payload),
    }

    answer = service.generate(
        system_prompt=_build_system_prompt(provider, template),
        user_prompt=json.dumps(payload, ensure_ascii=False),
    )

    return sanitize_html(answer)



def _run_investigation_template(ctx: AutomationContext, action: dict) -> dict:
    template_id = action.get("template_id")

    template = (
        InvestigationTemplate.objects
        .filter(
            id=template_id,
            is_enabled=True,
            soar_provider__is_enabled=True,
        )
        .select_related("soar_provider")
        .first()
    )

    if not template:
        raise ValueError("Unknown or inactive investigation template")

    items, processed_item_keys, skipped_item_keys = _prepare_investigation_items(
        ctx,
        action,
    )

    if not items:
        return {
            "template_id": str(template.id),
            "template_code": template.code,
            "target_source": action.get("target_source") or "all_assets",
            "automation_action_key": _automation_action_key(action),
            "processed_item_keys": [],
            "skipped_item_keys": skipped_item_keys,
            "runs": [],
            "skipped": "no_target_item_or_already_processed",
        }

    service = SOARService(template.soar_provider)
    variables = _variables_for_template(
        template,
        _investigation_variables_for_items(
            ctx=ctx,
            action=action,
            items=items,
        ),
    )

    prompt = _render_template_string(
        action.get("prompt") or template.chat_command or template.name,
        variables,
    )

    provider_execution, result = _run_and_collect_automation_investigation(
        service=service,
        template=template,
        action=action,
        variables=variables,
        prompt=prompt,
    )

    runs = [
        {
            "targets": to_json_safe(items),
            "variables": to_json_safe(variables),
            "provider_execution": to_json_safe(provider_execution),
            "result": to_json_safe(result),
        }
    ]

    response = {
        "template_id": str(template.id),
        "template_code": template.code,
        "target_source": action.get("target_source") or "all_assets",
        "automation_action_key": _automation_action_key(action),
        "processed_item_keys": processed_item_keys,
        "skipped_item_keys": skipped_item_keys,
        "runs": runs,
    }

    if action.get("post_result_comment"):
        case = _get_case_for_action(ctx)

        if case:
            cleaned_results = [
                _clean_investigation_comment_result(run.get("result"))
                for run in runs
            ]

            comment_result = cleaned_results[0] if len(cleaned_results) == 1 else cleaned_results
            comment_mode = str(action.get("post_result_comment_mode") or "raw").strip()

            if comment_mode == "chatbot":
                text = _build_automation_investigation_ai_comment(
                    ctx=ctx,
                    template=template,
                    variables=variables,
                    result_payload=comment_result,
                    provider_execution=provider_execution,
                )
                author_label = "Catbot"
            else:
                result_json = escape(
                    json.dumps(
                        to_json_safe(comment_result),
                        ensure_ascii=False,
                        indent=2,
                    )
                )

                template_name = escape(str(template.name or ""))

                text = sanitize_html(
                    "<p><strong>Automation investigation result</strong></p>"
                    f"<p>Template: <code>{template_name}</code></p>"
                    f"<p>Runs: <code>{len(runs)}</code></p>"
                    f"<pre>{result_json}</pre>"
                )
                author_label = SYSTEM_AUTHOR_LABEL

            Comment.objects.create(
                event=case,
                author=None,
                author_label=author_label,
                text=text,
            )

            _create_timeline(
                case,
                "Automation investigation result posted",
                "comment_added",
            )

    return response


def _queue_investigation_template_action(ctx: AutomationContext, action: dict) -> dict:
    from django.db import transaction
    from .celerytasks import run_automation_investigation_template_action_task

    items, processed_item_keys, skipped_item_keys = _prepare_investigation_items(
        ctx,
        action,
    )

    if not items:
        return {
            "queued": False,
            "template_id": str(action.get("template_id") or ""),
            "post_result_comment": bool(action.get("post_result_comment")),
            "post_result_comment_mode": str(action.get("post_result_comment_mode") or "raw"),
            "automation_action_key": _automation_action_key(action),
            "processed_item_keys": [],
            "skipped_item_keys": skipped_item_keys,
            "skipped": "no_target_item_or_already_processed",
        }

    actor_id = None

    if getattr(ctx.actor, "id", None):
        actor_id = str(ctx.actor.id)

    payload = {
        "scope": ctx.scope,
        "target_id": ctx.target_id,
        "event": ctx.event,
        "action": to_json_safe(action if isinstance(action, dict) else {}),
        "actor_id": actor_id,
        "data": to_json_safe(ctx.data or {}),
    }

    transaction.on_commit(
        lambda: run_automation_investigation_template_action_task.delay(**payload)
    )

    return {
        "queued": True,
        "template_id": str(action.get("template_id") or ""),
        "post_result_comment": bool(action.get("post_result_comment")),
        "post_result_comment_mode": str(action.get("post_result_comment_mode") or "raw"),
        "automation_action_key": _automation_action_key(action),
        "processed_item_keys": processed_item_keys,
        "skipped_item_keys": skipped_item_keys,
    }


def execute_action(ctx: AutomationContext, action: dict) -> dict:
    action_type = action.get("type")

    if action_type not in ACTION_TYPES:
        raise ValueError("Unsupported automation action")

    if action_type == "add_comment":
        return _add_comment(ctx, action)

    if action_type in {
        "exchange_message",
        "exchange_reply_last_inbound",
        "exchange_reply_all_inbound",
    }:
        return _exchange_action(ctx, action)

    if action_type.startswith("change_"):
        return _change_field(ctx, action)

    if action_type == "apply_workbook_template":
        return _apply_workbook_template(ctx, action)

    if action_type == "run_investigation_template":
        if action.get("post_result_comment"):
            return _queue_investigation_template_action(ctx, action)

        return _run_investigation_template(ctx, action)

    raise ValueError("Unsupported automation action")


def _within_cooldown(rule: AutomationRule, ctx: AutomationContext) -> bool:
    cooldown = int(rule.cooldown_seconds or 0)

    if cooldown <= 0:
        return False

    cutoff = timezone.now() - timezone.timedelta(seconds=cooldown)

    return AutomationExecutionLog.objects.filter(
        rule=rule,
        scope=ctx.scope,
        target_id=ctx.target_id,
        started_at__gte=cutoff,
    ).exists()


def _already_running(rule: AutomationRule, ctx: AutomationContext) -> bool:
    return AutomationExecutionLog.objects.filter(
        rule=rule,
        scope=ctx.scope,
        target_id=ctx.target_id,
        matched=True,
        status=AutomationExecutionLog.Status.RUNNING,
    ).exists()


def _already_ran(rule: AutomationRule, ctx: AutomationContext) -> bool:
    if not rule.run_once_per_target:
        return False

    return AutomationExecutionLog.objects.filter(
        rule=rule,
        scope=ctx.scope,
        target_id=ctx.target_id,
        matched=True,
        status__in=PROCESSED_AUTOMATION_STATUSES,
    ).exists()


def run_automation_rules_for_event(
    *,
    scope: str,
    target,
    event: str,
    actor=None,
    data: dict | None = None,
    rule_ids: list | None = None,
) -> list[AutomationExecutionLog]:
    ctx = AutomationContext(
        scope=scope,
        target=target,
        event=event,
        actor=actor,
        data=data or {},
    )

    if not target or not ctx.target_id:
        return []

    rules = AutomationRule.objects.filter(
        is_enabled=True,
        scope=scope,
    )

    if rule_ids is not None:
        rules = rules.filter(id__in=rule_ids)

    rules = rules.order_by("name", "created_at")

    logs = []

    for rule in rules:
        ctx.rule = rule

        if (
            _already_running(rule, ctx)
            or _already_ran(rule, ctx)
            or _within_cooldown(rule, ctx)
            or _already_processed_trigger_item(rule, ctx)
        ):
            continue

        try:
            matched = evaluate_rule_conditions(rule, ctx)
        except Exception as exc:
            log = AutomationExecutionLog.objects.create(
                rule=rule,
                scope=scope,
                target_id=ctx.target_id,
                trigger=event,
                matched=False,
                status=AutomationExecutionLog.Status.FAILED,
                error=str(exc)[:2000],
                context={
                    "event": event,
                    "target": _target_payload(target),
                    "data": to_json_safe(data or {}),
                    "trigger_item_key": _trigger_item_key(ctx),
                },
                completed_at=timezone.now(),
            )
            logs.append(log)
            continue

        if not matched:
            continue

        with transaction.atomic():
            rule = AutomationRule.objects.select_for_update().get(pk=rule.pk)
            ctx.rule = rule

            if (
                not rule.is_enabled
                or rule.scope != scope
                or _already_running(rule, ctx)
                or _already_ran(rule, ctx)
                or _within_cooldown(rule, ctx)
                or _already_processed_trigger_item(rule, ctx)
            ):
                continue

            try:
                matched = evaluate_rule_conditions(rule, ctx)
            except Exception as exc:
                log = AutomationExecutionLog.objects.create(
                    rule=rule,
                    scope=scope,
                    target_id=ctx.target_id,
                    trigger=event,
                    matched=False,
                    status=AutomationExecutionLog.Status.FAILED,
                    error=str(exc)[:2000],
                    context={
                        "event": event,
                        "target": _target_payload(target),
                        "data": to_json_safe(data or {}),
                        "trigger_item_key": _trigger_item_key(ctx),
                    },
                    completed_at=timezone.now(),
                )
                logs.append(log)
                continue

            if not matched:
                continue

            log = AutomationExecutionLog.objects.create(
                rule=rule,
                scope=scope,
                target_id=ctx.target_id,
                trigger=event,
                matched=True,
                status=AutomationExecutionLog.Status.RUNNING,
                context={
                    "event": event,
                    "target": _target_payload(target),
                    "data": to_json_safe(data or {}),
                    "trigger_item_key": _trigger_item_key(ctx),
                },
            )

        action_results = []
        final_status = AutomationExecutionLog.Status.SUCCESS
        error = ""

        for index, action in enumerate(rule.actions or []):
            try:
                action_payload = dict(action) if isinstance(action, dict) else {}
                action_payload["_automation_action_index"] = index
                result = execute_action(ctx, action_payload)
                action_results.append({
                    "index": index,
                    "status": "success",
                    "result": to_json_safe(result),
                })
            except Exception as exc:
                final_status = (
                    AutomationExecutionLog.Status.PARTIAL_SUCCESS
                    if action_results
                    else AutomationExecutionLog.Status.FAILED
                )
                error = str(exc)[:2000]
                action_results.append({
                    "index": index,
                    "status": "failed",
                    "error": error,
                })

                if rule.stop_on_first_action_error:
                    break

        log.status = final_status
        log.error = error
        log.actions_results = action_results
        log.completed_at = timezone.now()
        log.save(update_fields=[
            "status",
            "error",
            "actions_results",
            "completed_at",
        ])

        logs.append(log)

    return logs


def run_scheduled_automation_rules() -> dict:
    now = timezone.localtime()
    scheduled_time = now.strftime("%H:%M")

    counts = {
        "alert": 0,
        "case": 0,
        "hunt": 0,
    }

    scheduled_scopes = (
        AutomationRule.objects
        .filter(
            is_enabled=True,
            conditions__icontains="scheduled_time",
        )
        .values_list("scope", flat=True)
        .distinct()
    )

    for scope in scheduled_scopes:
        scheduled_rule_ids = list(
            AutomationRule.objects
            .filter(
                is_enabled=True,
                scope=scope,
                conditions__icontains="scheduled_time",
            )
            .values_list("id", flat=True)
        )

        if not scheduled_rule_ids:
            continue

        if scope == "case":
            qs = Event.objects.filter(
                is_deleted=False,
                archived_at__isnull=True,
            ).order_by("-updated_at", "-created_at")[:500]
        elif scope == "alert":
            qs = Alert.objects.filter(
                is_deleted=False,
            ).order_by("-updated_at", "-created_at")[:500]
        elif scope == "hunt":
            qs = Hunt.objects.filter(
                is_deleted=False,
                archived_at__isnull=True,
            ).order_by("-updated_at", "-created_at")[:500]
        else:
            continue

        for target in qs:
            logs = run_automation_rules_for_event(
                scope=scope,
                target=target,
                event="scheduled_time",
                actor=None,
                data={"scheduled_time": scheduled_time},
                rule_ids=scheduled_rule_ids,
            )
            counts[scope] += len(logs)

    return counts


def build_added_items_payload(before_iocs, after_iocs, before_assets, after_assets) -> dict:
    return {
        "added_iocs": _added_items(before_iocs or [], after_iocs or []),
        "added_assets": _added_items(before_assets or [], after_assets or []),
    }