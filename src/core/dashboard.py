from datetime import timedelta, date, datetime, time

from django.db.models import Count, Min, Q
from django.utils import timezone
from django.db.models.functions import TruncDate
from django.utils.dateparse import parse_date

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.exceptions import PermissionDenied, ValidationError

from .models import Alert, Customer, DashboardPreference, Event, Hunt
from .rbac import get_accessible_customer_ids, user_has_perm


DEFAULT_WIDGETS = [
    "cases_open",
    "alerts_open",
    "hunts_open",
    "cases_closed_period",
    "cases_archived_period",
    "tpwi_cases_period",
    "alert_fp_rate",
    "case_fp_rate",
    "sla_global",
    "cases_created_closed_series",
    "alerts_created_series",
    "cases_by_severity_period",
    "cases_by_classification_period",
    "cases_by_outcome_period",
    "open_cases_by_customer",
    "open_alerts_by_customer",
    "open_hunts_by_customer",
    "cases_created_by_customer_period",
    "alerts_created_by_customer_period",
    "tpwi_cases_by_customer_period",
    "sla_by_customer",
    "my_open_cases",
    "recent_cases",
]

AVAILABLE_WIDGETS = [
    {"id": "cases_open", "label": "Open cases", "kind": "kpi"},
    {"id": "alerts_open", "label": "Open alerts", "kind": "kpi"},
    {"id": "hunts_open", "label": "Open hunts", "kind": "kpi"},
    {"id": "cases_closed_period", "label": "Closed cases", "kind": "kpi"},
    {"id": "alerts_closed_period", "label": "Closed alerts", "kind": "kpi"},
    {"id": "cases_archived_period", "label": "Archived cases", "kind": "kpi"},
    {"id": "tpwi_cases_period", "label": "TP with impact cases", "kind": "kpi"},
    {"id": "alert_fp_rate", "label": "Alert false positive rate", "kind": "kpi"},
    {"id": "case_fp_rate", "label": "Case false positive rate", "kind": "kpi"},
    {"id": "sla_global", "label": "Alert SLA global", "kind": "kpi"},
    {"id": "sla_by_customer", "label": "Alert SLA by customer", "kind": "table"},
    {"id": "cases_created_closed_series", "label": "Cases created vs closed", "kind": "chart"},
    {"id": "alerts_created_series", "label": "Alerts created", "kind": "chart"},
    {"id": "cases_by_severity_period", "label": "Cases by severity", "kind": "chart"},
    {"id": "cases_by_classification_period", "label": "Cases by classification", "kind": "chart"},
    {"id": "cases_by_outcome_period", "label": "Cases by outcome", "kind": "chart"},
    {"id": "open_cases_by_customer", "label": "Open cases by customer", "kind": "chart"},
    {"id": "open_alerts_by_customer", "label": "Open alerts by customer", "kind": "chart"},
    {"id": "open_hunts_by_customer", "label": "Open hunts by customer", "kind": "chart"},
    {"id": "cases_created_by_customer_period", "label": "Cases created by customer", "kind": "chart"},
    {"id": "alerts_created_by_customer_period", "label": "Alerts created by customer", "kind": "chart"},
    {"id": "tpwi_cases_by_customer_period", "label": "TP with impact by customer", "kind": "chart"},
    {"id": "my_open_cases", "label": "My open cases", "kind": "list"},
    {"id": "recent_cases", "label": "Recent cases", "kind": "list"},
]

AVAILABLE_WIDGET_IDS = {x["id"] for x in AVAILABLE_WIDGETS}

FP_ALERT_OUTCOMES = [Alert.Outcome.FP, Alert.Outcome.FPT]
TP_ALERT_OUTCOMES = [Alert.Outcome.TPWI, Alert.Outcome.TPWOI]
QUALIFIED_ALERT_OUTCOMES = [
    Alert.Outcome.TPWI,
    Alert.Outcome.TPWOI,
    Alert.Outcome.FPT,
    Alert.Outcome.FP,
    Alert.Outcome.LEGIT,
]

FP_CASE_OUTCOMES = [Event.Outcome.FP, Event.Outcome.FPT]
TP_CASE_OUTCOMES = [Event.Outcome.TPWI, Event.Outcome.TPWOI]
QUALIFIED_CASE_OUTCOMES = [
    Event.Outcome.TPWI,
    Event.Outcome.TPWOI,
    Event.Outcome.FPT,
    Event.Outcome.FP,
    Event.Outcome.LEGIT,
]


def _labelize(key: str | None) -> str:
    if not key:
        return "—"
    return str(key).replace("_", " ").title()


def _rows_from_qs(qs, key_field: str, label_field: str | None = None):
    rows = []
    for r in qs:
        k = r.get(key_field)
        if label_field:
            lbl = r.get(label_field) or "—"
        else:
            lbl = _labelize(k)
        rows.append(
            {
                "key": str(k) if k is not None else None,
                "label": str(lbl),
                "value": int(r["value"]),
            }
        )
    return rows


def _date_range_days(start_day: date, end_day: date):
    cur = start_day
    out = []
    while cur <= end_day:
        out.append(cur)
        cur = cur + timedelta(days=1)
    return out


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



def _parse_day_or_none(raw: str | None):
    if not raw:
        return None
    d = parse_date(raw)
    if d is None:
        raise ValidationError(f"Invalid date: {raw}")
    return d


def _resolve_period(request, events_qs, alerts_qs, hunts_qs):
    now = timezone.now()
    period = (request.query_params.get("period") or "last_90d").strip()
    date_from_raw = (request.query_params.get("date_from") or "").strip() or None
    date_to_raw = (request.query_params.get("date_to") or "").strip() or None

    start = None
    end = now

    if period == "last_7d":
        start = now - timedelta(days=7)
    elif period == "last_30d":
        start = now - timedelta(days=30)
    elif period == "last_90d":
        start = now - timedelta(days=90)
    elif period == "since":
        day_from = _parse_day_or_none(date_from_raw)
        if day_from is None:
            raise ValidationError("date_from is required when period=since")
        start = timezone.make_aware(datetime.combine(day_from, time.min))
    elif period == "between":
        day_from = _parse_day_or_none(date_from_raw)
        day_to = _parse_day_or_none(date_to_raw)
        if day_from is None or day_to is None:
            raise ValidationError("date_from and date_to are required when period=between")
        if day_from > day_to:
            raise ValidationError("The selected period is invalid: start date must be before end date.")
        start = timezone.make_aware(datetime.combine(day_from, time.min))
        end = timezone.make_aware(datetime.combine(day_to + timedelta(days=1), time.min))
    elif period == "all":
        min_event = events_qs.aggregate(v=Min("created_at"))["v"]
        min_alert = alerts_qs.aggregate(v=Min("created_at"))["v"]
        min_hunt = hunts_qs.aggregate(v=Min("created_at"))["v"]
        candidates = [x for x in [min_event, min_alert, min_hunt] if x is not None]
        start = min(candidates) if candidates else (now - timedelta(days=90))
        min_start = now - timedelta(days=730)
        if start < min_start:
            start = min_start
    else:
        raise ValidationError("Unknown period")

    return {
        "period": period,
        "start": start,
        "end": end,
        "date_from": start.date().isoformat() if start else None,
        "date_to": (end - timedelta(seconds=1)).date().isoformat() if end else None,
    }


def _apply_dt_range(qs, field_name: str, start, end):
    if start is not None:
        qs = qs.filter(**{f"{field_name}__gte": start})
    if end is not None:
        qs = qs.filter(**{f"{field_name}__lt": end})
    return qs


def _compute_sla_rows(closed_alerts):
    rows = []

    for alert in closed_alerts.select_related("customer"):
        customer = getattr(alert, "customer", None)
        created_at = getattr(alert, "created_at", None)
        acknowledged_at = getattr(alert, "sla_acknowledged_at", None)
        updated_at = getattr(alert, "updated_at", None)
        completed_at = acknowledged_at or updated_at

        if not customer or not created_at or not completed_at:
            continue

        delta = customer.get_sla_delta(alert.severity) if hasattr(customer, "get_sla_delta") else None
        rule = customer.get_sla_rule(alert.severity) if hasattr(customer, "get_sla_rule") else None

        if not delta or not rule:
            continue

        sla_hours = round(delta.total_seconds() / 3600.0, 2)
        elapsed_hours = max(
            0.0,
            (completed_at - created_at).total_seconds() / 3600.0,
        )
        within = elapsed_hours <= sla_hours

        rows.append(
            {
                "customer_id": str(customer.id) if customer.id else None,
                "customer_name": customer.name or "—",
                "severity": alert.severity or "",
                "sla_hours": sla_hours,
                "sla_rule": rule,
                "resolution_hours": elapsed_hours,
                "within_sla": within,
            }
        )

    by_customer = {}

    for row in rows:
        bucket_key = f"{row['customer_id'] or 'none'}:{row['severity'] or 'none'}"
        bucket = by_customer.setdefault(
            bucket_key,
            {
                "customer_id": row["customer_id"],
                "customer_name": row["customer_name"],
                "severity": row["severity"],
                "sla_hours": row["sla_hours"],
                "sla_rule": row["sla_rule"],
                "closed_count": 0,
                "within_sla_count": 0,
                "breached_count": 0,
                "avg_resolution_hours": 0.0,
            },
        )

        bucket["closed_count"] += 1
        bucket["within_sla_count"] += 1 if row["within_sla"] else 0
        bucket["breached_count"] += 0 if row["within_sla"] else 1
        bucket["avg_resolution_hours"] += row["resolution_hours"]

    by_customer_rows = []

    for bucket in by_customer.values():
        closed_count = bucket["closed_count"]
        avg_resolution_hours = (
            bucket["avg_resolution_hours"] / closed_count if closed_count > 0 else 0.0
        )
        sla_rate = (
            round((bucket["within_sla_count"] / closed_count) * 100, 1)
            if closed_count > 0
            else None
        )

        by_customer_rows.append(
            {
                **bucket,
                "avg_resolution_hours": round(avg_resolution_hours, 2),
                "sla_rate": sla_rate,
            }
        )

    by_customer_rows.sort(
        key=lambda x: (
            x["customer_name"].lower(),
            x["severity"] or "",
            x["customer_id"] or "",
        )
    )

    total_closed = sum(x["closed_count"] for x in by_customer_rows)
    total_within = sum(x["within_sla_count"] for x in by_customer_rows)
    total_breached = sum(x["breached_count"] for x in by_customer_rows)
    avg_resolution_global = (
        round(
            sum(x["avg_resolution_hours"] * x["closed_count"] for x in by_customer_rows) / total_closed,
            2,
        )
        if total_closed > 0
        else None
    )
    sla_rate_global = round((total_within / total_closed) * 100, 1) if total_closed > 0 else None

    return {
        "global": {
            "configured_customers": len({x["customer_id"] for x in by_customer_rows if x["customer_id"]}),
            "closed_count": total_closed,
            "within_sla_count": total_within,
            "breached_count": total_breached,
            "sla_rate": sla_rate_global,
            "avg_resolution_hours": avg_resolution_global,
        },
        "by_customer": by_customer_rows,
    }


def _series_from_maps(start_day: date, end_day: date, left_map: dict, right_map: dict | None = None):
    rows = []
    for d in _date_range_days(start_day, end_day):
        item = {"date": d.isoformat(), "created": left_map.get(d, 0)}
        if right_map is not None:
            item["closed"] = right_map.get(d, 0)
        rows.append(item)
    return rows


def _get_or_create_dashboard_preference(user):
    pref, _ = DashboardPreference.objects.get_or_create(
        user=user,
        defaults={"widgets": DEFAULT_WIDGETS},
    )
    return pref


def _rate_payload(false_positive_count: int, true_positive_count: int, qualified_total: int):
    denominator = int(qualified_total or 0)
    rate = round((false_positive_count / denominator) * 100, 1) if denominator > 0 else None
    return {
        "false_positive_count": false_positive_count,
        "true_positive_count": true_positive_count,
        "qualified_total": denominator,
        "rate": rate,
    }


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def dashboard(request):
    user = request.user
    customer_id = (request.query_params.get("customer") or "").strip() or None

    allowed_case_customers = _allowed_customer_ids_for_perm(user, "case.view")
    allowed_alert_customers = _allowed_customer_ids_for_perm(user, "alert.view")
    allowed_hunt_customers = _allowed_customer_ids_for_any_perm(user, ["hunt.view"])

    if customer_id and not user.is_staff:
        accessible = set(str(x) for x in (get_accessible_customer_ids(user) or []))
        if customer_id not in accessible:
            raise PermissionDenied("Customer not accessible.")

    events = Event.objects.filter(is_deleted=False)
    alerts = Alert.objects.filter(is_deleted=False)
    hunts = Hunt.objects.filter(is_deleted=False)

    if not user.is_staff:
        events = events.filter(customer_id__in=allowed_case_customers) if allowed_case_customers else events.none()
        alerts = alerts.filter(customer_id__in=allowed_alert_customers) if allowed_alert_customers else alerts.none()
        hunts = hunts.filter(customer_id__in=allowed_hunt_customers) if allowed_hunt_customers else hunts.none()

    if customer_id:
        events = events.filter(customer_id=customer_id)
        alerts = alerts.filter(customer_id=customer_id)
        hunts = hunts.filter(customer_id=customer_id)

    scope = _resolve_period(request, events, alerts, hunts)
    start = scope["start"]
    end = scope["end"]

    open_case_statuses = [Event.Status.OPEN, Event.Status.IN_PROGRESS, Event.Status.RESOLVED]
    open_alert_statuses = [Alert.Status.OPEN, Alert.Status.IN_PROGRESS]
    open_hunt_statuses = [Hunt.Status.TO_DO, Hunt.Status.IN_PROGRESS]

    events_created_period = _apply_dt_range(events, "created_at", start, end)
    alerts_created_period = _apply_dt_range(alerts, "created_at", start, end)

    events_closed_period = _apply_dt_range(
        events.filter(status=Event.Status.CLOSED),
        "updated_at",
        start,
        end,
    )
    alerts_closed_period = _apply_dt_range(
        alerts.filter(status=Alert.Status.CLOSED),
        "updated_at",
        start,
        end,
    )
    events_archived_period = _apply_dt_range(
        events.filter(archived_at__isnull=False),
        "archived_at",
        start,
        end,
    )
    tpwi_cases_period = _apply_dt_range(
        events.filter(outcome=Event.Outcome.TPWI),
        "updated_at",
        start,
        end,
    )

    qualified_alerts_period = alerts_closed_period.filter(
        outcome__in=QUALIFIED_ALERT_OUTCOMES
    )
    alert_fp_count = qualified_alerts_period.filter(outcome__in=FP_ALERT_OUTCOMES).count()
    alert_tp_count = qualified_alerts_period.filter(outcome__in=TP_ALERT_OUTCOMES).count()
    alert_qualified_total = qualified_alerts_period.count()

    qualified_cases_period = events_closed_period.filter(
        outcome__in=QUALIFIED_CASE_OUTCOMES
    )
    case_fp_count = qualified_cases_period.filter(outcome__in=FP_CASE_OUTCOMES).count()
    case_tp_count = qualified_cases_period.filter(outcome__in=TP_CASE_OUTCOMES).count()
    case_qualified_total = qualified_cases_period.count()

    alert_fp_rate = _rate_payload(alert_fp_count, alert_tp_count, alert_qualified_total)
    case_fp_rate = _rate_payload(case_fp_count, case_tp_count, case_qualified_total)

    cases_open = events.filter(status__in=open_case_statuses).count()
    alerts_open = alerts.filter(status__in=open_alert_statuses).count()
    hunts_open = hunts.filter(status__in=open_hunt_statuses).count()

    cases_closed_period = events_closed_period.count()
    alerts_closed_period_count = alerts_closed_period.count()
    cases_archived_period_count = events_archived_period.count()
    tpwi_cases_period_count = tpwi_cases_period.count()

    cases_by_sev_period_qs = (
        events_created_period.values("severity")
        .annotate(value=Count("id"))
        .order_by("-value")
    )

    cases_by_classification_period_qs = (
        events_created_period.values("classification")
        .annotate(value=Count("id"))
        .order_by("-value")
    )

    cases_by_outcome_period_qs = (
        events_created_period.exclude(outcome__isnull=True).exclude(outcome="")
        .values("outcome")
        .annotate(value=Count("id"))
        .order_by("-value")
    )

    open_cases_by_severity_qs = (
        events.filter(status__in=open_case_statuses)
        .values("severity")
        .annotate(value=Count("id"))
        .order_by("-value")
    )

    open_alerts_by_severity_qs = (
        alerts.filter(status__in=open_alert_statuses)
        .values("severity")
        .annotate(value=Count("id"))
        .order_by("-value")
    )

    open_cases_by_customer_qs = (
        events.filter(status__in=open_case_statuses)
        .values("customer_id", "customer__name")
        .annotate(value=Count("id"))
        .order_by("-value")
    )

    open_alerts_by_customer_qs = (
        alerts.filter(status__in=open_alert_statuses)
        .values("customer_id", "customer__name")
        .annotate(value=Count("id"))
        .order_by("-value")
    )

    open_hunts_by_customer_qs = (
        hunts.filter(status__in=open_hunt_statuses)
        .values("customer_id", "customer__name")
        .annotate(value=Count("id"))
        .order_by("-value")
    )

    alerts_created_by_customer_period_qs = (
        alerts_created_period.values("customer_id", "customer__name")
        .annotate(value=Count("id"))
        .order_by("-value")
    )

    cases_created_by_customer_period_qs = (
        events_created_period.values("customer_id", "customer__name")
        .annotate(value=Count("id"))
        .order_by("-value")
    )

    tpwi_cases_by_customer_period_qs = (
        tpwi_cases_period.values("customer_id", "customer__name")
        .annotate(value=Count("id"))
        .order_by("-value")
    )

    created_cases_period_qs = (
        events_created_period.annotate(day=TruncDate("created_at"))
        .values("day")
        .annotate(created=Count("id"))
        .order_by("day")
    )
    created_cases_map = {r["day"]: int(r["created"]) for r in created_cases_period_qs}

    closed_cases_period_qs = (
        events_closed_period.annotate(day=TruncDate("updated_at"))
        .values("day")
        .annotate(closed=Count("id"))
        .order_by("day")
    )
    closed_cases_map = {r["day"]: int(r["closed"]) for r in closed_cases_period_qs}

    alerts_created_period_qs = (
        alerts_created_period.annotate(day=TruncDate("created_at"))
        .values("day")
        .annotate(created=Count("id"))
        .order_by("day")
    )
    alerts_created_map = {r["day"]: int(r["created"]) for r in alerts_created_period_qs}

    start_day = start.date()
    end_day = (end - timedelta(seconds=1)).date()

    cases_created_closed_series = _series_from_maps(start_day, end_day, created_cases_map, closed_cases_map)
    alerts_created_series = _series_from_maps(start_day, end_day, alerts_created_map)

    latest_cases = list(
        events.order_by("-updated_at")
        .values("id", "title", "status", "severity", "updated_at", "customer__name")[:10]
    )

    my_open_cases = list(
        events.filter(owner=user, status__in=open_case_statuses)
        .order_by("-updated_at")
        .values("id", "title", "status", "severity", "updated_at", "customer__name")[:20]
    )

    if user.is_staff:
        allowed_customers_union = list(
            Customer.objects.filter(is_active=True).order_by("name").values("id", "name", "sla", "sla_rules")
        )
    else:
        union_ids = set()
        for cid in (allowed_case_customers or []):
            union_ids.add(cid)
        for cid in (allowed_alert_customers or []):
            union_ids.add(cid)
        for cid in (allowed_hunt_customers or []):
            union_ids.add(cid)

        allowed_customers_union = list(
            Customer.objects.filter(id__in=list(union_ids), is_active=True)
            .order_by("name")
            .values("id", "name", "sla", "sla_rules")
        )

    sla = _compute_sla_rows(alerts_closed_period)
    pref = _get_or_create_dashboard_preference(user)

    return Response(
        {
            "scope": {
                "customer": customer_id,
                "period": scope["period"],
                "date_from": scope["date_from"],
                "date_to": scope["date_to"],
            },
            "allowed_customers": allowed_customers_union,
            "preferences": {
                "widgets": pref.widgets or DEFAULT_WIDGETS,
                "default_widgets": DEFAULT_WIDGETS,
            },
            "available_widgets": AVAILABLE_WIDGETS,
            "kpis": {
                "cases_open": cases_open,
                "alerts_open": alerts_open,
                "hunts_open": hunts_open,
                "cases_closed_period": cases_closed_period,
                "alerts_closed_period": alerts_closed_period_count,
                "cases_archived_period": cases_archived_period_count,
                "tpwi_cases_period": tpwi_cases_period_count,
                "alert_fp_rate": alert_fp_rate,
                "case_fp_rate": case_fp_rate,
                "open_cases_by_severity": _rows_from_qs(open_cases_by_severity_qs, "severity"),
                "open_alerts_by_severity": _rows_from_qs(open_alerts_by_severity_qs, "severity"),
            },
            "sla": sla,
            "charts": {
                "cases_created_closed_series": cases_created_closed_series,
                "alerts_created_series": alerts_created_series,
                "cases_by_severity_period": _rows_from_qs(cases_by_sev_period_qs, "severity"),
                "cases_by_classification_period": _rows_from_qs(cases_by_classification_period_qs, "classification"),
                "cases_by_outcome_period": _rows_from_qs(cases_by_outcome_period_qs, "outcome"),
                "open_cases_by_customer": _rows_from_qs(open_cases_by_customer_qs, "customer_id", "customer__name"),
                "open_alerts_by_customer": _rows_from_qs(open_alerts_by_customer_qs, "customer_id", "customer__name"),
                "open_hunts_by_customer": _rows_from_qs(open_hunts_by_customer_qs, "customer_id", "customer__name"),
                "alerts_created_by_customer_period": _rows_from_qs(
                    alerts_created_by_customer_period_qs,
                    "customer_id",
                    "customer__name",
                ),
                "cases_created_by_customer_period": _rows_from_qs(
                    cases_created_by_customer_period_qs,
                    "customer_id",
                    "customer__name",
                ),
                "tpwi_cases_by_customer_period": _rows_from_qs(
                    tpwi_cases_by_customer_period_qs,
                    "customer_id",
                    "customer__name",
                ),
            },
            "latest_cases": latest_cases,
            "personal": {
                "my_open_cases": my_open_cases,
            },
        }
    )


@api_view(["GET", "PUT", "DELETE"])
@permission_classes([IsAuthenticated])
def dashboard_preferences(request):
    pref = _get_or_create_dashboard_preference(request.user)

    if request.method == "GET":
        return Response(
            {
                "widgets": pref.widgets or DEFAULT_WIDGETS,
                "default_widgets": DEFAULT_WIDGETS,
                "available_widgets": AVAILABLE_WIDGETS,
            }
        )

    if request.method == "DELETE":
        pref.widgets = DEFAULT_WIDGETS
        pref.save(update_fields=["widgets", "updated_at"])
        return Response(
            {
                "widgets": pref.widgets,
                "default_widgets": DEFAULT_WIDGETS,
                "available_widgets": AVAILABLE_WIDGETS,
            }
        )

    widgets = request.data.get("widgets")
    if not isinstance(widgets, list):
        raise ValidationError("widgets must be a list")

    normalized = []
    seen = set()
    for raw in widgets:
        widget_id = str(raw or "").strip()
        if not widget_id or widget_id not in AVAILABLE_WIDGET_IDS or widget_id in seen:
            continue
        seen.add(widget_id)
        normalized.append(widget_id)

    if not normalized:
        normalized = DEFAULT_WIDGETS

    pref.widgets = normalized
    pref.save(update_fields=["widgets", "updated_at"])

    return Response(
        {
            "widgets": pref.widgets,
            "default_widgets": DEFAULT_WIDGETS,
            "available_widgets": AVAILABLE_WIDGETS,
        }
    )