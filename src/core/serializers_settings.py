from rest_framework import serializers
from .models import (
    Role,
    Permission,
    CaseRetentionSettings,
    InstanceBackup,
    InstanceProxySettings,
    InvestigationTemplate,
    AutomationRule,
    AutomationExecutionLog,
)
from django.contrib.auth import get_user_model
from knox.models import AuthToken
from .crypto_secrets import encrypt_secret

User = get_user_model()

class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["id", "code", "label"]


class RoleSerializer(serializers.ModelSerializer):
    permissions = PermissionSerializer(many=True, read_only=True)
    permission_ids = serializers.ListField(
        child=serializers.IntegerField(),
        write_only=True,
        required=False,
    )

    class Meta:
        model = Role
        fields = ["id", "name", "description", "permissions", "permission_ids"]

    def create(self, validated_data):
        perm_ids = validated_data.pop("permission_ids", [])
        role = Role.objects.create(**validated_data)
        if perm_ids:
            role.permissions.set(Permission.objects.filter(id__in=perm_ids))
        return role

    def update(self, instance, validated_data):
        perm_ids = validated_data.pop("permission_ids", None)
        for k, v in validated_data.items():
            setattr(instance, k, v)
        instance.save()
        if perm_ids is not None:
            instance.permissions.set(Permission.objects.filter(id__in=perm_ids))
        return instance


class SettingsUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "email", "is_active", "is_staff"]


class SettingsUserApiTokenSerializer(serializers.ModelSerializer):
    id = serializers.CharField(source="token_key", read_only=True)

    class Meta:
        model = AuthToken
        fields = ["id", "token_key", "created", "expiry"]


class CaseRetentionSettingsSerializer(serializers.ModelSerializer):
    exchange_send_template = serializers.PrimaryKeyRelatedField(
        queryset=InvestigationTemplate.objects.filter(is_enabled=True),
        required=False,
        allow_null=True,
    )
    exchange_send_template_name = serializers.CharField(
        source="exchange_send_template.name",
        read_only=True,
    )

    class Meta:
        model = CaseRetentionSettings
        fields = [
            "auto_archive_after_days",
            "hard_delete_after_days",
            "exchange_send_template",
            "exchange_send_template_name",
            "updated_at",
            "updated_by",
        ]
        read_only_fields = ["updated_at", "updated_by", "exchange_send_template_name"]

    def validate(self, attrs):
        a = attrs.get("auto_archive_after_days")
        h = attrs.get("hard_delete_after_days")

        if a is not None and h is not None and h < a:
            raise serializers.ValidationError("hard_delete_after_days must be >= auto_archive_after_days")
        return attrs
    


class RoleCustomerAccessUpdateSerializer(serializers.Serializer):
    customer_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=True,
        required=True,
    )

class InstanceBackupSerializer(serializers.ModelSerializer):
    class Meta:
        model = InstanceBackup
        fields = ["id", "filename", "created_at"]


class InstanceProxySettingsSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = InstanceProxySettings
        fields = [
            "enabled",
            "host",
            "port",
            "username",
            "password",
            "updated_at",
            "updated_by",
        ]
        read_only_fields = ["updated_at", "updated_by"]

    def validate_host(self, value):
        value = str(value or "").strip()
        if any(char in value for char in ["\n", "\r", "\t", " "]):
            raise serializers.ValidationError("Proxy host is invalid.")
        if "/" in value and not value.startswith(("http://", "https://")):
            raise serializers.ValidationError("Proxy host must not contain a path.")
        if value.startswith(("http://", "https://")):
            without_scheme = value.split("://", 1)[1]
            if "/" in without_scheme:
                raise serializers.ValidationError("Proxy host must not contain a path.")
        return value

    def validate(self, attrs):
        enabled = attrs.get("enabled", getattr(self.instance, "enabled", False))
        host = attrs.get("host", getattr(self.instance, "host", ""))
        port = attrs.get("port", getattr(self.instance, "port", None))

        if enabled:
            if not str(host or "").strip():
                raise serializers.ValidationError("Proxy host is required when proxy is enabled.")
            if port is None:
                raise serializers.ValidationError("Proxy port is required when proxy is enabled.")

        return attrs

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)

        for key, value in validated_data.items():
            setattr(instance, key, value)

        if password:
            instance.set_password(password)

        instance.save()
        return instance
    

class RestoreBackupSerializer(serializers.Serializer):
    file = serializers.FileField()


AUTOMATION_SCOPES = {"alert", "case", "hunt"}
AUTOMATION_OPERATORS = {
    "EQUAL",
    "NOT EQUAL",
    "CONTAINS",
    "DOES NOT CONTAIN",
    "GREATER THAN",
    "LESS THAN",
    "BETWEEN",
}
AUTOMATION_GROUP_OPERATORS = {"AND", "OR"}

AUTOMATION_CONDITION_FIELDS = {
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

AUTOMATION_ACTION_TYPES = {
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

AUTOMATION_INVESTIGATION_TARGET_SOURCES = {
    "all_iocs",
    "all_assets",
    "all_iocs_and_assets",
    "specific_ioc",
    "specific_asset",
    "description",
    "manual",
    "trigger_asset",
    "trigger_ioc",
    "first_asset",
    "first_ioc",
}

def validate_automation_conditions(value):
    if value in (None, ""):
        return {"operator": "AND", "children": []}

    if not isinstance(value, dict):
        raise serializers.ValidationError("Conditions must be an object.")

    def walk(node, depth=0):
        if depth > 8:
            raise serializers.ValidationError("Conditions tree is too deep.")

        if not isinstance(node, dict):
            raise serializers.ValidationError("Each condition must be an object.")

        children = node.get("children")
        if children is not None:
            if not isinstance(children, list):
                raise serializers.ValidationError("Condition children must be a list.")

            operator = str(node.get("operator") or "AND").upper()
            if operator not in AUTOMATION_GROUP_OPERATORS:
                raise serializers.ValidationError("Unknown condition group operator.")

            for child in children:
                walk(child, depth + 1)
            return

        field = str(node.get("field") or "").strip()
        operator = str(node.get("operator") or "IS").strip().upper()

        if field not in AUTOMATION_CONDITION_FIELDS:
            raise serializers.ValidationError(f"Unsupported condition field: {field}")

        if operator not in AUTOMATION_OPERATORS:
            raise serializers.ValidationError(f"Unsupported condition operator: {operator}")
        
        if operator == "BETWEEN":
            value = node.get("value")
            if not isinstance(value, dict):
                raise serializers.ValidationError("BETWEEN value must be an object.")

            if not str(value.get("from") or "").strip() or not str(value.get("to") or "").strip():
                raise serializers.ValidationError("BETWEEN requires from and to values.")

    walk(value)
    return value


def validate_automation_actions(value):
    if value in (None, ""):
        return []

    if not isinstance(value, list):
        raise serializers.ValidationError("Actions must be a list.")

    if len(value) > 20:
        raise serializers.ValidationError("Too many actions.")

    for action in value:
        if not isinstance(action, dict):
            raise serializers.ValidationError("Each action must be an object.")

        action_type = str(action.get("type") or "").strip()
        if action_type not in AUTOMATION_ACTION_TYPES:
            raise serializers.ValidationError(f"Unsupported automation action: {action_type}")

        if action_type in {
            "exchange_message",
            "exchange_reply_last_inbound",
            "exchange_reply_all_inbound",
        }:
            send_mode = str(action.get("send_mode") or "save").strip()
            if send_mode not in {"save", "send"}:
                raise serializers.ValidationError("send_mode must be save or send.")
            
            if action_type in {"exchange_message", "exchange_reply_last_inbound", "exchange_reply_all_inbound"}:
                has_body = bool(str(action.get("body") or "").strip())
                has_quickpart = bool(str(action.get("quickpart_id") or "").strip())

                if not has_body and not has_quickpart:
                    raise serializers.ValidationError(
                        "Exchange automation actions require a body or a quickpart."
                    )
            
            if action_type == "exchange_message" and send_mode == "send":
                recipients = action.get("to") or []

                if isinstance(recipients, str):
                    recipients = [
                        item.strip()
                        for item in recipients.replace(";", ",").split(",")
                        if item.strip()
                    ]

                if not isinstance(recipients, list) or not recipients:
                    raise serializers.ValidationError("To is required when sending an Exchange message.")

        if action_type == "run_investigation_template":
            if not action.get("template_id"):
                raise serializers.ValidationError("template_id is required for investigation actions.")

            target_source = str(action.get("target_source") or "all_assets").strip()
            if target_source not in AUTOMATION_INVESTIGATION_TARGET_SOURCES:
                raise serializers.ValidationError("Unsupported investigation target source.")

            if target_source in {"specific_ioc", "specific_asset", "manual"} and not str(action.get("target_value") or "").strip():
                raise serializers.ValidationError("target_value is required for this investigation target source.")

            variables = action.get("variables") or {}
            if not isinstance(variables, dict):
                raise serializers.ValidationError("Investigation variables must be an object.")

            soar_object_id_type = str(action.get("soar_object_id_type") or "").strip()
            if soar_object_id_type and soar_object_id_type not in {"container_id", "incident_id"}:
                raise serializers.ValidationError("SOAR object id type must be container_id or incident_id.")

        if action_type == "apply_workbook_template" and not action.get("workbook_template_id"):
            raise serializers.ValidationError("workbook_template_id is required for workbook actions.")

        if action_type == "add_comment":
                    body = str(action.get("body") or "").strip()
                    if not body:
                        raise serializers.ValidationError(
                            "Comment body is required for add_comment actions."
                        )

    return value


class AutomationRuleSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)
    updated_by_username = serializers.CharField(source="updated_by.username", read_only=True)

    class Meta:
        model = AutomationRule
        fields = [
            "id",
            "name",
            "scope",
            "is_enabled",
            "conditions",
            "actions",
            "run_once_per_target",
            "cooldown_seconds",
            "stop_on_first_action_error",
            "created_by",
            "created_by_username",
            "updated_by",
            "updated_by_username",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "created_by",
            "created_by_username",
            "updated_by",
            "updated_by_username",
            "created_at",
            "updated_at",
        ]

    def validate_name(self, value):
        value = (value or "").strip()
        if not value:
            raise serializers.ValidationError("Name is required.")
        if len(value) > 160:
            raise serializers.ValidationError("Name is too long.")
        return value

    def validate_scope(self, value):
        if value not in AUTOMATION_SCOPES:
            raise serializers.ValidationError("Unknown scope.")
        if self.instance and self.instance.scope != value:
            raise serializers.ValidationError(
                "Scope cannot be changed after creation."
            )

        return value

    def validate_conditions(self, value):
        return validate_automation_conditions(value)

    def validate_actions(self, value):
        return validate_automation_actions(value)

    def validate_cooldown_seconds(self, value):
        if value is None:
            return 0

        value = int(value)

        if value < 0:
            raise serializers.ValidationError("Cooldown cannot be negative.")

        if value > 86400 * 30:
            raise serializers.ValidationError("Cooldown is too long.")

        return value

    def validate(self, attrs):
        scope = attrs.get("scope") or (self.instance.scope if self.instance else "case")
        actions = attrs.get("actions") or []

        for action in actions:
            action_type = str(action.get("type") or "")

            if action_type == "apply_workbook_template" and scope != "case":
                raise serializers.ValidationError(
                    "Workbook actions are only available for case rules."
                )

            if action_type in {
                "exchange_message",
                "exchange_reply_last_inbound",
                "exchange_reply_all_inbound",
            } and scope == "hunt":
                raise serializers.ValidationError(
                    "Exchange actions are not available for hunt rules."
                )

        return attrs


class AutomationExecutionLogSerializer(serializers.ModelSerializer):
    rule_name = serializers.CharField(source="rule.name", read_only=True)

    class Meta:
        model = AutomationExecutionLog
        fields = [
            "id",
            "rule",
            "rule_name",
            "scope",
            "target_id",
            "trigger",
            "matched",
            "status",
            "context",
            "actions_results",
            "error",
            "started_at",
            "completed_at",
        ]
        read_only_fields = fields