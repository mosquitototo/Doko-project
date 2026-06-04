import copy
import datetime
import requests

from django.core.exceptions import ValidationError
from django.utils import timezone

from .crypto_secrets import decrypt_secret
from .models import SOARProvider, InvestigationTemplate
from .outbound_proxy import build_outbound_proxies


DEFAULT_RUN_ID_PATHS = [
    "playbook_run_id",
    "run_id",
    "id",
    "data.playbook_run_id",
    "data.run_id",
    "data.id",
]

DEFAULT_STATUS_PATHS = [
    "status",
    "state",
    "result",
    "data.status",
    "data.state",
    "data.result",
]

DEFAULT_RESULT_ITEMS_PATHS = [
    "items",
    "results",
    "data.items",
    "data.results",
    "records",
    "data.records",
]


def validate_soar_provider_url(url: str):
    value = str(url or "").strip().lower()

    if not value.startswith(("http://", "https://")):
        raise ValidationError("SOAR endpoint must start with http:// or https://")


def launch_soar_execution(*, run, template, variables: dict, prompt: str) -> dict:
    service = SOARService(template.soar_provider)
    return service.launch_execution(
        run=run,
        template=template,
        variables=variables,
        prompt=prompt,
    )


def poll_soar_execution(*, template, provider_execution: dict) -> dict:
    service = SOARService(template.soar_provider)
    return service.poll_execution(
        template=template,
        provider_execution=provider_execution,
    )


def collect_soar_result(*, template, provider_execution: dict) -> dict:
    service = SOARService(template.soar_provider)
    return service.collect_result(
        template=template,
        provider_execution=provider_execution,
    )


def stringify(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def template_get(context: dict, key: str, default=""):
    return (context.get("template") or {}).get(key, default)


def secret_get(context: dict, key: str, default=""):
    return (context.get("secret") or {}).get(key, default)


def _split_path(path: str) -> list[str]:
    return [part for part in str(path or "").split(".") if part]


def _path_get(data, path: str, default=None):
    current = data
    for part in _split_path(path):
        if isinstance(current, list):
            if not part.isdigit():
                return default
            index = int(part)
            if index < 0 or index >= len(current):
                return default
            current = current[index]
            continue

        if isinstance(current, dict):
            if part not in current:
                return default
            current = current[part]
            continue

        return default
    return current


def _first_non_empty_path(data, paths: list[str], default=None):
    for path in paths:
        value = _path_get(data, path, None)
        if value not in (None, "", [], {}):
            return value
    return default


def _ensure_list(value) -> list:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _normalize_request_config(config: dict | None) -> dict:
    config = config or {}
    if not isinstance(config, dict):
        return {}
    if "request" in config and isinstance(config.get("request"), dict):
        return config.get("request") or {}
    return config


def _plain_launch_variables_payload(variables: dict | None) -> dict:
    if not isinstance(variables, dict):
        return {}

    payload = {}

    for key, value in variables.items():
        key = str(key or "").strip()

        if not key:
            continue

        if key.startswith("_"):
            continue

        if key in {"scope", "event"}:
            continue

        if value in (None, "", [], {}):
            continue

        if isinstance(value, (str, int, float, bool, list, dict)):
            payload[key] = copy.deepcopy(value)

    return payload


def _required_launch_fields(template: InvestigationTemplate) -> list[str]:
    execution_config = template.execution_config or {}

    if not isinstance(execution_config, dict):
        return []

    fields = execution_config.get("required_launch_fields") or []

    if not isinstance(fields, list):
        return []

    return [
        str(item).strip()
        for item in fields
        if str(item or "").strip()
    ]


def _validate_required_launch_fields(template: InvestigationTemplate, payload: dict):
    if not isinstance(payload, dict):
        payload = {}

    missing = [
        field
        for field in _required_launch_fields(template)
        if _path_get(payload, field, None) in (None, "", [], {})
    ]

    if missing:
        raise ValidationError(
            "Missing required SOAR launch field(s): " + ", ".join(missing)
        )


def _first_launch_variable(variables: dict, keys: list[str]) -> str:
    if not isinstance(variables, dict):
        return ""

    for key in keys:
        value = variables.get(key)
        if value not in (None, "", [], {}):
            return stringify(value).strip()

    return ""


def _infer_target_object_field(template: InvestigationTemplate) -> str:
    execution_config = template.execution_config or {}
    if isinstance(execution_config, dict):
        required_fields = execution_config.get("required_launch_fields") or []
        if isinstance(required_fields, list):
            for field in required_fields:
                field = stringify(field).strip()
                if field:
                    return field

    mapping = template.input_mapping or {}
    if not isinstance(mapping, dict):
        return ""

    preferred_fields = [
        "container_id",
        "incident_id",
        "case_id",
        "object_id",
        "target_object_id",
    ]

    for field in preferred_fields:
        if field in mapping:
            return field

    return ""


def _build_launch_fields_payload(template: InvestigationTemplate, variables: dict) -> dict:
    execution_config = template.execution_config or {}

    if not isinstance(execution_config, dict):
        execution_config = {}

    launch_fields = execution_config.get("launch_fields") or {}

    if not isinstance(launch_fields, dict):
        launch_fields = {}

    remote_template_field = str(
        launch_fields.get("remote_template_field") or ""
    ).strip()

    target_object_field = str(
        launch_fields.get("target_object_field") or ""
    ).strip()

    if not target_object_field:
        target_object_field = _infer_target_object_field(template)

    payload = {}

    if remote_template_field:
        remote_template_code = stringify(template.remote_template_code).strip()
        if remote_template_code:
            payload[remote_template_field] = remote_template_code

    if target_object_field:
        target_object_id = _first_launch_variable(
            variables,
            [
                "target_object_id",
                target_object_field,
                "container_id",
                "incident_id",
                "case_id",
                "object_id",
            ],
        )

        if target_object_id:
            payload[target_object_field] = target_object_id

    observable_value = variables.get("observable_value") or variables.get("target_value")
    observable_type = variables.get("observable_type") or variables.get("target_type")

    if observable_value not in (None, "", [], {}):
        payload["observable_value"] = copy.deepcopy(observable_value)

    if observable_type not in (None, "", [], {}):
        payload["observable_type"] = copy.deepcopy(observable_type)

    return payload


def _template_launch_identifier_payload(
    *,
    provider: SOARProvider,
    template: InvestigationTemplate,
    mapped_payload: dict,
) -> dict:
    remote_template_code = stringify(template.remote_template_code).strip()

    if not remote_template_code:
        return {}

    if isinstance(mapped_payload, dict):
        existing_values = {
            stringify(value).strip()
            for value in mapped_payload.values()
            if value not in (None, "", [], {})
        }
        if remote_template_code in existing_values:
            return {}

    provider_kind = stringify(provider.provider_kind).strip()

    if provider_kind == "splunk_soar":
        return {
            "playbook_id": remote_template_code,
        }

    return {
        "remote_template_code": remote_template_code,
    }


class SOARService:
    def __init__(self, provider: SOARProvider):
        self.provider = provider
        validate_soar_provider_url(provider.base_url)

    def _secret_context(self) -> dict:
        secret_value = ""
        if self.provider.auth_secret_ref:
            secret_value = decrypt_secret(self.provider.auth_secret_ref) or ""

        return {
            "value": secret_value,
            "api_key": secret_value,
            "token": secret_value,
            "username": self.provider.auth_config.get("username", ""),
            "password": self.provider.auth_config.get("password", ""),
        }

    def _render_string(self, value: str, context: dict) -> str:
        rendered = str(value)

        replacements = {
            "{base_url}": self.provider.base_url.rstrip("/"),
            "{template.remote_template_code}": str(template_get(context, "remote_template_code", "")),
            "{template.code}": str(template_get(context, "code", "")),
            "{template.name}": str(template_get(context, "name", "")),
            "{template.entity_type}": str(template_get(context, "entity_type", "")),
            "{template.target_kind}": str(template_get(context, "target_kind", "")),
            "{remote_run_id}": str(context.get("remote_run_id") or ""),
            "{prompt}": str(context.get("prompt") or ""),
            "{secret.value}": str(secret_get(context, "value", "")),
            "{secret.api_key}": str(secret_get(context, "api_key", "")),
            "{secret.token}": str(secret_get(context, "token", "")),
            "{secret.username}": str(secret_get(context, "username", "")),
            "{secret.password}": str(secret_get(context, "password", "")),
        }

        run_context = context.get("run") or {}
        replacements["{run.id}"] = str(run_context.get("id") or "")
        replacements["{run.request_id}"] = str(run_context.get("request_id") or "")

        for key, replacement in replacements.items():
            rendered = rendered.replace(key, replacement)

        variables = context.get("variables", {}) or {}
        for key, replacement in variables.items():
            rendered = rendered.replace(f"{{variables.{key}}}", stringify(replacement))

        provider_execution = context.get("provider_execution", {}) or {}
        for key, replacement in provider_execution.items():
            rendered = rendered.replace(f"{{provider_execution.{key}}}", stringify(replacement))

        return rendered

    def _render_value(self, value, context: dict):
        if isinstance(value, str):
            if value == "{variables}":
                return copy.deepcopy(context.get("variables") or {})
            if value == "{prompt}":
                return context.get("prompt") or ""
            if value == "{provider_execution}":
                return copy.deepcopy(context.get("provider_execution") or {})
            if value == "{launch_response}":
                return copy.deepcopy(context.get("launch_response") or {})
            return self._render_string(value, context)

        if isinstance(value, list):
            return [self._render_value(item, context) for item in value]

        if isinstance(value, dict):
            return {key: self._render_value(item, context) for key, item in value.items()}

        return value

    def _build_headers_from_config(self, request_config: dict, context: dict) -> dict:
        headers = copy.deepcopy(request_config.get("headers", {})) or {}

        auth_type = self.provider.auth_type
        secret = context["secret"]
        auth_config = self.provider.auth_config or {}

        if auth_type == "bearer" and secret.get("token"):
            headers.setdefault("Authorization", f"Bearer {secret['token']}")
        elif auth_type == "header" and secret.get("value"):
            header_name = auth_config.get("header_name", "Authorization")
            header_prefix = auth_config.get("header_prefix", "")
            header_value = f"{header_prefix}{secret['value']}"
            headers.setdefault(header_name, header_value)

        headers.setdefault("Content-Type", "application/json")
        return self._render_value(headers, context)

    def _build_auth(self, context: dict):
        if self.provider.auth_type != "basic":
            return None

        secret = context["secret"]
        username = secret.get("username") or self.provider.auth_config.get("username", "")
        password = secret.get("password") or secret.get("value") or ""
        if not username and not password:
            return None
        return (username, password)

    def _build_context(
        self,
        *,
        template: InvestigationTemplate,
        variables: dict | None = None,
        prompt: str = "",
        remote_run_id: str = "",
        provider_execution: dict | None = None,
        launch_response: dict | None = None,
        run=None,
    ) -> dict:
        return {
            "template": {
                "remote_template_code": template.remote_template_code,
                "code": template.code,
                "name": template.name,
                "entity_type": template.entity_type,
                "target_kind": template.target_kind,
            },
            "variables": copy.deepcopy(variables or {}),
            "prompt": prompt or "",
            "remote_run_id": remote_run_id or "",
            "provider_execution": copy.deepcopy(provider_execution or {}),
            "launch_response": copy.deepcopy(launch_response or {}),
            "secret": self._secret_context(),
            "run": {
                "id": getattr(run, "id", ""),
                "request_id": getattr(run, "request_id", ""),
            },
        }

    def _perform_request(self, request_config: dict, context: dict, *, default_method: str = "GET") -> dict:
        normalized_config = _normalize_request_config(request_config)
        method = (normalized_config.get("method") or default_method).upper().strip() or default_method
        url_template = normalized_config.get("url_template")
        if not url_template:
            raise ValidationError("Missing url_template in SOAR request configuration")

        url = self._render_string(url_template, context)
        headers = self._build_headers_from_config(normalized_config, context)
        params = self._render_value(copy.deepcopy(normalized_config.get("query_params", {})) or {}, context)
        body_template = normalized_config.get("body_template", None)
        payload = self._render_value(body_template, context) if body_template is not None else None

        if method in {"POST", "PUT", "PATCH"} and payload in (None, "", {}, []):
            raise ValidationError(
                "SOAR launch payload is empty. Refusing to run without a target object and playbook input fields."
            )

        auth = self._build_auth(context)

        safe_headers = dict(headers)
        sensitive_header_names = {
            "authorization",
            "proxy-authorization",
            "ph-auth-token",
            "x-api-key",
            "x-n8n-api-key",
            "api-key",
            "apikey",
        }

        auth_config = self.provider.auth_config or {}
        configured_header_name = str(auth_config.get("header_name") or "").strip().lower()
        if configured_header_name:
            sensitive_header_names.add(configured_header_name)

        for key in list(safe_headers.keys()):
            normalized_key = str(key or "").strip().lower()
            if (
                normalized_key in sensitive_header_names
                or "token" in normalized_key
                or "secret" in normalized_key
                or "key" in normalized_key
            ):
                safe_headers[key] = "***masked***"

        print("DOKO_SOAR_HTTP_REQUEST:", {
            "method": method,
            "url": url,
            "auth_type": self.provider.auth_type,
            "headers": safe_headers,
            "params": params,
            "payload": payload,
            "has_basic_auth": bool(auth),
        })

        timeout_seconds = min(max(int(self.provider.timeout_seconds or 30), 1), 90)

        response = requests.request(
            method=method,
            url=url,
            headers=headers,
            params=params,
            json=payload,
            auth=auth,
            timeout=timeout_seconds,
            allow_redirects=False,
            proxies=build_outbound_proxies(),
        )

        print("DOKO_SOAR_HTTP_RESPONSE_STATUS:", response.status_code)
        print("DOKO_SOAR_HTTP_RESPONSE_TEXT_PREVIEW:", response.text[:2000])

        response.raise_for_status()

        try:
            data = response.json()
        except ValueError:
            data = {
                "raw_text": response.text,
            }

        return {
            "request": {
                "method": method,
                "url": url,
                "params": params,
                "payload": payload,
            },
            "response": data,
        }

    def _get_launch_run_id_paths(self) -> list[str]:
        response_config = self.provider.response_config or {}
        return _ensure_list(
            response_config.get("launch_run_id_paths")
            or response_config.get("run_id_paths")
            or DEFAULT_RUN_ID_PATHS
        )

    def _get_launch_status_paths(self) -> list[str]:
        response_config = self.provider.response_config or {}
        return _ensure_list(
            response_config.get("launch_status_paths")
            or response_config.get("status_paths")
            or DEFAULT_STATUS_PATHS
        )

    def _get_poll_status_paths(self) -> list[str]:
        response_config = self.provider.response_config or {}
        status_config = self.provider.status_config or {}
        return _ensure_list(
            status_config.get("status_paths")
            or response_config.get("poll_status_paths")
            or response_config.get("status_paths")
            or DEFAULT_STATUS_PATHS
        )

    def _get_result_items_paths(self) -> list[str]:
        response_config = self.provider.response_config or {}
        return _ensure_list(
            response_config.get("result_items_paths")
            or response_config.get("items_paths")
            or DEFAULT_RESULT_ITEMS_PATHS
        )

    def _extract_external_run_id(self, response_payload: dict) -> str:
        value = _first_non_empty_path(response_payload, self._get_launch_run_id_paths(), "")
        return stringify(value).strip()

    def _extract_remote_status_from_launch(self, response_payload: dict) -> str:
        value = _first_non_empty_path(response_payload, self._get_launch_status_paths(), "")
        return stringify(value).strip()

    def _extract_remote_status_from_poll(self, response_payload: dict) -> str:
        value = _first_non_empty_path(response_payload, self._get_poll_status_paths(), "")
        return stringify(value).strip()

    def _extract_result_items(self, response_payload):
        if isinstance(response_payload, list):
            return response_payload

        if not isinstance(response_payload, dict):
            return None

        for path in self._get_result_items_paths():
            value = _path_get(response_payload, path, None)
            if isinstance(value, list):
                return value

        return None

    def _filter_result_items(self, template: InvestigationTemplate, provider_execution: dict, items: list) -> list:
        execution_config = template.execution_config or {}
        correlation = execution_config.get("correlation") or {}

        external_run_id = stringify(provider_execution.get("external_run_id") or "").strip()
        remote_template_code = stringify(provider_execution.get("remote_template_code") or "").strip()
        started_at = stringify(provider_execution.get("started_at") or "").strip()

        run_id_field = correlation.get("run_id_field")
        item_run_id_paths = _ensure_list(
            correlation.get("item_run_id_paths")
            or ([run_id_field] if run_id_field else [])
            or ["playbook_run_id", "run_id", "id"]
        )
        item_name_paths = _ensure_list(
            correlation.get("item_name_paths")
            or ["playbook_id", "name", "template", "workflow"]
        )
        item_started_at_paths = _ensure_list(
            correlation.get("item_started_at_paths")
            or ["start_time", "started_at", "created_at"]
        )

        if external_run_id:
            filtered = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                item_run_id = stringify(_first_non_empty_path(item, item_run_id_paths, "")).strip()
                if item_run_id == external_run_id:
                    filtered.append(item)
            if filtered:
                return filtered

        filtered = []
        for item in items:
            if not isinstance(item, dict):
                continue

            item_name = stringify(_first_non_empty_path(item, item_name_paths, "")).strip()
            item_started_at = stringify(_first_non_empty_path(item, item_started_at_paths, "")).strip()

            same_name = not remote_template_code or item_name == remote_template_code
            started_ok = not started_at or (item_started_at and item_started_at >= started_at)

            if same_name and started_ok:
                filtered.append(item)

        return filtered or items




    def _resolve_input_mapping_rule(self, rule, *, template: InvestigationTemplate, variables: dict, prompt: str):
        if isinstance(rule, dict):
            if "from_variable" in rule:
                value = variables.get(rule.get("from_variable"))
                if value not in (None, "", [], {}):
                    return value

            if "fallback_template_field" in rule:
                field_name = str(rule.get("fallback_template_field") or "").strip()
                if field_name and hasattr(template, field_name):
                    fallback_value = getattr(template, field_name, None)
                    if fallback_value not in (None, "", [], {}):
                        return fallback_value

            if "value" in rule:
                value = rule.get("value")
                if value not in (None, "", [], {}):
                    return copy.deepcopy(value)

            result = {}
            for key, value in rule.items():
                if key in {"from_variable", "fallback_template_field", "value"}:
                    continue
                resolved = self._resolve_input_mapping_rule(
                    value,
                    template=template,
                    variables=variables,
                    prompt=prompt,
                )
                if resolved not in (None, "", [], {}):
                    result[key] = resolved
            return result or None

        if isinstance(rule, list):
            items = []
            for item in rule:
                resolved = self._resolve_input_mapping_rule(
                    item,
                    template=template,
                    variables=variables,
                    prompt=prompt,
                )
                if resolved not in (None, "", [], {}):
                    items.append(resolved)
            return items or None

        if isinstance(rule, str):
            if rule == "{prompt}":
                return prompt
            return rule

        if rule not in (None, "", [], {}):
            return copy.deepcopy(rule)

        return None


    def _build_template_launch_payload(self, *, template: InvestigationTemplate, variables: dict, prompt: str) -> dict:
        mapping = template.input_mapping or {}
        if not isinstance(mapping, dict):
            return {}

        payload = {}
        for key, rule in mapping.items():
            resolved = self._resolve_input_mapping_rule(
                rule,
                template=template,
                variables=variables or {},
                prompt=prompt or "",
            )
            if resolved not in (None, "", [], {}):
                payload[key] = resolved

        return payload



    def launch_execution(self, *, run, template: InvestigationTemplate, variables: dict, prompt: str) -> dict:
        request_config = copy.deepcopy(self.provider.request_config or {})
        normalized_request_config = _normalize_request_config(request_config)

        if not (template.remote_template_code or template.code or template.name):
            raise ValidationError("Investigation template has no playbook identifier.")

        template_defaults = template.default_variables or {}
        if not isinstance(template_defaults, dict):
            template_defaults = {}

        launch_variables = {
            **copy.deepcopy(template_defaults),
            **copy.deepcopy(variables or {}),
        }

        mapped_payload = self._build_template_launch_payload(
            template=template,
            variables=launch_variables,
            prompt=prompt or "",
        )

        mapping_produced_payload = bool(mapped_payload)

        if not mapping_produced_payload:
            launch_fields_payload = _build_launch_fields_payload(
                template,
                launch_variables,
            )

            mapped_payload = {
                **launch_fields_payload,
                **mapped_payload,
            }
        else:
            launch_fields_payload = {}

        if not normalized_request_config:
            normalized_request_config = {
                "method": "POST",
                "url_template": "{base_url}/rest/playbook_run",
            }

        template_identifier_payload = {}
        if not mapped_payload:
            template_identifier_payload = _template_launch_identifier_payload(
                provider=self.provider,
                template=template,
                mapped_payload=mapped_payload,
            )

        default_payload = {
            **template_identifier_payload,
            **mapped_payload,
        }

        print("DOKO_SOAR_LAUNCH_PAYLOAD_BUILD:", {
            "source": "chat" if run is not None else "automation",
            "template_id": str(getattr(template, "id", "") or ""),
            "template_code": template.code,
            "remote_template_code": template.remote_template_code,
            "provider_kind": self.provider.provider_kind,
            "mapping_produced_payload": mapping_produced_payload,
            "launch_fields_payload": launch_fields_payload,
            "template_identifier_payload": template_identifier_payload,
            "mapped_payload": mapped_payload,
            "default_payload": default_payload,
            "input_mapping": template.input_mapping or {},
            "execution_config": template.execution_config or {},
            "request_body_template": normalized_request_config.get("body_template"),
        })

        current_body_template = normalized_request_config.get("body_template", None)

        if current_body_template in (None, "", {}):
            normalized_request_config["body_template"] = default_payload
        elif isinstance(current_body_template, dict):
            body_template = copy.deepcopy(current_body_template)

            has_payload_container = "payload" in body_template

            if has_payload_container:
                normalized_request_config["body_template"] = body_template
            else:
                normalized_request_config["body_template"] = {
                    **default_payload,
                    **body_template,
                }

        context = self._build_context(
            template=template,
            variables=launch_variables,
            prompt=prompt or "",
            run=run,
        )

        preview_payload = self._render_value(
            normalized_request_config.get("body_template"),
            context,
        )
        _validate_required_launch_fields(template, preview_payload)

        result = self._perform_request(normalized_request_config, context, default_method="POST")
        response_payload = result["response"]

        external_run_id = self._extract_external_run_id(response_payload)
        remote_status = self._extract_remote_status_from_launch(response_payload) or "running"

        return {
            "provider_kind": self.provider.provider_kind,
            "external_run_id": external_run_id,
            "remote_template_code": (
                launch_variables.get("playbook_id")
                or launch_variables.get("playbook_name")
                or template.remote_template_code
            ),
            "started_at": timezone.now().isoformat(),
            "status": remote_status,
            "variables": copy.deepcopy(launch_variables),
            "launch_request": result["request"],
            "launch_response": response_payload,
        }


    def poll_execution(self, *, template: InvestigationTemplate, provider_execution: dict) -> dict:
        status_config = self.provider.status_config or {}
        status_request_config = _normalize_request_config(status_config)

        if not status_request_config:
            return {
                **(provider_execution or {}),
                "status": provider_execution.get("status") or "completed",
            }

        external_run_id = stringify(provider_execution.get("external_run_id") or "").strip()
        variables = provider_execution.get("variables") or {}
        launch_response = provider_execution.get("launch_response") or {}

        context = self._build_context(
            template=template,
            variables=variables,
            remote_run_id=external_run_id,
            provider_execution=provider_execution,
            launch_response=launch_response,
        )

        result = self._perform_request(status_request_config, context, default_method="GET")
        response_payload = result["response"]
        remote_status = self._extract_remote_status_from_poll(response_payload) or provider_execution.get("status") or "running"

        return {
            "provider_kind": self.provider.provider_kind,
            "external_run_id": external_run_id,
            "remote_template_code": provider_execution.get("remote_template_code") or template.remote_template_code,
            "started_at": provider_execution.get("started_at") or timezone.now().isoformat(),
            "status": remote_status,
            "variables": copy.deepcopy(variables or {}),
            "launch_request": provider_execution.get("launch_request") or {},
            "launch_response": launch_response,
            "poll_request": result["request"],
            "poll_response": response_payload,
        }

    def collect_result(self, *, template: InvestigationTemplate, provider_execution: dict) -> dict:
        status_config = self.provider.status_config or {}
        result_request = (
            status_config.get("result_request")
            or (self.provider.response_config or {}).get("result_request")
            or {}
        )

        variables = provider_execution.get("variables") or {}
        external_run_id = stringify(provider_execution.get("external_run_id") or "").strip()
        launch_response = provider_execution.get("launch_response") or {}

        if result_request:
            context = self._build_context(
                template=template,
                variables=variables,
                remote_run_id=external_run_id,
                provider_execution=provider_execution,
                launch_response=launch_response,
            )
            result = self._perform_request(result_request, context, default_method="GET")
            response_payload = result["response"]
        else:
            response_payload = (
                provider_execution.get("poll_response")
                or provider_execution.get("launch_response")
                or {}
            )

        mapped = self._extract_output_mapping(template, response_payload)

        print("DOKO_SOAR_RESULT_RESPONSE:", response_payload)
        print("DOKO_SOAR_RESULT_MAPPED:", mapped)
        
        return {
            "run_id": external_run_id,
            **mapped,
        }


    def _extract_output_mapping(self, template: InvestigationTemplate, response_payload):
        mapping = template.output_mapping or {}
        if not isinstance(mapping, dict):
            return {
                "raw": response_payload,
                "outputs": _path_get(response_payload, "outputs", None),
                "status": _path_get(response_payload, "status", None),
                "message": _path_get(response_payload, "message", None),
                "inputs": _path_get(response_payload, "inputs", None),
                "playbook": _path_get(response_payload, "playbook", None),
                "container": _path_get(response_payload, "container", None),
                "start_time": _path_get(response_payload, "start_time", None),
                "update_time": _path_get(response_payload, "update_time", None),
            }

        def pick(path_key: str, default_path: str):
            path = str(mapping.get(path_key) or default_path).strip()
            if path == "$":
                return response_payload
            return _path_get(response_payload, path, None)

        return {
            "raw": pick("raw_path", "$"),
            "outputs": pick("outputs_path", "outputs"),
            "status": pick("status_path", "status"),
            "message": pick("message_path", "message"),
            "inputs": pick("inputs_path", "inputs"),
            "playbook": pick("playbook_path", "playbook"),
            "container": pick("container_path", "container"),
            "start_time": pick("start_time_path", "start_time"),
            "update_time": pick("update_time_path", "update_time"),
        }


    def execute_template(self, template: InvestigationTemplate, variables: dict) -> dict:
        result = self.launch_execution(
            run=None,
            template=template,
            variables=variables or {},
            prompt="",
        )
        return {
            "status": "success",
            "request": result.get("launch_request") or {},
            "response": result.get("launch_response") or {},
        }

    def get_run_status(self, template: InvestigationTemplate, remote_run_id: str) -> dict:
        provider_execution = {
            "external_run_id": remote_run_id,
            "remote_template_code": template.remote_template_code,
            "variables": {},
            "status": "running",
        }
        result = self.poll_execution(
            template=template,
            provider_execution=provider_execution,
        )
        return {
            "status": "success",
            "request": result.get("poll_request") or {},
            "response": result.get("poll_response") or {},
        }

    def get_run_results(self, template: InvestigationTemplate, remote_run_id: str) -> dict:
        provider_execution = {
            "external_run_id": remote_run_id,
            "remote_template_code": template.remote_template_code,
            "variables": {},
            "status": "running",
        }
        response = self.collect_result(
            template=template,
            provider_execution=provider_execution,
        )
        return {
            "status": "success",
            "request": {},
            "response": response or {},
        }

    def cancel_execution(self, *, template: InvestigationTemplate, provider_execution: dict) -> dict:
        status_config = self.provider.status_config or {}
        cancel_request = status_config.get("cancel_request") or {}

        if not cancel_request:
            return {"status": "not_supported", "response": {}}

        context = self._build_context(
            template=template,
            variables=provider_execution.get("variables") or {},
            remote_run_id=str(provider_execution.get("external_run_id") or ""),
            provider_execution=provider_execution,
            launch_response=provider_execution.get("launch_response") or {},
        )

        result = self._perform_request(cancel_request, context, default_method="POST")
        return {
            "status": "success",
            "request": result["request"],
            "response": result["response"],
        }