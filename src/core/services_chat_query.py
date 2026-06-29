from __future__ import annotations

import datetime
import decimal
import uuid
from typing import Any

from django.db.models import Avg, Count, F, Max, Min, Q
from django.db.models.functions import TruncDay, TruncMonth, TruncWeek, TruncYear
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.exceptions import ValidationError

from .dashboard import _build_dashboard_querysets


QUERY_FIELDS = {
    "case": {
        "id": {"lookup": "id", "type": "uuid", "filterable": True, "selectable": True},
        "case_number": {"lookup": "case_number", "type": "integer", "filterable": True, "selectable": True, "aggregatable": True},
        "title": {"lookup": "title", "type": "text", "filterable": True, "selectable": True},
        "status": {"lookup": "status", "type": "keyword", "filterable": True, "groupable": True, "selectable": True, "choices": True},
        "severity": {"lookup": "severity", "type": "keyword", "filterable": True, "groupable": True, "selectable": True, "choices": True},
        "classification": {"lookup": "classification", "type": "keyword", "filterable": True, "groupable": True, "selectable": True, "choices_from_data": True},
        "outcome": {"lookup": "outcome", "type": "keyword", "filterable": True, "groupable": True, "selectable": True, "choices": True},
        "customer": {"lookup": "customer__name", "group_lookup": "customer_id", "aggregate_lookup": "customer_id", "label_lookup": "customer__name", "type": "keyword", "filterable": True, "groupable": True, "selectable": True},
        "owner": {"lookup": "owner__username", "group_lookup": "owner_id", "aggregate_lookup": "owner_id", "label_lookup": "owner__username", "type": "keyword", "filterable": True, "groupable": True, "selectable": True},
        "created_at": {"lookup": "created_at", "type": "datetime", "filterable": True, "groupable": True, "selectable": True, "aggregatable": True},
        "updated_at": {"lookup": "updated_at", "type": "datetime", "filterable": True, "groupable": True, "selectable": True, "aggregatable": True},
        "archived_at": {"lookup": "archived_at", "type": "datetime", "filterable": True, "groupable": True, "selectable": True, "aggregatable": True},
    },
    "alert": {
        "id": {"lookup": "id", "type": "uuid", "filterable": True, "selectable": True},
        "title": {"lookup": "title", "type": "text", "filterable": True, "selectable": True},
        "status": {"lookup": "status", "type": "keyword", "filterable": True, "groupable": True, "selectable": True, "choices": True},
        "severity": {"lookup": "severity", "type": "keyword", "filterable": True, "groupable": True, "selectable": True, "choices": True},
        "classification": {"lookup": "classification", "type": "keyword", "filterable": True, "groupable": True, "selectable": True, "choices_from_data": True},
        "outcome": {"lookup": "outcome", "type": "keyword", "filterable": True, "groupable": True, "selectable": True, "choices": True},
        "source": {"lookup": "source", "type": "keyword", "filterable": True, "groupable": True, "selectable": True, "choices_from_data": True},
        "customer": {"lookup": "customer__name", "group_lookup": "customer_id", "aggregate_lookup": "customer_id", "label_lookup": "customer__name", "type": "keyword", "filterable": True, "groupable": True, "selectable": True},
        "owner": {"lookup": "owner__username", "group_lookup": "owner_id", "aggregate_lookup": "owner_id", "label_lookup": "owner__username", "type": "keyword", "filterable": True, "groupable": True, "selectable": True},
        "case_number": {"lookup": "case__case_number", "type": "integer", "filterable": True, "groupable": True, "selectable": True},
        "created_at": {"lookup": "created_at", "type": "datetime", "filterable": True, "groupable": True, "selectable": True, "aggregatable": True},
        "updated_at": {"lookup": "updated_at", "type": "datetime", "filterable": True, "groupable": True, "selectable": True, "aggregatable": True},
    },
    "hunt": {
        "id": {"lookup": "id", "type": "uuid", "filterable": True, "selectable": True},
        "title": {"lookup": "title", "type": "text", "filterable": True, "selectable": True},
        "status": {"lookup": "status", "type": "keyword", "filterable": True, "groupable": True, "selectable": True, "choices": True},
        "verdict": {"lookup": "verdict", "type": "keyword", "filterable": True, "groupable": True, "selectable": True, "choices": True},
        "customer": {"lookup": "customer__name", "group_lookup": "customer_id", "aggregate_lookup": "customer_id", "label_lookup": "customer__name", "type": "keyword", "filterable": True, "groupable": True, "selectable": True},
        "owner": {"lookup": "owner__username", "group_lookup": "owner_id", "aggregate_lookup": "owner_id", "label_lookup": "owner__username", "type": "keyword", "filterable": True, "groupable": True, "selectable": True},
        "created_at": {"lookup": "created_at", "type": "datetime", "filterable": True, "groupable": True, "selectable": True, "aggregatable": True},
        "updated_at": {"lookup": "updated_at", "type": "datetime", "filterable": True, "groupable": True, "selectable": True, "aggregatable": True},
        "investigation_started_at": {"lookup": "investigation_started_at", "type": "datetime", "filterable": True, "groupable": True, "selectable": True, "aggregatable": True},
        "investigation_finished_at": {"lookup": "investigation_finished_at", "type": "datetime", "filterable": True, "groupable": True, "selectable": True, "aggregatable": True},
    },
}

DEFAULT_SELECT_FIELDS = {
    "case": ["id", "case_number", "title", "status", "severity", "classification", "customer", "created_at", "updated_at"],
    "alert": ["id", "title", "status", "severity", "classification", "source", "customer", "case_number", "created_at", "updated_at"],
    "hunt": ["id", "title", "status", "verdict", "customer", "created_at", "updated_at"],
}

TYPE_OPERATORS = {
    "text": {"equals", "not_equals", "contains", "not_contains", "is_null", "is_not_null"},
    "keyword": {"equals", "not_equals", "contains", "not_contains", "in", "not_in", "is_null", "is_not_null"},
    "integer": {"equals", "not_equals", "in", "not_in", "greater_than", "greater_or_equal", "less_than", "less_or_equal", "is_null", "is_not_null"},
    "uuid": {"equals", "not_equals", "in", "not_in", "is_null", "is_not_null"},
    "datetime": {"equals", "not_equals", "greater_than", "greater_or_equal", "less_than", "less_or_equal", "is_null", "is_not_null"},
}

AGGREGATE_FUNCTIONS = {"count", "count_distinct", "minimum", "maximum", "average"}
TIME_BUCKETS = {"day", "week", "month", "year"}
TRUNC_FUNCTIONS = {
    "day": TruncDay,
    "week": TruncWeek,
    "month": TruncMonth,
    "year": TruncYear,
}


def _get_queryset(*, user, resource: str, customer_id: str | None):
    scoped = _build_dashboard_querysets(user, customer_id)

    if resource == "case":
        return scoped["events"]
    if resource == "alert":
        return scoped["alerts"]
    if resource == "hunt":
        return scoped["hunts"]

    raise ValidationError("Unsupported query resource.")


def _field_choices(qs, field_name: str, config: dict) -> list[str]:
    lookup = config["lookup"]

    if config.get("choices") and "__" not in lookup:
        try:
            model_field = qs.model._meta.get_field(lookup)
            values = [
                str(value)
                for value, _ in model_field.flatchoices
                if value not in (None, "")
            ]
            if values:
                return values[:100]
        except Exception:
            pass

    if config.get("choices_from_data"):
        try:
            return [
                str(value)
                for value in (
                    qs.exclude(**{f"{lookup}__isnull": True})
                    .exclude(**{lookup: ""})
                    .values_list(lookup, flat=True)
                    .distinct()
                    .order_by(lookup)[:100]
                )
                if value not in (None, "")
            ]
        except Exception:
            return []

    return []


def build_chat_query_catalog(*, user, customer_id: str | None = None) -> dict:
    resources = {}

    for resource, fields in QUERY_FIELDS.items():
        qs = _get_queryset(user=user, resource=resource, customer_id=customer_id)
        field_payload = {}

        for field_name, config in fields.items():
            operators = sorted(TYPE_OPERATORS.get(config["type"], set())) if config.get("filterable") else []
            payload = {
                "type": config["type"],
                "filterable": bool(config.get("filterable")),
                "groupable": bool(config.get("groupable")),
                "selectable": bool(config.get("selectable")),
                "operators": operators,
                "open_values": bool(
                    config["type"] in {"text", "keyword"}
                    and not config.get("choices")
                ),
            }
            choices = _field_choices(qs, field_name, config)
            if choices:
                payload["values"] = choices
            field_payload[field_name] = payload

        resources[resource] = {
            "fields": field_payload,
            "default_select": DEFAULT_SELECT_FIELDS[resource],
        }

    return {
        "resources": resources,
        "aggregate_functions": sorted(AGGREGATE_FUNCTIONS),
        "time_buckets": sorted(TIME_BUCKETS),
        "maximum_filters": 12,
        "maximum_groups": 2,
        "maximum_results": 50,
    }


def _coerce_scalar(field_type: str, value):
    if field_type == "integer":
        return int(value)
    if field_type == "uuid":
        return uuid.UUID(str(value))
    if field_type == "datetime":
        return str(value).strip()
    return str(value).strip()


def _sanitize_filter(resource: str, raw_filter: dict) -> dict:
    if not isinstance(raw_filter, dict):
        raise ValidationError("Each query filter must be an object.")

    field_name = str(raw_filter.get("field") or "").strip()
    operator = str(raw_filter.get("operator") or "equals").strip().lower()
    config = QUERY_FIELDS.get(resource, {}).get(field_name)

    if not config or not config.get("filterable"):
        raise ValidationError(f"Unsupported query filter field: {field_name or 'missing'}.")

    if operator not in TYPE_OPERATORS.get(config["type"], set()):
        raise ValidationError(
            f"Unsupported operator '{operator}' for field '{field_name}'."
        )

    if operator in {"is_null", "is_not_null"}:
        value = None
    else:
        value = raw_filter.get("value")
        if value in (None, "", []):
            raise ValidationError(f"Missing filter value for field '{field_name}'.")

        try:
            if operator in {"in", "not_in"}:
                values = value if isinstance(value, list) else [value]
                value = [
                    _coerce_scalar(config["type"], item)
                    for item in values[:100]
                    if item not in (None, "")
                ]
                if not value:
                    raise ValidationError(
                        f"Missing filter value for field '{field_name}'."
                    )
            else:
                value = _coerce_scalar(config["type"], value)
        except (TypeError, ValueError) as exc:
            raise ValidationError(
                f"Invalid value for field '{field_name}'."
            ) from exc

    return {
        "field": field_name,
        "operator": operator,
        "value": value,
    }


def sanitize_chat_query_plan(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise ValidationError("The structured query plan must be an object.")

    resource = str(payload.get("resource") or "").strip().lower()
    if resource not in QUERY_FIELDS:
        raise ValidationError("Unsupported query resource.")

    raw_filters = payload.get("filters") or []
    if not isinstance(raw_filters, list):
        raise ValidationError("Query filters must be a list.")

    filters = [
        _sanitize_filter(resource, raw_filter)
        for raw_filter in raw_filters[:12]
    ]

    group_by = []
    raw_groups = payload.get("group_by") or []
    if not isinstance(raw_groups, list):
        raise ValidationError("Query group_by must be a list.")

    for raw_group in raw_groups[:2]:
        if isinstance(raw_group, str):
            field_name = raw_group.strip()
            interval = ""
        elif isinstance(raw_group, dict):
            field_name = str(raw_group.get("field") or "").strip()
            interval = str(raw_group.get("interval") or "").strip().lower()
        else:
            raise ValidationError("Each query group must be a string or object.")

        config = QUERY_FIELDS[resource].get(field_name)
        if not config or not config.get("groupable"):
            raise ValidationError(
                f"Unsupported query group field: {field_name or 'missing'}."
            )

        if config["type"] == "datetime":
            if not interval:
                interval = "day"
            elif interval not in TIME_BUCKETS:
                raise ValidationError(
                    f"A valid time interval is required for field '{field_name}'."
                )
        elif interval:
            raise ValidationError(
                f"Time intervals are not supported for field '{field_name}'."
            )

        group_by.append({"field": field_name, "interval": interval})

    aggregate = None
    raw_aggregate = payload.get("aggregate")
    if raw_aggregate is not None:
        if not isinstance(raw_aggregate, dict):
            raise ValidationError("Query aggregate must be an object or null.")

        function = str(raw_aggregate.get("function") or "count").strip().lower()
        field_name = str(raw_aggregate.get("field") or "id").strip()
        config = QUERY_FIELDS[resource].get(field_name)

        if function not in AGGREGATE_FUNCTIONS:
            raise ValidationError("Unsupported aggregate function.")
        if not config:
            raise ValidationError("Unsupported aggregate field.")
        if function in {"minimum", "maximum", "average"} and not config.get("aggregatable"):
            raise ValidationError("Field cannot be aggregated with this function.")
        if function == "average" and config["type"] != "integer":
            raise ValidationError("Average is only available for numeric fields.")

        aggregate = {"function": function, "field": field_name}

    raw_select = payload.get("select") or []
    if not isinstance(raw_select, list):
        raise ValidationError("Query select must be a list.")

    select = []
    for raw_field in raw_select[:12]:
        field_name = str(raw_field or "").strip()
        config = QUERY_FIELDS[resource].get(field_name)
        if not config or not config.get("selectable"):
            raise ValidationError(
                f"Unsupported query select field: {field_name or 'missing'}."
            )
        if field_name not in select:
            select.append(field_name)

    raw_order = payload.get("order_by") or []
    if not isinstance(raw_order, list):
        raise ValidationError("Query order_by must be a list.")

    order_by = []
    for raw_item in raw_order[:3]:
        if not isinstance(raw_item, dict):
            raise ValidationError("Each query order item must be an object.")

        field_name = str(raw_item.get("field") or "").strip()
        direction = str(raw_item.get("direction") or "asc").strip().lower()

        if field_name != "value" and field_name not in QUERY_FIELDS[resource]:
            raise ValidationError(
                f"Unsupported query order field: {field_name or 'missing'}."
            )
        if direction not in {"asc", "desc"}:
            raise ValidationError("Query order direction must be asc or desc.")

        order_by.append({"field": field_name, "direction": direction})

    try:
        limit = int(payload.get("limit") or 20)
    except (TypeError, ValueError) as exc:
        raise ValidationError("Query limit must be an integer.") from exc

    return {
        "resource": resource,
        "filters": filters,
        "aggregate": aggregate,
        "group_by": group_by,
        "select": select,
        "order_by": order_by,
        "limit": max(1, min(limit, 50)),
    }

def _date_bounds(raw_value: str) -> tuple[datetime.datetime, datetime.datetime | None]:
    raw = str(raw_value or "").strip()
    parsed_dt = parse_datetime(raw)

    if parsed_dt is not None:
        if timezone.is_naive(parsed_dt):
            parsed_dt = timezone.make_aware(parsed_dt)
        return parsed_dt, None

    parsed_day = parse_date(raw)
    if parsed_day is None:
        raise ValidationError(f"Invalid date or datetime: {raw}")

    start = timezone.make_aware(datetime.datetime.combine(parsed_day, datetime.time.min))
    return start, start + datetime.timedelta(days=1)


def _string_in_q(lookup: str, values: list) -> Q:
    query = Q()
    for value in values:
        query |= Q(**{f"{lookup}__iexact": value})
    return query


def _apply_filter(qs, resource: str, item: dict):
    config = QUERY_FIELDS[resource][item["field"]]
    lookup = config["lookup"]
    field_type = config["type"]
    operator = item["operator"]
    value = item.get("value")

    if operator == "is_null":
        return qs.filter(**{f"{lookup}__isnull": True})
    if operator == "is_not_null":
        return qs.filter(**{f"{lookup}__isnull": False})

    if field_type == "datetime":
        start, next_day = _date_bounds(value)

        if operator == "equals":
            if next_day is None:
                return qs.filter(**{lookup: start})
            return qs.filter(**{f"{lookup}__gte": start, f"{lookup}__lt": next_day})
        if operator == "not_equals":
            if next_day is None:
                return qs.exclude(**{lookup: start})
            return qs.exclude(**{f"{lookup}__gte": start, f"{lookup}__lt": next_day})
        if operator == "greater_than":
            return qs.filter(**{f"{lookup}__gte": next_day or start})
        if operator == "greater_or_equal":
            return qs.filter(**{f"{lookup}__gte": start})
        if operator == "less_than":
            return qs.filter(**{f"{lookup}__lt": start})
        if operator == "less_or_equal":
            return qs.filter(**{f"{lookup}__lt": next_day or start})

    if field_type in {"text", "keyword"}:
        if operator == "equals":
            return qs.filter(**{f"{lookup}__iexact": value})
        if operator == "not_equals":
            return qs.exclude(**{f"{lookup}__iexact": value})
        if operator == "contains":
            return qs.filter(**{f"{lookup}__icontains": value})
        if operator == "not_contains":
            return qs.exclude(**{f"{lookup}__icontains": value})
        if operator == "in":
            return qs.filter(_string_in_q(lookup, value))
        if operator == "not_in":
            return qs.exclude(_string_in_q(lookup, value))

    if operator == "equals":
        return qs.filter(**{lookup: value})
    if operator == "not_equals":
        return qs.exclude(**{lookup: value})
    if operator == "in":
        return qs.filter(**{f"{lookup}__in": value})
    if operator == "not_in":
        return qs.exclude(**{f"{lookup}__in": value})
    if operator == "greater_than":
        return qs.filter(**{f"{lookup}__gt": value})
    if operator == "greater_or_equal":
        return qs.filter(**{f"{lookup}__gte": value})
    if operator == "less_than":
        return qs.filter(**{f"{lookup}__lt": value})
    if operator == "less_or_equal":
        return qs.filter(**{f"{lookup}__lte": value})

    raise ValidationError("Unsupported query operator.")


def _json_safe(value):
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time, uuid.UUID)):
        return str(value)
    if isinstance(value, decimal.Decimal):
        return float(value)
    return value


def _aggregate_expression(resource: str, aggregate: dict):
    field_name = aggregate["field"]
    config = QUERY_FIELDS[resource][field_name]
    lookup = config.get("aggregate_lookup") or config["lookup"]
    function = aggregate["function"]

    if function == "count":
        return Count(lookup)
    if function == "count_distinct":
        return Count(lookup, distinct=True)
    if function == "minimum":
        return Min(lookup)
    if function == "maximum":
        return Max(lookup)
    if function == "average":
        return Avg(lookup)

    raise ValidationError("Unsupported aggregate function.")


def _execute_aggregate(qs, plan: dict) -> dict:
    resource = plan["resource"]
    aggregate = plan["aggregate"]
    expression = _aggregate_expression(resource, aggregate)
    groups = plan["group_by"]

    if not groups:
        value = qs.aggregate(value=expression)["value"]
        return {
            "operation": "query",
            "kind": "aggregate",
            "resource": resource,
            "exact": True,
            "filters": plan["filters"],
            "aggregate": aggregate,
            "value": _json_safe(value),
        }

    annotations = {}
    value_fields = []
    group_meta = []

    for index, group in enumerate(groups):
        field_name = group["field"]
        config = QUERY_FIELDS[resource][field_name]
        value_alias = f"group_{index}"
        label_alias = f"group_{index}_label"

        if group["interval"]:
            annotations[value_alias] = TRUNC_FUNCTIONS[group["interval"]](config["lookup"])
            group_meta.append((field_name, group["interval"], value_alias, None))
            value_fields.append(value_alias)
        else:
            annotations[value_alias] = F(config.get("group_lookup") or config["lookup"])
            value_fields.append(value_alias)
            label_lookup = config.get("label_lookup")
            if label_lookup:
                annotations[label_alias] = F(label_lookup)
                value_fields.append(label_alias)
                group_meta.append((field_name, "", value_alias, label_alias))
            else:
                group_meta.append((field_name, "", value_alias, None))

    grouped = qs.annotate(**annotations).values(*value_fields).annotate(value=expression)

    order_by = plan["order_by"]
    if order_by:
        ordering = []
        for item in order_by:
            if item["field"] == "value":
                ordering.append(("-" if item["direction"] == "desc" else "") + "value")
        if ordering:
            grouped = grouped.order_by(*ordering)
        else:
            grouped = grouped.order_by("-value")
    else:
        grouped = grouped.order_by("-value")

    rows = []
    for raw_row in grouped[:100]:
        row_groups = []
        for field_name, interval, value_alias, label_alias in group_meta:
            row_groups.append(
                {
                    "field": field_name,
                    "interval": interval or None,
                    "value": _json_safe(raw_row.get(value_alias)),
                    "label": _json_safe(raw_row.get(label_alias)) if label_alias else None,
                }
            )
        rows.append({"groups": row_groups, "value": _json_safe(raw_row.get("value"))})

    return {
        "operation": "query",
        "kind": "aggregate",
        "resource": resource,
        "exact": True,
        "filters": plan["filters"],
        "aggregate": aggregate,
        "group_by": groups,
        "total_matching_records": qs.count(),
        "rows": rows,
    }


def _execute_list(qs, plan: dict) -> dict:
    resource = plan["resource"]
    selected = plan["select"] or DEFAULT_SELECT_FIELDS[resource]
    lookup_to_name = {QUERY_FIELDS[resource][field]["lookup"]: field for field in selected}
    lookups = list(lookup_to_name.keys())

    ordering = []
    for item in plan["order_by"]:
        if item["field"] == "value":
            continue
        lookup = QUERY_FIELDS[resource][item["field"]]["lookup"]
        ordering.append(("-" if item["direction"] == "desc" else "") + lookup)

    if not ordering and "updated_at" in QUERY_FIELDS[resource]:
        ordering = ["-updated_at"]

    if ordering:
        qs = qs.order_by(*ordering)

    total = qs.count()
    rows = []
    for raw_row in qs.values(*lookups)[: plan["limit"]]:
        rows.append(
            {
                lookup_to_name[lookup]: _json_safe(raw_row.get(lookup))
                for lookup in lookups
            }
        )

    return {
        "operation": "query",
        "kind": "list",
        "resource": resource,
        "exact": True,
        "filters": plan["filters"],
        "total_matching_records": total,
        "returned_count": len(rows),
        "results_limited": total > len(rows),
        "items": rows,
    }


def execute_chat_query(*, user, plan: dict, customer_id: str | None = None) -> dict:
    cleaned = sanitize_chat_query_plan(plan)
    qs = _get_queryset(user=user, resource=cleaned["resource"], customer_id=customer_id)

    for item in cleaned["filters"]:
        qs = _apply_filter(qs, cleaned["resource"], item)

    if cleaned["aggregate"]:
        return _execute_aggregate(qs, cleaned)

    return _execute_list(qs, cleaned)
