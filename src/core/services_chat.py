from __future__ import annotations

import datetime
import decimal
import json
import re
import uuid
import time

from django.db import transaction
from django.utils import timezone
from django.utils.html import strip_tags

from .html_sanitizer import sanitize_html
from .models import (
    AIProvider,
    AuditLog,
    ChatActionRun,
    ChatContextSnapshot,
    ChatGeneratedDraft,
    ChatMessage,
    ChatRun,
    ChatSession,
    InvestigationTemplate,
)
from .services_chat_context import ChatContextRequest, build_chat_context_snapshot
from .services_llm import LLMService
from .services_soar import (
    collect_soar_result,
    launch_soar_execution,
    poll_soar_execution,
)

SLASH_RE = re.compile(r"^/(?P<command>[a-z0-9_:-]+)(?:\s+(?P<rest>.*))?$", re.IGNORECASE)
ARG_RE = re.compile(r'(?P<key>[a-zA-Z_][a-zA-Z0-9_]*)=(?P<value>"[^"]*"|\S+)')

BASE_SYSTEM_PROMPT = (
    "You are Doko's SOC analyst assistant, expert on cybersecurity. "
    "Answer the user's question directly and naturally based only on the provided case, alert, hunt, task, dashboard or audit context and the conversation history provided with the request. "
    "Use the prior conversation to preserve continuity when the user's new message depends on earlier exchanges. "
    "If the user sends a short referential follow-up such as '+2', 'continue', 'summarize that', 'rewrite it', or similar, interpret it using the most recent relevant exchange. "
    "Use Markdown to display your answers. "
    "Use headings, bullet lists, numbered lists, blockquotes, inline code, fenced code blocks and Markdown tables when they improve readability. "
    "When presenting multiple records, comparisons, cases, alerts, hunts, IoCs or assets, prefer compact Markdown tables. "
    "Keep table headers short, keep cells concise, and put technical identifiers such as hashes, IPs, domains, URLs, file paths, etc... inside inline code when useful. "
    "When showing code, commands, JSON, logs or structured technical output, use fenced code blocks with the appropriate language when known. "
    "Do not mention internal implementation details such as snapshots, prompts, payloads, tabs or hidden context unless the user explicitly asks about them. "
    "Stay factual, do not invent facts, do not claim actions were taken if they were not, and clearly say when information is missing."
)


class ChatRunCancelled(Exception):
    pass


def parse_chat_command(message: str) -> tuple[str | None, dict[str, str], str]:
    text = (message or "").strip()
    match = SLASH_RE.match(text)
    if not match:
        return None, {}, text

    command = f"/{match.group('command').lower()}"
    rest = (match.group("rest") or "").strip()
    variables: dict[str, str] = {}

    consumed_spans = []
    for arg in ARG_RE.finditer(rest):
        key = arg.group("key")
        raw_value = arg.group("value")
        value = raw_value[1:-1] if raw_value.startswith('"') and raw_value.endswith('"') else raw_value
        variables[key] = value
        consumed_spans.append(arg.span())

    if consumed_spans:
        chars = list(rest)
        for start, end in reversed(consumed_spans):
            for idx in range(start, end):
                chars[idx] = " "
        free_text = " ".join("".join(chars).split())
    else:
        free_text = rest

    return command, variables, free_text


def to_json_safe(value):
    if value is None:
        return None

    if isinstance(value, uuid.UUID):
        return str(value)

    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()

    if isinstance(value, decimal.Decimal):
        return float(value)

    if isinstance(value, dict):
        return {str(k): to_json_safe(v) for k, v in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [to_json_safe(v) for v in value]

    return value


def _audit_soar_investigation_event(
    *,
    run: ChatRun,
    template: InvestigationTemplate,
    action: ChatActionRun,
    success: bool,
    error: str = "",
) -> None:
    try:
        soar_provider = template.soar_provider
        llm_provider = run.provider

        AuditLog.objects.create(
            actor=run.user,
            actor_username=(getattr(run.user, "username", "") or "")[:160],
            action=(
                "chat.soar.investigation_template.succeeded"
                if success
                else "chat.soar.investigation_template.failed"
            ),
            success=success,
            status_code=200 if success else 500,
            object_type="chat_action_run",
            object_id=str(action.id),
            object_repr=template.name or template.code or "",
            metadata={
                "run_id": str(run.id),
                "request_id": run.request_id or "",
                "session_id": str(run.session_id) if run.session_id else "",
                "chat_action_run_id": str(action.id),
                "investigation_template": {
                    "id": str(template.id),
                    "code": template.code or "",
                    "name": template.name or "",
                    "remote_template_code": template.remote_template_code or "",
                },
                "soar_provider": {
                    "id": str(soar_provider.id) if soar_provider else "",
                    "code": soar_provider.code if soar_provider else "",
                    "name": soar_provider.name if soar_provider else "",
                    "provider_kind": soar_provider.provider_kind if soar_provider else "",
                },
                "llm_provider": {
                    "id": str(llm_provider.id) if llm_provider else "",
                    "code": llm_provider.code if llm_provider else "",
                    "name": llm_provider.name if llm_provider else "",
                    "provider_kind": llm_provider.provider_kind if llm_provider else "",
                },
                "remote_run_id": action.remote_run_id or "",
                "remote_status": action.remote_status or "",
                "error": str(error or "")[:2000],
            },
        )
    except Exception:
        pass

def _build_recent_conversation_history(run: ChatRun, limit: int = 12) -> list[dict[str, str]]:
    session = ChatSession.objects.filter(
        id=run.session_id,
        user=run.user,
    ).first()
    if not session:
        return []

    items = list(
        ChatMessage.objects.filter(session=session)
        .order_by("-created_at")[: max(1, limit * 2)]
    )
    items.reverse()

    history: list[dict[str, str]] = []

    for item in items:
        role = str(item.role or "").strip().lower()
        raw_content = str(item.content or "").strip()
        content = strip_tags(raw_content).strip() if role == "assistant" else raw_content
        metadata = item.metadata or {}

        if not content:
            continue

        if role not in {"user", "assistant", "system"}:
            continue

        if metadata.get("request_id") == run.request_id:
            continue

        history.append({
            "role": role,
            "content": content,
        })

    if len(history) > limit:
        history = history[-limit:]

    return history


def _format_prompt(snapshot_payload: dict, user_message: str, history: list[dict[str, str]] | None = None) -> str:
    history = history or []

    transcript_lines: list[str] = []
    for item in history:
        role = str(item.get("role") or "").strip().lower()
        content = str(item.get("content") or "").strip()
        if not content:
            continue

        if role == "assistant":
            label = "Assistant"
        elif role == "system":
            label = "System"
        else:
            label = "User"

        transcript_lines.append(f"{label}: {content}")

    transcript = "\n\n".join(transcript_lines).strip()

    return (
        "Context JSON:\n"
        f"{json.dumps(snapshot_payload or {}, ensure_ascii=False)}\n\n"
        "Previous conversation:\n"
        f"{transcript if transcript else 'None'}\n\n"
        "Current user request:\n"
        f"{user_message}\n\n"
        "Instructions:\n"
        "- Use the previous conversation when the current request depends on it.\n"
        "- If the current request is elliptical or referential, such as '+2', 'continue', 'summarize that', "
        "'rewrite it', 'translate it', or similar, interpret it using the most recent relevant exchange.\n"
        "- Keep continuity with the earlier answer when appropriate.\n"
        "- Answer the analyst directly.\n"
        "- Do not mention hidden context, internal structures, or prompt formatting unless explicitly asked."
    )


def _extract_json_block(text: str) -> dict | None:
    if not text:
        return None
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        value = json.loads(match.group(0))
    except Exception:
        return None
    return value if isinstance(value, dict) else None


def _list_enabled_investigation_templates() -> list[InvestigationTemplate]:
    return list(
        InvestigationTemplate.objects.filter(
            is_enabled=True,
            soar_provider__is_enabled=True,
        )
        .select_related("soar_provider")
        .order_by("name")
    )


def _build_template_selection_prompt(run: ChatRun, templates: list[InvestigationTemplate]) -> str:
    raw_context = run.snapshot.context_payload or {}
    context_payload = json.dumps(
        {
            "page_type": raw_context.get("page_type"),
            "current_tab": raw_context.get("current_tab"),
            "header": raw_context.get("header"),
            "iocs": raw_context.get("iocs"),
            "assets": raw_context.get("assets"),
        },
        ensure_ascii=False,
    )

    lines = [
        "You are selecting at most one investigation template for a SOC chatbot request.",
        "Return JSON only.",
        'If no template should be executed, return: {"should_execute": false}.',
        'If one template should be executed, return:',
        '{"should_execute": true, "template_code": "...", "variables": {...}, "reason": "..."}',
        "Use only one template.",
        "If the user explicitly mentions a platform or tool like Splunk, and one template clearly matches that platform in its hint or name, prefer selecting it.",
        "If the user asks for a search, investigation, lookup, activity review, enrichment, test the SOAR or check on a named platform, that is a strong signal to execute a template.",
        "You may use the page context JSON to resolve references like 'this account', 'this user', 'this IP', 'this host', 'this domain'.",
        "Only return should_execute=false when no template is a reasonable match.",
        "",
        f'User message: "{run.prompt}"',
        "",
        f"Page context JSON: {context_payload}",
        "",
        "Available templates:",
    ]

    for item in templates:
        schema = json.dumps(item.allowed_variables_schema or {}, ensure_ascii=False)
        lines.append(
            f'- code="{item.code}" | name="{item.name}" | provider="{item.soar_provider.name}" '
            f'| chat_command="{item.chat_command or ""}" | entity_type="{item.entity_type}" '
            f'| hint="{item.selection_hint or item.description or ""}" '
            f'| allowed_variables_schema={schema}'
        )

    return "\n".join(lines)


def _select_investigation_template_with_llm(run: ChatRun) -> tuple[InvestigationTemplate | None, dict, str]:
    templates = _list_enabled_investigation_templates()
    if not templates:
        return None, {}, ""

    service = LLMService(run.provider)
    selection_answer = service.generate(
        system_prompt="You are a strict JSON selector for SOAR investigation templates.",
        user_prompt=_build_template_selection_prompt(run, templates),
    )

    payload = _extract_json_block(selection_answer) or {}
    if not payload.get("should_execute"):
        return None, {}, ""

    template_code = str(payload.get("template_code") or "").strip()
    variables = payload.get("variables") or {}
    reason = str(payload.get("reason") or "").strip()

    if not isinstance(variables, dict):
        variables = {}

    template = next((item for item in templates if item.code == template_code), None)
    if not template:
        return None, {}, ""

    return template, variables, reason


def _infer_template_variables_from_prompt(
    run: ChatRun,
    template: InvestigationTemplate,
    user_prompt: str,
) -> dict:
    if not (user_prompt or "").strip():
        return {}

    schema = template.allowed_variables_schema or {}
    properties, _ = _get_schema_properties(schema)
    if not properties:
        return {}

    service = LLMService(run.provider)
    schema_json = json.dumps(properties, ensure_ascii=False)

    prompt = (
        "Extract variables for the selected investigation template.\n"
        "Return JSON only.\n"
        "Return an empty JSON object if nothing can be extracted.\n"
        "Only use keys present in the schema.\n\n"
        f"Template name: {template.name}\n"
        f"Template code: {template.code}\n"
        f"Template command: {template.chat_command or ''}\n"
        f"Allowed variables schema: {schema_json}\n"
        f"User request: {user_prompt}\n"
    )

    answer = service.generate(
        system_prompt="You are a strict JSON variable extractor.",
        user_prompt=prompt,
    )

    payload = _extract_json_block(answer) or {}
    return payload if isinstance(payload, dict) else {}


def _get_schema_properties(schema: dict | None) -> tuple[dict, set[str]]:
    schema = schema or {}
    if not isinstance(schema, dict):
        return {}, set()

    if "properties" in schema:
        properties = schema.get("properties") or {}
        required = set(schema.get("required") or [])
        return properties if isinstance(properties, dict) else {}, required

    properties = {}
    required = set()
    for key, value in schema.items():
        if isinstance(value, dict):
            properties[key] = value
            if value.get("required") is True:
                required.add(key)
        else:
            properties[key] = {"type": "string"}
    return properties, required


def _coerce_variable_value(expected_type: str, value):
    if value is None:
        return None

    if expected_type == "integer":
        return int(value)

    if expected_type == "number":
        return float(value)

    if expected_type == "boolean":
        if isinstance(value, bool):
            return value
        lowered = str(value).strip().lower()
        if lowered in {"true", "1", "yes", "y"}:
            return True
        if lowered in {"false", "0", "no", "n"}:
            return False
        raise ValueError("Invalid boolean value")

    if expected_type == "array":
        if isinstance(value, list):
            return value
        return [item.strip() for item in str(value).split(",") if item.strip()]

    return str(value)


def _sanitize_variables(
    source: dict | None,
    schema: dict | None,
    *,
    allow_only_keys: set[str] | None = None,
) -> dict:
    result = {}
    source = source or {}
    properties, _ = _get_schema_properties(schema)

    for key, value in source.items():
        if key not in properties:
            continue
        if allow_only_keys is not None and key not in allow_only_keys:
            continue

        field_schema = properties.get(key) or {}
        expected_type = field_schema.get("type", "string")
        result[key] = _coerce_variable_value(expected_type, value)

    return result


def _validate_required_template_variables(template: InvestigationTemplate, variables: dict) -> dict:
    properties, required = _get_schema_properties(template.allowed_variables_schema or {})
    cleaned = dict(variables or {})

    for key in required:
        if key not in cleaned or cleaned[key] in ("", None, []):
            raise ValueError(f"Missing required variable: {key}")

    for key in list(cleaned.keys()):
        if key not in properties:
            cleaned.pop(key, None)

    return cleaned


def _has_all_required_template_variables(template: InvestigationTemplate, variables: dict) -> bool:
    _, required = _get_schema_properties(template.allowed_variables_schema or {})
    for key in required:
        if key not in variables or variables[key] in ("", None, []):
            return False
    return True


def _get_request_hints(run: ChatRun) -> dict:
    provider_execution = run.provider_execution or {}
    request_hints = provider_execution.get("request_hints") or {}
    return request_hints if isinstance(request_hints, dict) else {}


def _set_run_progress(run: ChatRun, *, label: str, preview: str = "") -> None:
    current = run.provider_execution or {}
    current["ui_progress"] = {
        "label": label,
        "preview": preview,
        "updated_at": timezone.now().isoformat(),
    }
    run.provider_execution = current
    run.save(update_fields=["provider_execution", "updated_at"])


def _refresh_run_or_raise_cancelled(run: ChatRun) -> ChatRun:
    run.refresh_from_db()
    if run.cancel_requested:
        run.status = "cancelled"
        run.completed_at = timezone.now()
        run.save(update_fields=["status", "completed_at", "updated_at"])
        raise ChatRunCancelled("Run cancelled by user")
    return run


def _build_system_prompt(provider: AIProvider, template: InvestigationTemplate | None = None) -> str:
    parts = [BASE_SYSTEM_PROMPT]

    default_system_prompt = getattr(provider, "default_system_prompt", "") or ""
    if default_system_prompt.strip():
        parts.append(default_system_prompt.strip())

    if template and (template.ai_context or "").strip():
        parts.append(template.ai_context.strip())

    return "\n\n".join(parts)


def _normalize_remote_status_name(value: str) -> str:
    return (value or "").strip().lower()


def _resolve_action_state(template: InvestigationTemplate, remote_status: str) -> str:
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
            or ["failed", "error", "cancelled"]
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


def _wait_for_action_completion(run: ChatRun, action: ChatActionRun) -> ChatActionRun:
    execution_config = action.template.execution_config or {}
    mode = str(execution_config.get("mode") or "").strip().lower()

    if mode != "async_poll":
        return action

    timeout_seconds = int(execution_config.get("timeout_seconds") or 0)
    poll_interval_seconds = int(execution_config.get("poll_interval_seconds") or 3)

    if timeout_seconds <= 0:
        return action

    deadline = timezone.now() + datetime.timedelta(seconds=timeout_seconds)

    while action.status == "running" and timezone.now() < deadline:
        time.sleep(max(1, poll_interval_seconds))
        run = _refresh_run_or_raise_cancelled(run)
        action.refresh_from_db()
        action = refresh_chat_action_run(action)
        action.refresh_from_db()

        if action.status in {"completed", "failed", "cancelled"}:
            break

    return action


def _execute_investigation_template(
    run: ChatRun,
    template: InvestigationTemplate,
    variables: dict,
) -> ChatActionRun:
    action = ChatActionRun.objects.create(
        run=run,
        template=template,
        status="running",
        input_payload=variables or {},
        started_at=timezone.now(),
    )

    try:
        provider_execution = launch_soar_execution(
            run=run,
            template=template,
            variables=variables or {},
            prompt=run.prompt or "",
        ) or {}

        launch_request = provider_execution.get("launch_request") or {}
        launch_response = provider_execution.get("launch_response") or {}
        remote_run_id = str(provider_execution.get("external_run_id") or "")
        remote_status = str(provider_execution.get("status") or "")

        action.request_payload = launch_request
        action.raw_response_payload = launch_response
        action.remote_run_id = remote_run_id
        action.remote_status = remote_status

        current_provider_execution = run.provider_execution or {}
        run.provider_execution = {
            **current_provider_execution,
            **provider_execution,
        }

        if remote_run_id:
            action.status = _resolve_action_state(template, remote_status)
            if action.status == "completed":
                result_payload = collect_soar_result(
                    template=template,
                    provider_execution=run.provider_execution,
                )
                action.output_payload = result_payload or {}
                action.completed_at = timezone.now()
            else:
                action.output_payload = {}
                action.completed_at = None
        else:
            result_payload = collect_soar_result(
                template=template,
                provider_execution=run.provider_execution,
            )
            action.output_payload = result_payload or launch_response or {}
            action.status = "completed"
            action.completed_at = timezone.now()

        run.save(update_fields=["provider_execution", "updated_at"])
        action.save(
            update_fields=[
                "request_payload",
                "output_payload",
                "raw_response_payload",
                "remote_run_id",
                "remote_status",
                "status",
                "completed_at",
                "updated_at",
            ]
        )

        _audit_soar_investigation_event(
            run=run,
            template=template,
            action=action,
            success=True,
        )

        return action

    except Exception as exc:
        action.status = "failed"
        action.error_message = str(exc)
        action.completed_at = timezone.now()
        action.save(
            update_fields=[
                "status",
                "error_message",
                "completed_at",
                "updated_at",
            ]
        )

        _audit_soar_investigation_event(
            run=run,
            template=template,
            action=action,
            success=False,
            error=str(exc),
        )

        raise


def _action_result_message_exists(action: ChatActionRun) -> bool:
    return ChatMessage.objects.filter(
        session=action.run.session,
        role="assistant",
        metadata__action_id=str(action.id),
        metadata__message_kind="action_result",
    ).exists()


def _publish_action_result_message(action: ChatActionRun) -> None:
    if _action_result_message_exists(action):
        return

    action.run.refresh_from_db()
    if action.run.cancel_requested or action.run.status == "cancelled":
        return

    service = LLMService(action.run.provider)

    summary_prompt = (
        "Summarize the SOAR/orchestrator investigation result for the analyst.\n"
        "Use Markdown only.\n"
        "Be factual.\n"
        "If the payload is empty, clearly say that the remote run completed but returned no detailed result.\n\n"
        f"Template name: {action.template.name}\n"
        f"Template code: {action.template.code}\n"
        f"Remote run id: {action.remote_run_id}\n"
        f"Remote status: {action.remote_status}\n"
        f"Input payload: {json.dumps(action.input_payload or {}, ensure_ascii=False)}\n"
        f"Output payload: {json.dumps(action.output_payload or {}, ensure_ascii=False)}\n"
        f"Raw response payload: {json.dumps(action.raw_response_payload or {}, ensure_ascii=False)}\n"
    )

    try:
        answer = service.generate(
            system_prompt=_build_system_prompt(action.run.provider, action.template),
            user_prompt=summary_prompt,
        )
    except Exception as exc:
        error_preview = str(exc or exc.__class__.__name__).strip()[:500]

        answer = (
            "The investigation completed, but the AI summary could not be generated.\n\n"
            f"- Template: `{action.template.name}`\n"
            f"- Code: `{action.template.code}`\n"
            f"- Remote run id: `{action.remote_run_id or 'N/A'}`\n"
            f"- Remote status: `{action.remote_status or 'completed'}`\n"
            f"- Summary error: `{error_preview or exc.__class__.__name__}`\n\n"
            "The raw SOAR result is still available in the action output."
        )

    ChatMessage.objects.create(
        session=action.run.session,
        role="assistant",
        content=answer,
        metadata={
            "run_id": str(action.run.id),
            "action_id": str(action.id),
            "message_kind": "action_result",
        },
    )

    action.run.response_text = answer
    action.run.save(update_fields=["response_text", "updated_at"])


def refresh_chat_action_run(action: ChatActionRun) -> ChatActionRun:
    if action.status not in {"queued", "running"}:
        return action

    action.run.refresh_from_db()
    if action.run.cancel_requested:
        try:
            from .services_soar import SOARService

            SOARService(action.template.soar_provider).cancel_execution(
                template=action.template,
                provider_execution=action.run.provider_execution or {},
            )
        except Exception:
            pass

        action.status = "cancelled"
        action.completed_at = timezone.now()
        action.save(
            update_fields=[
                "status",
                "completed_at",
                "updated_at",
            ]
        )

        if action.run.status not in {"completed", "failed", "cancelled"}:
            action.run.status = "cancelled"
            action.run.completed_at = timezone.now()
            action.run.save(update_fields=["status", "completed_at", "updated_at"])

        return action

    if not action.remote_run_id:
        return action

    template = action.template
    current_provider_execution = action.run.provider_execution or {}

    poll_result = poll_soar_execution(
        template=template,
        provider_execution=current_provider_execution,
    ) or {}

    remote_status = str(poll_result.get("status") or "")
    next_status = _resolve_action_state(template, remote_status)

    merged_provider_execution = {
        **current_provider_execution,
        **poll_result,
    }
    action.run.provider_execution = merged_provider_execution
    action.run.save(update_fields=["provider_execution", "updated_at"])

    action.remote_status = remote_status
    action.raw_response_payload = poll_result.get("poll_response") or action.raw_response_payload or {}

    if next_status == "completed":
        results_payload = collect_soar_result(
            template=template,
            provider_execution=merged_provider_execution,
        )
        action.output_payload = results_payload or {}
        action.status = "completed"
        action.completed_at = timezone.now()
        action.save(
            update_fields=[
                "remote_status",
                "raw_response_payload",
                "output_payload",
                "status",
                "completed_at",
                "updated_at",
            ]
        )
        _publish_action_result_message(action)
        return action

    if next_status == "failed":
        action.status = "failed"
        action.output_payload = poll_result.get("poll_response") or {}
        action.error_message = f"Remote action failed with status: {remote_status or 'unknown'}"
        action.completed_at = timezone.now()
        action.save(
            update_fields=[
                "remote_status",
                "raw_response_payload",
                "output_payload",
                "status",
                "error_message",
                "completed_at",
                "updated_at",
            ]
        )
        return action

    action.status = "running"
    action.save(
        update_fields=[
            "remote_status",
            "raw_response_payload",
            "status",
            "updated_at",
        ]
    )
    return action


def refresh_chat_run_actions(run: ChatRun) -> ChatRun:
    actions = list(run.actions.select_related("template", "template__soar_provider").all())
    for action in actions:
        refresh_chat_action_run(action)
    return run


@transaction.atomic
def create_chat_run(
    *,
    user,
    session: ChatSession,
    request_id: str,
    client_tab_id: str,
    page_type: str,
    object_id: str | None,
    current_tab: str | None,
    inclusions: list[str],
    customer_id: str | None,
    message: str,
    template_code: str | None = None,
    chat_command: str | None = None,
    variables: dict | None = None,
) -> ChatRun:
    snapshot_payload = build_chat_context_snapshot(
        ChatContextRequest(
            user=user,
            page_type=page_type,
            object_id=object_id,
            current_tab=current_tab,
            inclusions=inclusions,
            customer_id=customer_id,
        )
    )
    snapshot_payload = to_json_safe(snapshot_payload)

    parsed_command, parsed_prompt_variables, free_text_message = parse_chat_command(message)

    snapshot = ChatContextSnapshot.objects.create(
        session=session,
        user=user,
        page_type=page_type or "",
        object_id=object_id or "",
        current_tab=current_tab or "",
        inclusions=inclusions or [],
        context_payload=snapshot_payload,
    )

    ChatMessage.objects.create(
        session=session,
        role="user",
        content=message,
        metadata={"request_id": request_id},
    )

    provider = AIProvider.objects.filter(is_enabled=True, is_default=True).first()
    if not provider:
        raise ValueError("No enabled default AI provider configured")

    request_hints: dict = {}
    explicit_template_code = (template_code or "").strip()
    explicit_chat_command = (chat_command or parsed_command or "").strip().lower()

    merged_requested_variables: dict = {}
    if isinstance(parsed_prompt_variables, dict):
        merged_requested_variables.update(parsed_prompt_variables)
    if isinstance(variables, dict):
        merged_requested_variables.update(variables)

    if explicit_template_code:
        request_hints["template_code"] = explicit_template_code
    if explicit_chat_command:
        request_hints["chat_command"] = explicit_chat_command
    if merged_requested_variables:
        request_hints["variables"] = merged_requested_variables

    effective_prompt = free_text_message if parsed_command else message

    run = ChatRun.objects.create(
        session=session,
        snapshot=snapshot,
        user=user,
        request_id=request_id,
        client_tab_id=client_tab_id,
        status="queued",
        provider=provider,
        prompt=effective_prompt,
        provider_execution={"request_hints": request_hints} if request_hints else {},
    )
    return run


def execute_chat_run(run: ChatRun) -> ChatRun:
    run.status = "running"
    run.started_at = timezone.now()
    run.save(update_fields=["status", "started_at", "updated_at"])
    _set_run_progress(run, label="Thinking…")

    try:
        run = _refresh_run_or_raise_cancelled(run)
        conversation_history = _build_recent_conversation_history(run)

        template: InvestigationTemplate | None = None
        template_variables: dict = {}
        template_reason = ""
        action: ChatActionRun | None = None
        action_error = ""

        request_hints = _get_request_hints(run)
        explicit_template_code = str(request_hints.get("template_code") or "").strip()
        explicit_chat_command = str(request_hints.get("chat_command") or "").strip().lower()
        explicit_variables = request_hints.get("variables") or {}
        if not isinstance(explicit_variables, dict):
            explicit_variables = {}

        llm_selected_variables: dict = {}
        llm_inferred_prompt_variables: dict = {}

        if explicit_template_code:
            template = (
                InvestigationTemplate.objects.filter(
                    code=explicit_template_code,
                    is_enabled=True,
                    soar_provider__is_enabled=True,
                )
                .select_related("soar_provider")
                .first()
            )
            if template:
                template_reason = "Selected explicitly by template code."

        if template is None and explicit_chat_command:
            template = (
                InvestigationTemplate.objects.filter(
                    chat_command=explicit_chat_command,
                    is_enabled=True,
                    soar_provider__is_enabled=True,
                )
                .select_related("soar_provider")
                .first()
            )
            if template:
                template_reason = "Selected explicitly by chat command."

        explicit_command_missed = bool(explicit_template_code or explicit_chat_command)

        if template is None and explicit_command_missed:
            _set_run_progress(run, label="Checking available SOAR actions…")
            template, llm_selected_variables, template_reason = _select_investigation_template_with_llm(run)

        if template is not None and (run.prompt or "").strip():
            pre_inference_variables = {
                **_sanitize_variables(template.default_variables or {}, template.allowed_variables_schema or {}),
                **_sanitize_variables(
                    explicit_variables,
                    template.allowed_variables_schema or {},
                    allow_only_keys=set((_get_schema_properties(template.prompt_overrides_schema or {})[0]).keys()) or None,
                ),
            }

            if not _has_all_required_template_variables(template, pre_inference_variables):
                try:
                    llm_inferred_prompt_variables = _infer_template_variables_from_prompt(
                        run,
                        template,
                        run.prompt,
                    )
                except Exception as exc:
                    print("DOKO_TEMPLATE_VARIABLE_INFERENCE_FAILED:", exc)
                    llm_inferred_prompt_variables = {}

        run = _refresh_run_or_raise_cancelled(run)

        if template:
            allowed_schema = template.allowed_variables_schema or {}
            prompt_override_schema = template.prompt_overrides_schema or {}
            allowed_prompt_override_keys = set((_get_schema_properties(prompt_override_schema)[0]).keys())

            sanitized_default_variables = _sanitize_variables(
                template.default_variables or {},
                allowed_schema,
            )
            sanitized_llm_variables = _sanitize_variables(
                llm_selected_variables,
                allowed_schema,
            )
            sanitized_llm_inferred_prompt_variables = _sanitize_variables(
                llm_inferred_prompt_variables,
                allowed_schema,
            )
            sanitized_explicit_variables = _sanitize_variables(
                explicit_variables,
                allowed_schema,
                allow_only_keys=allowed_prompt_override_keys if allowed_prompt_override_keys else None,
            )

            template_variables = {
                **sanitized_default_variables,
                **sanitized_llm_variables,
                **sanitized_llm_inferred_prompt_variables,
                **sanitized_explicit_variables,
            }
            template_variables = _validate_required_template_variables(template, template_variables)

            run.selected_template_code = template.code
            run.selected_command = template.chat_command or ""
            run.save(update_fields=["selected_template_code", "selected_command", "updated_at"])

            try:
                run = _refresh_run_or_raise_cancelled(run)
                _set_run_progress(run, label=f"Launching investigation template: {template.name}")
                action = _execute_investigation_template(run, template, template_variables)
                run = _refresh_run_or_raise_cancelled(run)

                if action and action.status == "running":
                    action = _wait_for_action_completion(run, action)
                    run.refresh_from_db()

            except Exception as exc:
                action_error = f"Investigation execution failed: {exc}"
        else:
            run.selected_template_code = ""
            run.selected_command = ""
            run.save(update_fields=["selected_template_code", "selected_command", "updated_at"])

        run = _refresh_run_or_raise_cancelled(run)

        if template and action and action.status == "running":
            answer = (
                "The investigation has been launched successfully.\n\n"
                f"- Template: `{template.name}`\n"
                f"- Code: `{template.code}`\n"
                f"- Remote run id: `{action.remote_run_id or 'N/A'}`\n"
                f"- Status: `{action.remote_status or 'running'}`\n\n"
                "The result is not available yet."
            )
        elif action_error:
            answer = (
                "The investigation template execution failed.\n\n"
                f"- Template: `{template.name if template else ''}`\n"
                f"- Code: `{template.code if template else ''}`\n"
                f"- Error: `{action_error}`"
            )
        elif run.cancel_requested or run.status == "cancelled":
            answer = "The request was cancelled."
        elif template and action and action.status == "completed":
            _set_run_progress(run, label="Summarizing result…")
            service = LLMService(run.provider)
            action_context = (
                "\n\nAn investigation template was executed successfully.\n"
                f"Template name: {template.name}\n"
                f"Template code: {template.code}\n"
                f"Selection reason: {template_reason}\n"
                f"Variables: {json.dumps(template_variables, ensure_ascii=False)}\n"
                f"SOAR response: {json.dumps(action.output_payload, ensure_ascii=False)}\n"
                "Explain the result clearly to the analyst.\n"
            )
            answer = service.generate(
                system_prompt=_build_system_prompt(run.provider, template),
                user_prompt=_format_prompt(
                    run.snapshot.context_payload,
                    run.prompt,
                    conversation_history,
                ) + action_context,
            )
            _set_run_progress(
                run,
                label="Finalizing response…",
                preview=(getattr(service, "last_response_preview", "") or strip_tags(answer or ""))[:2000],
            )

        else:
            _set_run_progress(run, label="Generating response…")
            service = LLMService(run.provider)
            action_context = "\n\nNo investigation template was executed.\nRespond normally.\n"
            answer = service.generate(
                system_prompt=_build_system_prompt(run.provider, template),
                user_prompt=_format_prompt(
                    run.snapshot.context_payload,
                    run.prompt,
                    conversation_history,
                ) + action_context,
            )
            _set_run_progress(
                run,
                label="Finalizing response…",
                preview=(getattr(service, "last_response_preview", "") or strip_tags(answer or ""))[:2000],
            )

        run.response_text = answer
        run.status = "completed"
        run.completed_at = timezone.now()
        run.save(update_fields=["response_text", "status", "completed_at", "updated_at"])

        ChatMessage.objects.create(
            session=run.session,
            role="assistant",
            content=answer,
            metadata={"run_id": str(run.id)},
        )

        _set_run_progress(run, label="Completed", preview=strip_tags(answer or "")[:2000])

        return run

    except ChatRunCancelled:
        run.refresh_from_db()
        if run.status != "cancelled":
            run.status = "cancelled"
            run.completed_at = timezone.now()
            run.save(update_fields=["status", "completed_at", "updated_at"])
        return run

    except Exception as exc:
        run.status = "failed"
        run.error_message = str(exc)
        run.completed_at = timezone.now()
        run.save(update_fields=["status", "error_message", "completed_at", "updated_at"])
        return run


def generate_comment_draft(*, run: ChatRun, target_type: str, target_id: str) -> ChatGeneratedDraft:
    if not run.response_text:
        raise ValueError("Run has no assistant response")
    return ChatGeneratedDraft.objects.create(
        run=run,
        target_type=target_type,
        target_id=target_id,
        content=run.response_text,
    )