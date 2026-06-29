from __future__ import annotations

import json
import re
from typing import Any

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .search import build_unified_search_results
from .services_chat_query import (
    build_chat_query_catalog,
    execute_chat_query,
    sanitize_chat_query_plan,
)
from .services_llm import LLMService



def _extract_json_object(text: str) -> dict:
    match = re.search(
        r"\{.*\}",
        str(text or ""),
        re.DOTALL,
    )

    if not match:
        raise ValidationError(
            "The read-only query planner returned no JSON object."
        )

    try:
        value = json.loads(match.group(0))
    except Exception as exc:
        raise ValidationError(
            "The read-only query planner returned invalid JSON."
        ) from exc

    if not isinstance(value, dict):
        raise ValidationError(
            "The read-only query planner returned an invalid object."
        )

    return value


def _planner_history(
    history: list[dict[str, Any]],
) -> list[dict]:
    output = []

    for item in history[-8:]:
        entry = {
            "role": str(item.get("role") or ""),
            "content": str(
                item.get("content") or ""
            )[:2000],
        }

        metadata = item.get("metadata") or {}

        if isinstance(metadata, dict):
            read_operation = metadata.get(
                "read_operation"
            )

            if isinstance(read_operation, dict):
                entry["read_operation"] = read_operation

        output.append(entry)

    return output


def _sanitize_search_plan(payload: dict) -> dict:
    resource = str(
        payload.get("resource") or "all"
    ).strip().lower()

    if resource not in SEARCH_RESOURCES:
        resource = "all"

    query = str(
        payload.get("query") or ""
    ).strip()[:200]

    if len(query) < 3:
        raise ValidationError(
            "Search query must contain at least 3 characters."
        )

    match_mode = str(
        payload.get("match_mode") or "broad"
    ).strip().lower()

    if match_mode not in SEARCH_MATCH_MODES:
        match_mode = "broad"

    try:
        limit = int(payload.get("limit") or 10)
    except Exception:
        limit = 10

    return {
        "operation": "search",
        "resource": resource,
        "query": query,
        "match_mode": match_mode,
        "limit": max(1, min(limit, 20)),
    }


def _sanitize_plan(payload: dict) -> dict:
    operation = str(
        payload.get("operation") or "none"
    ).strip().lower()

    if operation not in ALLOWED_OPERATIONS:
        raise ValidationError(
            "Unsupported read-only operation."
        )

    if operation == "none":
        return {
            "operation": "none",
        }

    if operation == "search":
        return _sanitize_search_plan(payload)

    cleaned = sanitize_chat_query_plan(payload)

    return {
        "operation": "query",
        **cleaned,
    }


def _planner_schema_text(catalog: dict) -> str:
    return json.dumps(
        catalog,
        ensure_ascii=False,
        separators=(",", ":"),
    )


def plan_chat_read_operation(
    *,
    run,
    history: list[dict[str, Any]],
) -> dict:
    service = LLMService(run.provider)
    current_date = timezone.localdate().isoformat()
    customer_id = run.session.customer_id or None

    catalog = build_chat_query_catalog(
        user=run.user,
        customer_id=customer_id,
    )

    history_json = json.dumps(
        _planner_history(history),
        ensure_ascii=False,
        separators=(",", ":"),
    )

    user_prompt = (
        "Convert the user's request into one safe read-only Doko operation.\n"
        "The user may write in any language. Understand the language, "
        "but always return the canonical English field names and canonical "
        "stored values shown in the catalog.\n"
        "Return exactly one JSON object and no other text.\n"
        f"Current date: {current_date}\n\n"
        "Operations:\n"
        "1. none: the request does not need Doko data.\n"
        "2. search: full-text or exact-token lookup across Doko records.\n"
        "3. query: structured filtering, exact statistics, grouped statistics, "
        "time series, or filtered record lists.\n\n"
        "Use search for a free-text phrase, account, hostname, IP, domain, "
        "URL, hash, IoC, asset or identifier that may occur in descriptions, "
        "comments, IoCs or assets.\n"
        "Use match_mode exact_token for an exact IP, domain, URL, hash or "
        "technical identifier.\n"
        "Use query for counts, classifications, severities, statuses, outcomes, "
        "sources, owners, customers, dates, comparisons, groupings and lists "
        "based on structured fields.\n"
        "Use aggregate function count for questions asking how many records "
        "match filters.\n"
        "Use group_by for distributions and time series. A datetime group may "
        "include interval day, week, month or year.\n"
        "Leave aggregate null to return a filtered list.\n"
        "Reuse the previous read_operation when the current message refers "
        "to previous results.\n"
        "Never output SQL, Django lookups, model names, write operations, "
        "SOAR actions or a customer id.\n"
        "Never invent a field outside the catalog. For fields with "
        "open_values=false, use only canonical listed values. For fields with "
        "open_values=true, preserve or normalize the user's literal value; "
        "listed values are useful hints but are not exhaustive.\n"
        "Resolve relative dates to ISO YYYY-MM-DD values using the current date.\n\n"
        "Search shape:\n"
        '{"operation":"search","resource":"all|case|alert|hunt",'
        '"query":"...","match_mode":"broad|exact_token","limit":10}\n\n'
        "Structured query shape:\n"
        '{"operation":"query","resource":"case|alert|hunt",'
        '"filters":[{"field":"classification","operator":"equals",'
        '"value":"Malware"}],'
        '"aggregate":{"function":"count","field":"id"},'
        '"group_by":[],"select":[],"order_by":['
        '{"field":"value","direction":"desc"}],"limit":20}\n\n'
        "No-query shape:\n"
        '{"operation":"none"}\n\n'
        f"Doko query catalog:\n{_planner_schema_text(catalog)}\n\n"
        f"Previous conversation and read operations:\n{history_json}\n\n"
        f"Current user request:\n{run.prompt}"
    )

    answer = service.generate(
        system_prompt=(
            "You are Doko's multilingual read-only query planner. "
            "Return one valid JSON object only."
        ),
        user_prompt=user_prompt,
    )

    return _sanitize_plan(
        _extract_json_object(answer)
    )


def _filter_search_results(
    results: list[dict],
    resource: str,
) -> list[dict]:
    if resource == "all":
        return results

    families = {
        "case": {
            "case",
            "case_comment",
            "ioc",
            "asset",
        },
        "alert": {
            "alert",
            "alert_comment",
        },
        "hunt": {
            "hunt",
            "hunt_journal",
        },
    }

    allowed_types = families.get(
        resource,
        set(),
    )

    return [
        item
        for item in results
        if item.get("type") in allowed_types
    ]


def execute_chat_read_operation(
    *,
    user,
    plan: dict,
    customer_id: str | None = None,
) -> dict | None:
    operation = plan.get("operation")

    if operation == "none":
        return None

    if operation == "search":
        payload = build_unified_search_results(
            user=user,
            raw_query=plan.get("query"),
            per_type_limit=10,
            max_results=120,
            customer_id=customer_id,
            strict_observable_match=(
                plan.get("match_mode") == "exact_token"
            ),
        )

        resource = plan.get("resource") or "all"

        results = _filter_search_results(
            list(payload.get("results", [])),
            resource,
        )

        limit = int(plan.get("limit") or 10)
        limited_results = results[:limit]

        return {
            "operation": "search",
            "resource": resource,
            "query": plan.get("query") or "",
            "match_mode": (
                plan.get("match_mode") or "broad"
            ),
            "returned_count": len(limited_results),
            "results_limited": (
                bool(payload.get("limited"))
                or len(results) > limit
            ),
            "results": limited_results,
        }

    if operation == "query":
        return execute_chat_query(
            user=user,
            plan=plan,
            customer_id=customer_id,
        )

    raise ValidationError(
        "Unsupported read-only operation."
    )


def format_chat_read_context(
    plan: dict,
    result: dict | None,
) -> str:
    if not result:
        return (
            "\n\nNo internal Doko database query was executed. "
            "Do not infer Doko records or statistics from global "
            "recent-item context.\n"
        )

    if result.get("operation") == "error":
        return (
            "\n\nThe read-only Doko database operation failed. "
            "Do not infer or estimate the requested Doko result "
            "from recent records, dashboard metrics or conversation "
            "memory. State only that the exact result could not "
            "be retrieved.\n"
        )

    payload = {
        "plan": plan,
        "result": result,
    }

    return (
        "\n\nAuthoritative read-only Doko database result:\n"
        f"{json.dumps(payload, ensure_ascii=False)}\n\n"
        "Use only this result for the requested Doko data. "
        "Return only the final answer, in the user's language. "
        "Do not expose intermediate reasoning, candidate answers, "
        "corrections, rechecks or self-review. "
        "Do not include a different resource type unless it is "
        "present in the authoritative result. "
        "Values marked exact are exhaustive within the user's "
        "authorized scope. Search results may be limited and must "
        "not be described as an exhaustive count."
    )