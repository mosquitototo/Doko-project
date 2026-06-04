from typing import Any
from html import unescape
import re
from datetime import datetime

from django.db.models import Q

from rest_framework.decorators import api_view, permission_classes, throttle_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from rest_framework.throttling import UserRateThrottle

from .models import (
    Event,
    Alert,
    Comment,
    AlertComment,
    Hunt,
    HuntJournalEntry,
)
from .rbac import get_accessible_customer_ids, user_has_perm


SEARCH_MIN_LEN = 3
SEARCH_MAX_LEN = 200
PER_TYPE_LIMIT = 20


def _sort_date(value: str | None):
    if not value:
        return datetime.min
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return datetime.min
    

def _strip_html(value: str | None) -> str:
    if not value:
        return ""
    text = re.sub(r"<[^>]*>", " ", value)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _normalize_query(raw: str | None) -> str:
    value = (raw or "").strip()
    if len(value) > SEARCH_MAX_LEN:
        value = value[:SEARCH_MAX_LEN]
    return value


def _allowed_customer_ids_for_perm(user, perm_code: str):
    if user.is_staff:
        return None

    accessible = [str(x) for x in (get_accessible_customer_ids(user) or [])]
    if not accessible:
        return []

    allowed = []
    for cid in accessible:
        if user_has_perm(user, perm_code, customer_id=cid):
            allowed.append(cid)
    return allowed


def _allowed_customer_ids_for_any_perm(user, perm_codes: list[str]):
    if user.is_staff:
        return None

    accessible = [str(x) for x in (get_accessible_customer_ids(user) or [])]
    if not accessible:
        return []

    allowed = []
    for cid in accessible:
        if any(user_has_perm(user, perm_code, customer_id=cid) for perm_code in perm_codes):
            allowed.append(cid)
    return allowed


def _apply_customer_scope(qs, allowed_customer_ids):
    if allowed_customer_ids is None:
        return qs
    if not allowed_customer_ids:
        return qs.none()
    return qs.filter(customer_id__in=allowed_customer_ids)


def _snippet(text: str | None, needle: str, max_len: int = 180) -> str:
    raw = _strip_html(text)
    if not raw:
        return ""

    lowered = raw.lower()
    idx = lowered.find(needle.lower())

    if idx == -1:
        return raw[:max_len]

    start = max(0, idx - 60)
    end = min(len(raw), idx + len(needle) + 100)
    out = raw[start:end].strip()

    if start > 0:
        out = "… " + out
    if end < len(raw):
        out = out + " …"
    return out


def _result(
    *,
    result_type: str,
    object_id: str,
    title: str,
    snippet: str,
    url: str,
    customer_name: str = "",
    updated_at=None,
    parent: dict[str, Any] | None = None,
):
    return {
        "type": result_type,
        "id": object_id,
        "title": title,
        "snippet": snippet,
        "url": url,
        "customer_name": customer_name or "",
        "updated_at": updated_at.isoformat() if updated_at else None,
        "parent": parent,
    }

class SearchThrottle(UserRateThrottle):
    rate = "30/min"

@api_view(["GET"])
@permission_classes([IsAuthenticated])
@throttle_classes([SearchThrottle])
def unified_search(request):
    user = request.user
    q = _normalize_query(request.query_params.get("q"))

    if len(q) < SEARCH_MIN_LEN:
        raise ValidationError(f"Search query must contain at least {SEARCH_MIN_LEN} characters.")

    allowed_case_customers = _allowed_customer_ids_for_perm(user, "case.view")
    allowed_alert_customers = _allowed_customer_ids_for_perm(user, "alert.view")
    allowed_hunt_customers = _allowed_customer_ids_for_perm(user, "hunt.view")

    results: list[dict[str, Any]] = []

    case_qs = Event.objects.filter(is_deleted=False)
    alert_qs = Alert.objects.filter(is_deleted=False)
    hunt_qs = Hunt.objects.filter(is_deleted=False)

    case_qs = _apply_customer_scope(case_qs, allowed_case_customers)
    alert_qs = _apply_customer_scope(alert_qs, allowed_alert_customers)
    hunt_qs = _apply_customer_scope(hunt_qs, allowed_hunt_customers)

    cases = (
        case_qs.filter(
            Q(title__icontains=q)
            | Q(description__icontains=q)
        )
        .select_related("customer")
        .order_by("-updated_at")[:PER_TYPE_LIMIT]
    )

    for item in cases:
        results.append(
            _result(
                result_type="case",
                object_id=str(item.id),
                title=item.title,
                snippet=_snippet(item.description, q),
                url=f"/cases/{item.id}",
                customer_name=item.customer.name if item.customer else "",
                updated_at=item.updated_at,
            )
        )

    alerts = (
        alert_qs.filter(
            Q(title__icontains=q)
            | Q(description__icontains=q)
            | Q(iocs__icontains=q)
            | Q(assets__icontains=q)
        )
        .select_related("customer", "case")
        .order_by("-updated_at")[:PER_TYPE_LIMIT]
    )

    for item in alerts:
        results.append(
            _result(
                result_type="alert",
                object_id=str(item.id),
                title=item.title,
                snippet=_snippet(item.description, q),
                url=f"/alerts/{item.id}",
                customer_name=item.customer.name if item.customer else "",
                updated_at=item.updated_at,
                parent=(
                    {"type": "case", "id": str(item.case_id), "url": f"/cases/{item.case_id}"}
                    if item.case_id
                    else None
                ),
            )
        )

    hunts = (
        hunt_qs.filter(
            Q(title__icontains=q)
            | Q(context__icontains=q)
            | Q(conclusion__icontains=q)
            | Q(iocs__icontains=q)
            | Q(assets__icontains=q)
            | Q(journal_entries__text__icontains=q)
            | Q(journal_entries__linked_ioc_value__icontains=q)
            | Q(journal_entries__linked_asset_value__icontains=q)
        )
        .select_related("customer")
        .distinct()
        .order_by("-updated_at")[:PER_TYPE_LIMIT]
    )

    for item in hunts:
        hunt_text = " ".join(
            x for x in [item.context, item.conclusion] if x
        )
        results.append(
            _result(
                result_type="hunt",
                object_id=str(item.id),
                title=item.title,
                snippet=_snippet(hunt_text, q),
                url=f"/hunts/{item.id}",
                customer_name=item.customer.name if item.customer else "",
                updated_at=item.updated_at,
            )
        )

    case_comments = (
        Comment.objects.filter(
            event__is_deleted=False,
            text__icontains=q,
        )
        .select_related("event", "event__customer", "author")
        .order_by("-updated_at")
    )
    if allowed_case_customers is not None:
        case_comments = case_comments.filter(event__customer_id__in=allowed_case_customers)
    case_comments = case_comments[:PER_TYPE_LIMIT]

    for item in case_comments:
        results.append(
            _result(
                result_type="case_comment",
                object_id=str(item.id),
                title=f"Comment on case: {item.event.title}",
                snippet=_snippet(item.text, q),
                url=f"/cases/{item.event_id}",
                customer_name=item.event.customer.name if item.event.customer else "",
                updated_at=item.updated_at,
                parent={"type": "case", "id": str(item.event_id), "url": f"/cases/{item.event_id}"},
            )
        )

    alert_comments = (
        AlertComment.objects.filter(
            alert__is_deleted=False,
            text__icontains=q,
        )
        .select_related("alert", "alert__customer", "author")
        .order_by("-updated_at")
    )
    if allowed_alert_customers is not None:
        alert_comments = alert_comments.filter(alert__customer_id__in=allowed_alert_customers)
    alert_comments = alert_comments[:PER_TYPE_LIMIT]

    for item in alert_comments:
        results.append(
            _result(
                result_type="alert_comment",
                object_id=str(item.id),
                title=f"Comment on alert: {item.alert.title}",
                snippet=_snippet(item.text, q),
                url=f"/alerts/{item.alert_id}",
                customer_name=item.alert.customer.name if item.alert.customer else "",
                updated_at=item.updated_at,
                parent={"type": "alert", "id": str(item.alert_id), "url": f"/alerts/{item.alert_id}"},
            )
        )

    hunt_notes = (
        HuntJournalEntry.objects.filter(
            Q(text__icontains=q)
            | Q(linked_ioc_value__icontains=q)
            | Q(linked_asset_value__icontains=q),
            hunt__is_deleted=False,
        )
        .select_related("hunt", "hunt__customer", "author")
        .order_by("-updated_at")
    )
    if allowed_hunt_customers is not None:
        hunt_notes = hunt_notes.filter(hunt__customer_id__in=allowed_hunt_customers)
    hunt_notes = hunt_notes[:PER_TYPE_LIMIT]

    for item in hunt_notes:
        results.append(
            _result(
                result_type="hunt_journal",
                object_id=str(item.id),
                title=f"Hunt journal: {item.hunt.title}",
                snippet=_snippet(
                    " ".join(
                        x for x in [item.text, item.linked_ioc_value, item.linked_asset_value] if x
                    ),
                    q,
                ),
                url=f"/hunts/{item.hunt_id}",
                customer_name=item.hunt.customer.name if item.hunt.customer else "",
                updated_at=item.updated_at,
                parent={"type": "hunt", "id": str(item.hunt_id), "url": f"/hunts/{item.hunt_id}"},
            )
        )

    ioc_results = (
        case_qs.filter(
            Q(iocs__icontains=q)
        )
        .distinct()
        .select_related("customer")
        .order_by("-updated_at")[:PER_TYPE_LIMIT]
    )

    for item in ioc_results:
        results.append(
            _result(
                result_type="ioc",
                object_id=str(item.id),
                title=f"IoC in case: {item.title}",
                snippet="IoC match found in linked case or alert data.",
                url=f"/cases/{item.id}",
                customer_name=item.customer.name if item.customer else "",
                updated_at=item.updated_at,
                parent={"type": "case", "id": str(item.id), "url": f"/cases/{item.id}"},
            )
        )

    asset_results = (
        case_qs.filter(
            Q(assets__icontains=q)
        )
        .distinct()
        .select_related("customer")
        .order_by("-updated_at")[:PER_TYPE_LIMIT]
    )

    for item in asset_results:
        results.append(
            _result(
                result_type="asset",
                object_id=str(item.id),
                title=f"Asset in case: {item.title}",
                snippet="Asset match found in linked case or alert data.",
                url=f"/cases/{item.id}",
                customer_name=item.customer.name if item.customer else "",
                updated_at=item.updated_at,
                parent={"type": "case", "id": str(item.id), "url": f"/cases/{item.id}"},
            )
        )

    type_order = {
        "case": 0,
        "alert": 1,
        "hunt": 2,
        "case_comment": 3,
        "alert_comment": 4,
        "hunt_journal": 5,
        "ioc": 6,
        "asset": 7,
    }

    results.sort(
        key=lambda x: (
            type_order.get(x["type"], 99),
            -_sort_date(x.get("updated_at")).timestamp(),
        )
    )

    return Response(
        {
            "query": q,
            "count": len(results),
            "results": results[:120],
        }
    )