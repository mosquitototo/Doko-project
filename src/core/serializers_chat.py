from urllib.parse import urlsplit, urlunsplit
import re

from rest_framework import serializers
from .models import (
    AIProvider,
    SOARProvider,
    InvestigationTemplate,
    ChatSession,
    ChatMessage,
    ChatRun,
    ChatGeneratedDraft,
    ChatActionRun,
)
from .crypto_secrets import encrypt_secret



DEFAULT_SOAR_REQUEST_CONFIG = {
    "method": "POST",
    "url_template": "{base_url}",
    "headers": {},
    "body_template": {
        "event_type": "doko.investigation.execute",
        "template": {
            "code": "{template.code}",
            "name": "{template.name}",
            "remote_template_code": "{template.remote_template_code}",
        },
        "payload": "{variables}",
        "prompt": "{prompt}",
        "metadata": {
            "source": "doko",
            "run_id": "{run.id}",
            "request_id": "{run.request_id}",
        },
    },
}

DEFAULT_TEMPLATE_INPUT_MAPPING = {
    "payload": {
        "from_variable": "payload",
    },
}

DEFAULT_TEMPLATE_OUTPUT_MAPPING = {}

DEFAULT_TEMPLATE_STATUS_MAPPING = {}

DEFAULT_TEMPLATE_EXECUTION_CONFIG = {}


DOCKER_HOST_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9-]{0,62}$")


def validate_soar_base_url(value: str) -> str:
    raw = (value or "").strip()

    if not raw:
        raise serializers.ValidationError("Base URL is required.")

    parsed = urlsplit(raw)

    if parsed.scheme not in {"http", "https"}:
        raise serializers.ValidationError("Base URL must start with http:// or https://.")

    if not parsed.hostname:
        raise serializers.ValidationError("Base URL must include a hostname.")

    if parsed.username or parsed.password:
        raise serializers.ValidationError("Credentials are not allowed in the base URL.")

    if parsed.query or parsed.fragment:
        raise serializers.ValidationError("Query string and fragment are not allowed in the base URL.")

    hostname = parsed.hostname
    is_internal_hostname = bool(DOCKER_HOST_RE.match(hostname))
    is_standard_hostname = "." in hostname or hostname == "localhost"

    if not is_internal_hostname and not is_standard_hostname:
        raise serializers.ValidationError("Base URL hostname is invalid.")

    try:
        port = parsed.port
    except ValueError:
        raise serializers.ValidationError("Base URL port is invalid.")

    if port is not None and not (1 <= port <= 65535):
        raise serializers.ValidationError("Base URL port is invalid.")

    normalized_path = parsed.path.rstrip("/")
    normalized_netloc = parsed.netloc.lower()

    return urlunsplit(
        (
            parsed.scheme.lower(),
            normalized_netloc,
            normalized_path,
            "",
            "",
        )
    )


def _default_template_input_mapping(remote_field: str, target_field: str) -> dict:
    remote_field = (remote_field or "").strip()
    target_field = (target_field or "container_id").strip()

    mapping = {
        target_field: {
            "from_variable": target_field,
        },
        "doko_output": {
            "from_variable": "doko_output",
        },
        "observable_value": {
            "from_variable": "observable_value",
        },
        "observable_type": {
            "from_variable": "observable_type",
        },
    }

    if remote_field:
        mapping[remote_field] = {
            "fallback_template_field": "remote_template_code",
        }

    return mapping


class AIProviderSerializer(serializers.ModelSerializer):
    api_key = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = AIProvider
        fields = [
            "id",
            "name",
            "code",
            "provider_kind",
            "base_url",
            "default_model",
            "timeout_seconds",
            "is_enabled",
            "is_default",
            "api_key",
            "created_at",
            "updated_at",
            "default_system_prompt",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def create(self, validated_data):
        api_key = (validated_data.pop("api_key", "") or "").strip()
        instance = AIProvider(**validated_data)

        if api_key:
            instance.api_key_secret_ref = encrypt_secret(api_key)

        instance.save()

        if instance.is_default:
            AIProvider.objects.exclude(id=instance.id).update(is_default=False)

        return instance

    def update(self, instance, validated_data):
        api_key = validated_data.pop("api_key", None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if api_key is not None:
            api_key = str(api_key).strip()
            instance.api_key_secret_ref = encrypt_secret(api_key) if api_key else ""

        instance.save()

        if instance.is_default:
            AIProvider.objects.exclude(id=instance.id).update(is_default=False)

        return instance


class SOARProviderSerializer(serializers.ModelSerializer):
    api_key = serializers.CharField(write_only=True, required=False, allow_blank=True)
    base_url = serializers.CharField(max_length=2048)
    auth_config = serializers.JSONField(required=False)
    request_config = serializers.JSONField(required=False)
    response_config = serializers.JSONField(required=False)
    status_config = serializers.JSONField(required=False)

    class Meta:
        model = SOARProvider
        fields = [
            "id",
            "name",
            "code",
            "provider_kind",
            "base_url",
            "auth_type",
            "auth_config",
            "request_config",
            "response_config",
            "status_config",
            "timeout_seconds",
            "is_enabled",
            "api_key",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_base_url(self, value):
        return validate_soar_base_url(value)

    def validate(self, attrs):
        is_create = self.instance is None

        if is_create:
            if not attrs.get("provider_kind"):
                attrs["provider_kind"] = "generic_http"
            if not attrs.get("auth_type"):
                attrs["auth_type"] = "bearer"
            if not attrs.get("auth_config"):
                attrs["auth_config"] = {}
            if not attrs.get("request_config"):
                attrs["request_config"] = DEFAULT_SOAR_REQUEST_CONFIG
            if not attrs.get("response_config"):
                attrs["response_config"] = {}
            if not attrs.get("status_config"):
                attrs["status_config"] = {}
            if not attrs.get("timeout_seconds"):
                attrs["timeout_seconds"] = 90

        return attrs

    def create(self, validated_data):
        api_key = (validated_data.pop("api_key", "") or "").strip()
        instance = SOARProvider(**validated_data)

        if api_key:
            instance.auth_secret_ref = encrypt_secret(api_key)

        instance.save()
        return instance

    def update(self, instance, validated_data):
        api_key = validated_data.pop("api_key", None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if api_key is not None:
            api_key = str(api_key).strip()
            instance.auth_secret_ref = encrypt_secret(api_key) if api_key else ""

        instance.save()
        return instance


def _is_remote_template_mapping_rule(rule) -> bool:
    return (
        isinstance(rule, dict)
        and str(rule.get("fallback_template_field") or "").strip() == "remote_template_code"
    )


def _is_doko_output_input_mapping_rule(rule) -> bool:
    return (
        isinstance(rule, dict)
        and any(
            isinstance(value, dict)
            and str(value.get("from_variable") or "").strip() == "doko_output"
            for value in rule.values()
        )
    )


def _sync_launch_input_mapping(input_mapping: dict, execution_config: dict) -> dict:
    mapping = input_mapping.copy() if isinstance(input_mapping, dict) else {}

    launch_fields = execution_config.get("launch_fields") if isinstance(execution_config, dict) else {}
    if not isinstance(launch_fields, dict):
        launch_fields = {}

    remote_field = str(launch_fields.get("remote_template_field") or "").strip()
    target_field = str(launch_fields.get("target_object_field") or "container_id").strip()

    if remote_field:
        remote_keys = [
            key
            for key, rule in mapping.items()
            if _is_remote_template_mapping_rule(rule)
        ]

        if remote_field not in mapping:
            if remote_keys:
                mapping[remote_field] = mapping[remote_keys[0]]
            else:
                mapping[remote_field] = {
                    "fallback_template_field": "remote_template_code",
                }

        for key in remote_keys:
            if key != remote_field:
                mapping.pop(key, None)

    if target_field and target_field not in mapping:
        mapping[target_field] = {
            "from_variable": "target_object_id",
        }

    if "doko_output" not in mapping:
        mapping["doko_output"] = {
            "from_variable": "doko_output",
        }

    input_payload_field = str(launch_fields.get("input_payload_field") or "").strip()
    input_variable_name = str(launch_fields.get("input_variable_name") or "doko_output").strip()

    if input_payload_field and input_variable_name:
        input_container_keys = [
            key
            for key, rule in mapping.items()
            if key not in {
                remote_field,
                target_field,
                "doko_output",
                "observable_value",
                "observable_type",
            }
            and _is_doko_output_input_mapping_rule(rule)
        ]

        mapping[input_payload_field] = {
            input_variable_name: {
                "from_variable": "doko_output",
            }
        }

        for key in input_container_keys:
            if key != input_payload_field:
                mapping.pop(key, None)

    return mapping


class InvestigationTemplateSerializer(serializers.ModelSerializer):
    soar_provider_name = serializers.CharField(source="soar_provider.name", read_only=True)

    class Meta:
        model = InvestigationTemplate
        fields = [
            "id",
            "code",
            "name",
            "description",
            "selection_hint",
            "entity_type",
            "target_kind",
            "soar_provider",
            "soar_provider_name",
            "remote_template_code",
            "allowed_variables_schema",
            "input_mapping",
            "output_mapping",
            "status_mapping",
            "execution_config",
            "max_time_range_hours",
            "risk_level",
            "is_enabled",
            "version",
            "created_at",
            "updated_at",
            "chat_command",
            "command_help",
            "ai_context",
            "default_variables",
            "prompt_overrides_schema",
        ]

    def validate(self, attrs):
        is_create = self.instance is None

        name = (attrs.get("name") or getattr(self.instance, "name", "") or "").strip()
        code = (attrs.get("code") or getattr(self.instance, "code", "") or "").strip()

        if not code and name:
            import re
            code = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80]
            attrs["code"] = code

        if is_create:
            attrs.setdefault("entity_type", "generic")
            attrs.setdefault("target_kind", "single")
            attrs.setdefault("risk_level", "low")
            attrs.setdefault("max_time_range_hours", 24)
            attrs.setdefault("default_variables", {})
            attrs.setdefault("allowed_variables_schema", {})
            attrs.setdefault("prompt_overrides_schema", {})
            attrs.setdefault("output_mapping", DEFAULT_TEMPLATE_OUTPUT_MAPPING)
            attrs.setdefault("status_mapping", DEFAULT_TEMPLATE_STATUS_MAPPING)
            attrs.setdefault("command_help", "")
            attrs.setdefault("ai_context", "")

        if "input_mapping" in attrs or is_create:
            execution_config = attrs.get(
                "execution_config",
                getattr(self.instance, "execution_config", None) or {},
            )
            if not isinstance(execution_config, dict):
                execution_config = {}

            launch_config = execution_config.get("launch_fields") or {}
            remote_field = str((launch_config or {}).get("remote_template_field") or "").strip()
            target_field = str((launch_config or {}).get("target_object_field") or "container_id").strip()

            attrs["input_mapping"] = _sync_launch_input_mapping(
                attrs.get("input_mapping")
                or (getattr(self.instance, "input_mapping", None) if not is_create else None)
                or _default_template_input_mapping(remote_field, target_field),
                execution_config,
            )

        if "execution_config" in attrs or is_create:
            execution_config = attrs.get(
                "execution_config",
                getattr(self.instance, "execution_config", None) or {},
            )
            if not isinstance(execution_config, dict):
                execution_config = {}

            launch_fields = execution_config.get("launch_fields") or {}
            if isinstance(launch_fields, dict):
                target_field = str(launch_fields.get("target_object_field") or "").strip()
                if target_field:
                    required = execution_config.get("required_launch_fields") or []
                    if not isinstance(required, list):
                        required = []
                    if target_field not in required:
                        required.append(target_field)
                    execution_config["required_launch_fields"] = required

            attrs["execution_config"] = execution_config

        if "remote_template_code" in attrs or is_create:
            remote_template_code = (
                attrs.get("remote_template_code")
                or getattr(self.instance, "remote_template_code", "")
                or attrs.get("code")
                or code
                or ""
            )
            attrs["remote_template_code"] = str(remote_template_code).strip()

        return attrs


class ChatMessageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatMessage
        fields = ["id", "role", "content", "metadata", "created_at"]


class ChatGeneratedDraftSerializer(serializers.ModelSerializer):
    class Meta:
        model = ChatGeneratedDraft
        fields = [
            "id",
            "target_type",
            "target_id",
            "content",
            "is_posted",
            "posted_at",
            "created_at",
        ]


class ChatActionRunSerializer(serializers.ModelSerializer):
    template_name = serializers.CharField(source="template.name", read_only=True)
    template_code = serializers.CharField(source="template.code", read_only=True)

    class Meta:
        model = ChatActionRun
        fields = [
            "id",
            "status",
            "template",
            "template_name",
            "template_code",
            "input_payload",
            "request_payload",
            "output_payload",
            "raw_response_payload",
            "remote_run_id",
            "remote_status",
            "error_message",
            "started_at",
            "completed_at",
            "created_at",
            "updated_at",
        ]


class ChatRunSerializer(serializers.ModelSerializer):
    drafts = ChatGeneratedDraftSerializer(many=True, read_only=True)
    actions = ChatActionRunSerializer(many=True, read_only=True)

    class Meta:
        model = ChatRun
        fields = [
            "id",
            "request_id",
            "client_tab_id",
            "status",
            "prompt",
            "response_text",
            "error_message",
            "selected_template_code",
            "selected_command",
            "provider_execution",
            "cancel_requested",
            "cancel_requested_at",
            "started_at",
            "completed_at",
            "created_at",
            "updated_at",
            "drafts",
            "actions",
        ]


class ChatSessionSerializer(serializers.ModelSerializer):
    messages = ChatMessageSerializer(many=True, read_only=True)

    class Meta:
        model = ChatSession
        fields = [
            "id",
            "title",
            "surface",
            "page_type",
            "object_id",
            "customer_id",
            "client_tab_id",
            "created_at",
            "updated_at",
            "messages",
        ]