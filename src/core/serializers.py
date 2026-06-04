from django.contrib.auth import get_user_model
from django.utils import timezone

from .html_sanitizer import sanitize_html
from .rbac import get_accessible_customer_ids

import json
import uuid

from rest_framework import serializers

from .models import (
    Alert, 
    Event, 
    TimelineItem, 
    Comment, 
    Attachment, 
    Severity, 
    Classification, 
    CustomerContact, 
    Customer, 
    WorkbookInstanceItem,
    WorkbookInstance, 
    WorkbookTemplateItem,
    WorkbookTemplate,
    ReportTemplate, 
    ReportInstance,
    IncidentTimelineItem,
    ConnectorResult,
    ConnectorAllowlistDomain,
    ConnectorInstance,
    ConnectorEndpoint,
    AlertComment,
    UserProfile,
    CaseExchange,
    CaseExchangeReplyQuickpart,
    CaseExchangeFollowup,
    AuditLog,
    Hunt,
    HuntJournalEntry,
    HuntCaseLink,
    Task,
    TaskComment,
    TaskCaseLink,
)

User = get_user_model()
DEFAULT_CUSTOMER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")

SLA_UNITS = {"minute", "hour", "day", "week", "month"}

ALERT_RAW_MAX_BYTES = 1024 * 1024
ALERT_CASE_EXCHANGES_MAX_ITEMS = 20
ALERT_CASE_EXCHANGE_BODY_MAX_CHARS = 500000

def compute_sla_info(obj, completed_statuses: set[str]):
    customer = getattr(obj, "customer", None)
    severity = getattr(obj, "severity", "") or ""
    created_at = getattr(obj, "created_at", None)

    if not customer or not created_at:
        return {
            "sla_due_at": None,
            "sla_state": "none",
            "sla_rule": None,
        }

    delta = customer.get_sla_delta(severity) if hasattr(customer, "get_sla_delta") else None
    rule = customer.get_sla_rule(severity) if hasattr(customer, "get_sla_rule") else None

    if not delta or not rule:
        return {
            "sla_due_at": None,
            "sla_state": "none",
            "sla_rule": None,
        }

    due_at = created_at + delta
    status = getattr(obj, "status", "") or ""
    acknowledged_at = getattr(obj, "sla_acknowledged_at", None)

    if acknowledged_at:
        state = "completed" if acknowledged_at <= due_at else "overdue_completed"
    elif status in completed_statuses:
        state = "completed" if timezone.now() <= due_at else "overdue_completed"
    elif due_at < timezone.now():
        state = "overdue"
    else:
        state = "ok"

    return {
        "sla_due_at": due_at,
        "sla_state": state,
        "sla_rule": rule,
    }

def get_case_alert_sources(obj) -> list[str]:
    sources = []
    seen = set()

    qs = (
        obj.alerts
        .filter(is_deleted=False)
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


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        fields = [
            "id",
            "created_at",
            "actor",
            "actor_username",
            "action",
            "object_type",
            "object_id",
            "object_repr",
            "success",
            "status_code",
            "ip_address",
            "user_agent",
            "method",
            "path",
            "request_id",
            "duration_ms",
            "metadata",
        ]
        read_only_fields = fields


class MeSerializer(serializers.ModelSerializer):
    timezone = serializers.CharField(source="profile.timezone", required=False, allow_blank=True)
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "username", "email", "is_staff", "timezone", "avatar_url"]
        read_only_fields = ["id", "username", "is_staff", "avatar_url"]

    def get_avatar_url(self, obj):
        request = self.context.get("request")
        profile = getattr(obj, "profile", None)
        if not profile or not profile.avatar:
            return None
        if request is None:
            return profile.avatar.url
        return request.build_absolute_uri(profile.avatar.url)

    def update(self, instance, validated_data):
        profile_data = validated_data.pop("profile", {})

        if "email" in validated_data:
            instance.email = validated_data["email"]
            instance.save(update_fields=["email"])

        if "timezone" in profile_data:
            profile, _ = UserProfile.objects.get_or_create(user=instance)
            profile.timezone = profile_data["timezone"] or ""
            profile.save(update_fields=["timezone"])

        return instance



class TimelineItemSerializer(serializers.ModelSerializer):
    actor_username = serializers.CharField(source="actor.username", read_only=True)
    alert_id = serializers.UUIDField(source="alert.id", read_only=True, allow_null=True)
    class Meta:
        model = TimelineItem
        fields = ["id", "event", "date", "type", "text", "actor", "actor_username", "created_at", "updated_at", "alert_id"]
        read_only_fields = ["id", "created_at", "updated_at", "date"]


class AlertSerializer(serializers.ModelSerializer):
    case = serializers.UUIDField(source="case.id", read_only=True, allow_null=True)
    customer_id = serializers.UUIDField(source="customer.id", read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)

    owner_id = serializers.IntegerField(source="owner.id", read_only=True)
    owner_username = serializers.CharField(source="owner.username", read_only=True)
    owner = serializers.PrimaryKeyRelatedField(queryset=User.objects.all(), required=False, allow_null=True)
    sla_due_at = serializers.SerializerMethodField()
    sla_state = serializers.SerializerMethodField()
    sla_rule = serializers.SerializerMethodField()
    raw = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model = Alert
        fields = [
            "id",
            "title",
            "description",
            "classification",
            "severity",
            "status",
            "outcome",
            "source",
            "iocs",
            "assets",
            "case",
            "raw",
            "created_at",
            "customer",
            "customer_name",
            "customer_id",
            "owner",
            "owner_id",
            "owner_username",
            "sla_due_at",
            "sla_state",
            "sla_rule",
            "sla_acknowledged_at",
            "sla_acknowledgement_invalidated_at",
        ]
        read_only_fields = ["id", "created_at", "owner_id", "owner_username", "sla_acknowledged_at", "sla_acknowledgement_invalidated_at",]

    def validate_severity(self, value):
        if not Severity.objects.filter(code=value, is_active=True).exists():
            raise serializers.ValidationError("Unknown severity")
        return value

    def validate_classification(self, value):
        if not Classification.objects.filter(code=value, is_active=True).exists():
            raise serializers.ValidationError("Unknown classification")
        return value

    def validate_raw(self, value):
        if value in (None, ""):
            return {}

        if not isinstance(value, dict):
            raise serializers.ValidationError("Raw must be an object")

        try:
            raw_size = len(json.dumps(value, ensure_ascii=False).encode("utf-8"))
        except Exception:
            raise serializers.ValidationError("Raw must be JSON serializable")

        if raw_size > ALERT_RAW_MAX_BYTES:
            raise serializers.ValidationError("Raw payload is too large")

        case_exchanges = value.get("case_exchanges", None)

        if case_exchanges is None:
            projections = value.get("projections", {})
            if isinstance(projections, dict):
                case_exchanges = projections.get("case_exchanges", None)

        if case_exchanges is None:
            return value

        if not isinstance(case_exchanges, list):
            raise serializers.ValidationError("raw.case_exchanges must be a list")

        if len(case_exchanges) > ALERT_CASE_EXCHANGES_MAX_ITEMS:
            raise serializers.ValidationError("raw.case_exchanges contains too many items")

        for item in case_exchanges:
            if not isinstance(item, dict):
                raise serializers.ValidationError("Each case exchange must be an object")

            body = item.get("body", "")
            if body is not None and len(str(body)) > ALERT_CASE_EXCHANGE_BODY_MAX_CHARS:
                raise serializers.ValidationError("Case exchange body is too large")

            for key in ["to", "cc", "bcc", "references"]:
                recipients = item.get(key, [])
                if recipients in (None, ""):
                    continue
                if isinstance(recipients, str):
                    continue
                if not isinstance(recipients, list):
                    raise serializers.ValidationError(f"{key} must be a list of strings")

        return value

    def get_sla_due_at(self, obj):
        return compute_sla_info(
            obj,
            completed_statuses={Alert.Status.CLOSED, Alert.Status.MERGED},
        )["sla_due_at"]

    def get_sla_state(self, obj):
        return compute_sla_info(
            obj,
            completed_statuses={Alert.Status.CLOSED, Alert.Status.MERGED},
        )["sla_state"]

    def get_sla_rule(self, obj):
        return compute_sla_info(
            obj,
            completed_statuses={Alert.Status.CLOSED, Alert.Status.MERGED},
        )["sla_rule"]
    
    def create(self, validated_data):
        if not validated_data.get("customer"):
            try:
                validated_data["customer"] = Customer.objects.get(id=DEFAULT_CUSTOMER_ID)
            except Customer.DoesNotExist:
                pass

        return super().create(validated_data)

    def update(self, instance, validated_data):
        old_status = instance.status
        new_status = validated_data.get("status", old_status)
        request = self.context.get("request")
        now = timezone.now()

        missclick_grace_seconds = 300

        if old_status == Alert.Status.OPEN and new_status in {
            Alert.Status.IN_PROGRESS,
            Alert.Status.CLOSED,
            Alert.Status.MERGED,
        }:
            if not instance.sla_acknowledged_at:
                instance.sla_acknowledged_at = now
                if request and getattr(request, "user", None) and request.user.is_authenticated:
                    instance.sla_acknowledged_by = request.user

        if old_status == Alert.Status.IN_PROGRESS and new_status == Alert.Status.OPEN:
            if instance.sla_acknowledged_at:
                elapsed = (now - instance.sla_acknowledged_at).total_seconds()
                if elapsed <= missclick_grace_seconds:
                    instance.sla_acknowledgement_invalidated_at = now
                    instance.sla_acknowledged_at = None
                    instance.sla_acknowledged_by = None

        return super().update(instance, validated_data)



class AlertCommentSerializer(serializers.ModelSerializer):
    author_display = serializers.SerializerMethodField()
    
    class Meta:
        model = AlertComment
        fields = ["id", "alert", "text", "created_at", "updated_at", "author_label", "author_display"]
        read_only_fields = ["id", "alert", "created_at", "updated_at"]

    def get_author_display(self, obj):
        if obj.author:
            return obj.author.username
        if obj.author_label:
            return obj.author_label
        return ""
    
    def validate_text(self, value):
        return sanitize_html(value)


class EventListSerializer(serializers.ModelSerializer):
    owner_id = serializers.PrimaryKeyRelatedField(
        source="owner", queryset=User.objects.all(), write_only=True, required=False
    )
    owner_username = serializers.CharField(source="owner.username", read_only=True)
    owner_id_read = serializers.IntegerField(source="owner.id", read_only=True)
    customer_id = serializers.UUIDField(source="customer.id", read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)

    auto_followup_quickpart_id = serializers.UUIDField(
        source="auto_followup_quickpart.id",
        allow_null=True,
        required=False,
    )
    auto_followup_quickpart_name = serializers.CharField(
        source="auto_followup_quickpart.name",
        read_only=True,
    )

    has_recent_activity = serializers.BooleanField(read_only=True)
    recent_activity_at = serializers.DateTimeField(read_only=True, allow_null=True)
    recent_activity_kind = serializers.CharField(read_only=True, allow_null=True)
    last_viewed_at = serializers.DateTimeField(read_only=True, allow_null=True)


    class Meta:
        model = Event
        fields = [
            "id",
            "case_number",
            "title",
            "description",
            "status",
            "created_at",
            "updated_at",
            "classification",
            "severity",
            "owner_username",
            "owner_id",
            "owner_id_read",
            "customer_name",
            "customer_id",
            "customer",
            "archived_at",
            "outcome",
            "auto_followup_action",
            "auto_followup_enabled",
            "auto_followup_delay_value",
            "auto_followup_delay_unit",
            "auto_followup_quickpart_id",
            "auto_followup_quickpart_name",
            "has_recent_activity",
            "recent_activity_at",
            "recent_activity_kind",
            "last_viewed_at",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "archived_at",
            "auto_followup_quickpart_name",
            "has_recent_activity",
            "recent_activity_at",
            "recent_activity_kind",
            "last_viewed_at",
        ]


class EventSerializer(serializers.ModelSerializer):
    owner_id = serializers.PrimaryKeyRelatedField(
        source="owner", queryset=User.objects.all(), write_only=True, required=False
    )
    owner_username = serializers.CharField(source="owner.username", read_only=True)
    owner_id_read = serializers.IntegerField(source="owner.id", read_only=True)
    customer_id = serializers.UUIDField(source="customer.id", read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    workbook_template_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = Event
        fields = [
            "id", 
            "case_number", 
            "title", 
            "description", 
            "status", 
            "created_at", 
            "updated_at", 
            "classification", 
            "severity", 
            "owner_username", 
            "owner_id", 
            "owner_id_read", 
            "customer_name", 
            "customer_id", 
            "customer", 
            "iocs", 
            "assets", 
            "case_number", 
            "archived_at", 
            "outcome", 
            "workbook_template_id", 
            "auto_followup_action", 
            "auto_followup_enabled", 
            "auto_followup_delay_value", 
            "auto_followup_delay_unit", 
            "auto_followup_quickpart_id", 
            "auto_followup_quickpart_name",
            ]
        read_only_fields = [
            "id", 
            "created_at", 
            "updated_at", 
            "archived_at"
            ]
        

    def validate_severity(self, value):
        if not Severity.objects.filter(code=value, is_active=True).exists():
            raise serializers.ValidationError("Unknown severity")
        return value
    
    def validate_classification(self, value):
        if not Classification.objects.filter(code=value, is_active=True).exists():
            raise serializers.ValidationError("Unknown classification")
        return value

    def validate_auto_followup_delay_value(self, value):
        if value is None:
            return 24
        if int(value) < 1:
            raise serializers.ValidationError("Delay value must be greater than 0")
        return int(value)

    def validate_auto_followup_delay_unit(self, value):
        allowed = {"minute", "hour", "day", "week", "month"}
        if value not in allowed:
            raise serializers.ValidationError("Unknown delay unit")
        return value

    def validate_workbook_template_id(self, value):
        if value is None:
            return None
        if not WorkbookTemplate.objects.filter(id=value, is_active=True).exists():
            raise serializers.ValidationError("Unknown or inactive workbook template")
        return value
    
    auto_followup_quickpart_id = serializers.PrimaryKeyRelatedField(
        source="auto_followup_quickpart",
        queryset=CaseExchangeReplyQuickpart.objects.filter(is_active=True),
        required=False,
        allow_null=True,
    )
    auto_followup_quickpart_name = serializers.CharField(
        source="auto_followup_quickpart.name",
        read_only=True,
    )

    def create(self, validated_data):
        if not validated_data.get("customer"):
            try:
                validated_data["customer"] = Customer.objects.get(id=DEFAULT_CUSTOMER_ID)
            except Customer.DoesNotExist:
                pass

        return super().create(validated_data)



class EventDetailSerializer(serializers.ModelSerializer):
    timeline_items = TimelineItemSerializer(many=True, read_only=True)
    owner_id = serializers.PrimaryKeyRelatedField(
        source="owner", queryset=User.objects.all(), write_only=True, required=False
    )
    owner_username = serializers.CharField(source="owner.username", read_only=True)
    owner_id_read = serializers.IntegerField(source="owner.id", read_only=True)
    customer_id = serializers.UUIDField(source="customer.id", read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    auto_followup_quickpart_id = serializers.UUIDField(
        source="auto_followup_quickpart.id",
        allow_null=True,
        required=False,
    )
    auto_followup_quickpart_name = serializers.CharField(
        source="auto_followup_quickpart.name",
        read_only=True,
    )
    case_sources = serializers.SerializerMethodField()

    class Meta:
        model = Event
        fields = [
            "id",
            "title", 
            "case_number", 
            "description", 
            "classification", 
            "severity", 
            "status", 
            "created_at", 
            "updated_at", 
            "timeline_items", 
            "comments", 
            "owner_username", 
            "owner_id", 
            "owner_id_read", 
            "customer_name", 
            "customer_id", 
            "customer", 
            "case_sources",
            "iocs", 
            "assets", 
            "archived_at", 
            "outcome", 
            "auto_followup_action", 
            "auto_followup_enabled", 
            "auto_followup_delay_value", 
            "auto_followup_delay_unit", 
            "auto_followup_quickpart_id", 
            "auto_followup_quickpart_name",
            ]
        read_only_fields = [
            "id", 
            "created_at", 
            "updated_at", 
            "timeline_items", 
            "archived_at",
            ]
        
    def get_case_sources(self, obj):
        return get_case_alert_sources(obj)


class HuntCaseLiteSerializer(serializers.ModelSerializer):
    case_number = serializers.IntegerField(read_only=True)

    class Meta:
        model = Event
        fields = ["id", "case_number", "title", "status", "created_at", "updated_at"]


class HuntCaseLinkSerializer(serializers.ModelSerializer):
    case_id = serializers.UUIDField(write_only=True)
    case = HuntCaseLiteSerializer(read_only=True)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = HuntCaseLink
        fields = [
            "id",
            "hunt",
            "case",
            "case_id",
            "link_type",
            "created_by",
            "created_by_username",
            "created_at",
        ]
        read_only_fields = ["id", "hunt", "case", "created_by", "created_by_username", "created_at"]

    def validate_case_id(self, value):
        try:
            case = Event.objects.get(id=value, is_deleted=False)
        except Event.DoesNotExist:
            raise serializers.ValidationError("Unknown case")

        hunt = self.context.get("hunt")
        if hunt and hunt.customer_id and case.customer_id != hunt.customer_id:
            raise serializers.ValidationError("Case customer mismatch")

        self.context["validated_case"] = case
        return value

    def create(self, validated_data):
        validated_data.pop("case_id", None)
        case = self.context["validated_case"]
        hunt = self.context["hunt"]
        user = self.context["request"].user

        obj, _ = HuntCaseLink.objects.get_or_create(
            hunt=hunt,
            case=case,
            defaults={
                "link_type": validated_data.get("link_type", HuntCaseLink.LinkType.RELATED),
                "created_by": user if getattr(user, "is_authenticated", False) else None,
            },
        )
        return obj


class HuntJournalEntrySerializer(serializers.ModelSerializer):
    author_username = serializers.CharField(source="author.username", read_only=True)

    class Meta:
        model = HuntJournalEntry
        fields = [
            "id",
            "hunt",
            "entry_type",
            "text",
            "author",
            "author_username",
            "occurred_at",
            "linked_ioc_value",
            "linked_asset_value",
            "linked_action_run_id",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "hunt", "author", "author_username", "created_at", "updated_at"]

    def validate_text(self, value):
        return sanitize_html(value)


class HuntListSerializer(serializers.ModelSerializer):
    owner_id = serializers.PrimaryKeyRelatedField(
        source="owner", queryset=User.objects.all(), write_only=True, required=False, allow_null=True
    )
    reviewer_ids = serializers.PrimaryKeyRelatedField(
        source="reviewers", queryset=User.objects.all(), many=True, write_only=True, required=False
    )

    owner_username = serializers.CharField(source="owner.username", read_only=True)
    owner_id_read = serializers.IntegerField(source="owner.id", read_only=True, allow_null=True)
    customer_id = serializers.UUIDField(source="customer.id", read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    reviewers_usernames = serializers.SerializerMethodField()

    class Meta:
        model = Hunt
        fields = [
            "id",
            "title",
            "context",
            "status",
            "verdict",
            "created_at",
            "updated_at",
            "archived_at",
            "owner_id",
            "owner_id_read",
            "owner_username",
            "reviewer_ids",
            "reviewers_usernames",
            "customer",
            "customer_id",
            "customer_name",
            "investigation_started_at",
            "investigation_finished_at",
            "search_timeframe_start",
            "search_timeframe_end",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "archived_at", "owner_id_read", "owner_username"]

    def get_reviewers_usernames(self, obj):
        return [u.username for u in obj.reviewers.all()]

    def create(self, validated_data):
        reviewers = validated_data.pop("reviewers", [])
        request = self.context.get("request")
        user = getattr(request, "user", None)

        if not validated_data.get("customer"):
            try:
                validated_data["customer"] = Customer.objects.get(id=DEFAULT_CUSTOMER_ID)
            except Customer.DoesNotExist:
                pass

        if "created_by" not in validated_data and getattr(user, "is_authenticated", False):
            validated_data["created_by"] = user

        obj = super().create(validated_data)
        if reviewers:
            obj.reviewers.set(reviewers)
        return obj

    def update(self, instance, validated_data):
        reviewers = validated_data.pop("reviewers", None)
        obj = super().update(instance, validated_data)
        if reviewers is not None:
            obj.reviewers.set(reviewers)
        return obj


class HuntDetailSerializer(serializers.ModelSerializer):
    owner_id = serializers.PrimaryKeyRelatedField(
        source="owner", queryset=User.objects.all(), write_only=True, required=False, allow_null=True
    )
    reviewer_ids = serializers.PrimaryKeyRelatedField(
        source="reviewers", queryset=User.objects.all(), many=True, write_only=True, required=False
    )

    owner_username = serializers.CharField(source="owner.username", read_only=True)
    owner_id_read = serializers.IntegerField(source="owner.id", read_only=True, allow_null=True)
    customer_id = serializers.UUIDField(source="customer.id", read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    reviewers_usernames = serializers.SerializerMethodField()

    journal_entries = HuntJournalEntrySerializer(many=True, read_only=True)
    case_links = HuntCaseLinkSerializer(many=True, read_only=True)

    class Meta:
        model = Hunt
        fields = [
            "id",
            "title",
            "context",
            "conclusion",
            "status",
            "verdict",
            "created_at",
            "updated_at",
            "archived_at",
            "owner_id",
            "owner_id_read",
            "owner_username",
            "reviewer_ids",
            "reviewers_usernames",
            "customer",
            "customer_id",
            "customer_name",
            "investigation_started_at",
            "investigation_finished_at",
            "search_timeframe_start",
            "search_timeframe_end",
            "iocs",
            "assets",
            "journal_entries",
            "case_links",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "archived_at", "owner_id_read", "owner_username"]

    def get_reviewers_usernames(self, obj):
        return [u.username for u in obj.reviewers.all()]

    def create(self, validated_data):
        reviewers = validated_data.pop("reviewers", [])
        request = self.context.get("request")
        user = getattr(request, "user", None)

        if not validated_data.get("customer"):
            try:
                validated_data["customer"] = Customer.objects.get(id=DEFAULT_CUSTOMER_ID)
            except Customer.DoesNotExist:
                pass

        if "created_by" not in validated_data and getattr(user, "is_authenticated", False):
            validated_data["created_by"] = user

        obj = super().create(validated_data)
        if reviewers:
            obj.reviewers.set(reviewers)
        return obj

    def update(self, instance, validated_data):
        reviewers = validated_data.pop("reviewers", None)
        obj = super().update(instance, validated_data)
        if reviewers is not None:
            obj.reviewers.set(reviewers)
        return obj


class CommentSerializer(serializers.ModelSerializer):
    customer_id = serializers.UUIDField(source="event.customer.id", read_only=True)
    customer_name = serializers.CharField(source="event.customer.name", read_only=True)
    author_display = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = ["id", "event", "author", "text", "created_at", "updated_at", "customer_id", "customer_name", "author_display"]
        read_only_fields = ["id", "event", "author", "created_at", "updated_at"]

    def get_author_display(self, obj):
        if obj.author:
            return obj.author.username
        if obj.author_label:
            return obj.author_label
        return ""
        
    def validate_text(self, value):
        return sanitize_html(value)
    



class AttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_username = serializers.CharField(source="uploaded_by.username", read_only=True)
    file_url = serializers.SerializerMethodField()
    customer_id = serializers.UUIDField(source="event.customer.id", read_only=True)
    customer_name = serializers.CharField(source="event.customer.name", read_only=True)

    class Meta:
        model = Attachment
        fields = [
            "id",
            "event",
            "uploaded_by",
            "uploaded_by_username",
            "original_name",
            "file",
            "file_url",
            "created_at",
            "customer_name", 
            "customer_id",
        ]
        read_only_fields = ["id", "event", "uploaded_by", "uploaded_by_username", "file_url", "created_at"]

    def get_file_url(self, obj):
        request = self.context.get("request")
        if request is None:
            return None
        return request.build_absolute_uri(obj.file.url)


class SeveritySerializer(serializers.ModelSerializer):
    class Meta:
        model = Severity
        fields = ["id", "code", "label", "order", "is_active"]


class ClassificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Classification
        fields = ["id", "code", "label", "is_active"]


class CustomerContactSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="public_id", read_only=True)
    class Meta:
        model = CustomerContact
        fields = ["id", "customer", "name", "email", "phone", "title", "is_active"]
        read_only_fields = ["id", "customer"]


class CustomerSerializer(serializers.ModelSerializer):
    contacts = CustomerContactSerializer(many=True, read_only=True)

    class Meta:
        model = Customer
        fields = [
            "id",
            "name",
            "sla",
            "sla_rules",
            "is_active",
            "created_at",
            "contacts",
        ]
        read_only_fields = ["id", "created_at"]

    def validate_sla_rules(self, value):
        if value in (None, ""):
            return {}

        if not isinstance(value, dict):
            raise serializers.ValidationError("SLA rules must be an object.")

        cleaned = {}

        for raw_code, raw_rule in value.items():
            code = str(raw_code or "").strip()

            if not code:
                continue

            if len(code) > 50:
                raise serializers.ValidationError("Severity code is too long.")

            if not isinstance(raw_rule, dict):
                raise serializers.ValidationError("Each SLA rule must be an object.")

            enabled = bool(raw_rule.get("enabled", True))

            try:
                rule_value = int(raw_rule.get("value") or 0)
            except Exception:
                raise serializers.ValidationError("SLA value must be a number.")

            unit = str(raw_rule.get("unit") or "").strip()

            if not enabled:
                continue

            if rule_value < 1:
                raise serializers.ValidationError("SLA value must be greater than 0.")

            if unit not in SLA_UNITS:
                raise serializers.ValidationError("Unknown SLA unit.")

            cleaned[code] = {
                "enabled": True,
                "value": rule_value,
                "unit": unit,
            }

        return cleaned


class WorkbookInstanceItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkbookInstanceItem
        fields = ["id", "label", "order", "is_done"]
        read_only_fields = ["id", "label", "order"]


class WorkbookTemplateItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkbookTemplateItem
        fields = ["id", "label", "order"]
        read_only_fields = ["id"]

class WorkbookTemplateSerializer(serializers.ModelSerializer):
    items = WorkbookTemplateItemSerializer(many=True, read_only=True)

    class Meta:
        model = WorkbookTemplate
        fields = ["id", "name", "is_active", "created_at", "items"]
        read_only_fields = ["id", "created_at", "items"]

class WorkbookTemplateCreateSerializer(serializers.ModelSerializer):
    items = WorkbookTemplateItemSerializer(many=True, required=False)

    class Meta:
        model = WorkbookTemplate
        fields = ["id", "name", "is_active", "items"]
        read_only_fields = ["id"]

    def create(self, validated_data):
        items = validated_data.pop("items", [])
        tpl = WorkbookTemplate.objects.create(**validated_data)
        for it in items:
            WorkbookTemplateItem.objects.create(template=tpl, **it)
        return tpl


class WorkbookInstanceSerializer(serializers.ModelSerializer):
    items = WorkbookInstanceItemSerializer(many=True, read_only=True)

    class Meta:
        model = WorkbookInstance
        fields = ["id", "event", "template", "created_at", "items"]
        read_only_fields = ["id", "event", "created_at", "items"]


class ReportTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportTemplate
        fields = [
            "id", "name", "description", "is_active",
            "html", "css", "version",
            "created_by", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "created_by", "created_at", "updated_at"]


class ReportTemplateListSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportTemplate
        fields = ["id", "name", "description", "is_active", "version", "created_at", "updated_at"]


class ReportInstanceSerializer(serializers.ModelSerializer):
    pdf_url = serializers.SerializerMethodField()

    class Meta:
        model = ReportInstance
        fields = [
            "id", "case", "template",
            "template_name", "template_version",
            "generated_by", "created_at",
            "pdf_url",
        ]
        read_only_fields = fields

    def get_pdf_url(self, obj):
        request = self.context.get("request")
        if not request or not obj.pdf:
            return None
        return request.build_absolute_uri(obj.pdf.url)


class ReportGenerateRequestSerializer(serializers.Serializer):
    template_id = serializers.UUIDField()
    params = serializers.DictField(required=False)


class ReportPreviewRequestSerializer(serializers.Serializer):
    case_id = serializers.UUIDField()
    html = serializers.CharField()
    css = serializers.CharField(required=False, allow_blank=True)
    params = serializers.DictField(required=False)


class IncidentTimelineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = IncidentTimelineItem
        fields = [
            "id",
            "case",
            "occurred_at",
            "title",
            "details",
            "kind",
            "severity",
            "source",
            "created_by",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "case", "created_by", "created_at", "updated_at"]


class IncidentTimelineItemCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = IncidentTimelineItem
        fields = ["occurred_at", "title", "details", "kind", "severity", "source"]


class ConnectorResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConnectorResult
        fields = [
            "id",
            "case_id",
            "instance_id",
            "endpoint_id",
            "action_id",
            "target_type", "target_key", "target_value",
            "request_payload", "response_payload",
            "status", "error",
            "created_by", "created_at",
        ]
        read_only_fields = fields


class ConnectorAllowlistDomainSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConnectorAllowlistDomain
        fields = ["id", "domain", "is_enabled", "created_at"]
        read_only_fields = ["id", "created_at"]


class ConnectorEndpointSerializer(serializers.ModelSerializer):
    headers = serializers.SerializerMethodField()

    def get_headers(self, obj):
        try:
            return json.loads(obj.headers_text or "{}")
        except Exception:
            return {}
        
    class Meta:
        model = ConnectorEndpoint
        fields = [
            "id", "instance_id",
            "name", "label",
            "target_type", "method",
            "base_url", "path_template",
            "headers_text", "timeout_ms",
            "is_enabled", "created_at",
            "headers"
        ]
        read_only_fields = ["id", "created_at", "instance_id"]


class ConnectorInstanceSerializer(serializers.ModelSerializer):
    endpoints = ConnectorEndpointSerializer(many=True, read_only=True)
    has_secret = serializers.SerializerMethodField()

    class Meta:
        model = ConnectorInstance
        fields = [
            "id", "name", "description",
            "connector_type", "config",
            "is_enabled",
            "created_at",
            "endpoints",
            "has_secret",
        ]
        read_only_fields = ["id", "created_at", "endpoints", "has_secret"]

    def get_has_secret(self, obj: ConnectorInstance) -> bool:
        return bool(obj.encrypted_secret)


class CaseExchangeFollowupSerializer(serializers.ModelSerializer):
    quickpart_name = serializers.CharField(source="quickpart.name", read_only=True, allow_null=True)

    class Meta:
        model = CaseExchangeFollowup
        fields = [
            "id",
            "enabled",
            "delay_value",
            "delay_unit",
            "quickpart",
            "quickpart_name",
            "action",
            "last_triggered_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "quickpart_name", "last_triggered_at", "created_at", "updated_at"]


class CaseExchangeSerializer(serializers.ModelSerializer):
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)
    followup_config = CaseExchangeFollowupSerializer(read_only=True)

    class Meta:
        model = CaseExchange
        fields = [
            "id",
            "case",
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
            "followup_config",
            "raw",
            "created_by",
            "created_by_username",
            "created_at",
        ]
        read_only_fields = ["id", "case", "created_by", "created_by_username", "created_at"]

    def validate_body(self, value):
        return sanitize_html(value)


class CaseExchangeCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CaseExchange
        fields = [
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
            "raw",
        ]

    def validate_body(self, value):
        return sanitize_html(value)

    def validate_raw(self, value):
        if value in (None, ""):
            return {}
        if not isinstance(value, dict):
            raise serializers.ValidationError("Raw must be an object")
        return value
    
    def validate(self, attrs):
        for k in ["to", "cc", "bcc", "references"]:
            v = attrs.get(k)
            if v is None:
                attrs[k] = []
            elif not isinstance(v, list):
                raise serializers.ValidationError({k: "Must be a list"})
        return attrs



class CaseExchangeReplyQuickpartSerializer(serializers.ModelSerializer):
    class Meta:
        model = CaseExchangeReplyQuickpart
        fields = [
            "id",
            "name",
            "description",
            "body",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]

    def validate_name(self, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise serializers.ValidationError("Name is required.")
        return v
        
    def validate_body(self, value):
        return sanitize_html(value)


class TaskCaseLiteSerializer(serializers.ModelSerializer):
    case_number = serializers.IntegerField(read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)

    class Meta:
        model = Event
        fields = ["id", "case_number", "title", "status", "customer_name", "created_at", "updated_at"]


class TaskCaseLinkSerializer(serializers.ModelSerializer):
    case_id = serializers.UUIDField(write_only=True)
    case = TaskCaseLiteSerializer(read_only=True)
    created_by_username = serializers.CharField(source="created_by.username", read_only=True)

    class Meta:
        model = TaskCaseLink
        fields = [
            "id",
            "task",
            "case",
            "case_id",
            "created_by",
            "created_by_username",
            "created_at",
        ]
        read_only_fields = ["id", "task", "case", "created_by", "created_by_username", "created_at"]

    def validate_case_id(self, value):
        request = self.context.get("request")
        user = getattr(request, "user", None)

        qs = Event.objects.filter(id=value, is_deleted=False)

        if user and getattr(user, "is_authenticated", False) and not getattr(user, "is_staff", False):
            customer_ids = get_accessible_customer_ids(user)
            qs = qs.filter(customer_id__in=customer_ids)

        case = qs.first()
        if not case:
            raise serializers.ValidationError("Unknown case")

        task = self.context.get("task")
        if task:
            task_customer_ids = set(task.customers.values_list("id", flat=True))
            if task_customer_ids and case.customer_id and case.customer_id not in task_customer_ids:
                raise serializers.ValidationError("Case customer mismatch")

        self.context["validated_case"] = case
        return value


    def create(self, validated_data):
        validated_data.pop("case_id", None)
        task = self.context["task"]
        case = self.context["validated_case"]
        user = self.context["request"].user

        obj, _ = TaskCaseLink.objects.get_or_create(
            task=task,
            case=case,
            defaults={
                "created_by": user if getattr(user, "is_authenticated", False) else None,
            },
        )
        return obj


class TaskCommentSerializer(serializers.ModelSerializer):
    author_display = serializers.SerializerMethodField()

    class Meta:
        model = TaskComment
        fields = ["id", "task", "text", "created_at", "updated_at", "author_label", "author_display"]
        read_only_fields = ["id", "task", "created_at", "updated_at"]

    def get_author_display(self, obj):
        if obj.author:
            return obj.author.username
        if obj.author_label:
            return obj.author_label
        return ""

    def validate_text(self, value):
        return sanitize_html(value)


class TaskListSerializer(serializers.ModelSerializer):
    owner_id = serializers.IntegerField(source="owner.id", read_only=True, allow_null=True)
    owner_username = serializers.CharField(source="owner.username", read_only=True)
    customer_ids = serializers.SerializerMethodField()
    customer_names = serializers.SerializerMethodField()
    linked_case_count = serializers.IntegerField(read_only=True)
    due_state = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "title",
            "status",
            "priority",
            "due_date",
            "created_at",
            "updated_at",
            "owner",
            "owner_id",
            "owner_username",
            "customer_ids",
            "customer_names",
            "linked_case_count",
            "due_state",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "owner_id", "owner_username", "linked_case_count", "due_state"]

    def get_customer_ids(self, obj):
        return [str(x) for x in obj.customers.values_list("id", flat=True)]

    def get_customer_names(self, obj):
        return list(obj.customers.values_list("name", flat=True))

    def get_due_state(self, obj):
        if not obj.due_date:
            return "none"
        now = timezone.now()
        if obj.status in (Task.Status.DONE, Task.Status.CANCELED):
            return "completed"
        if obj.due_date < now:
            return "overdue"
        if obj.due_date <= now + timezone.timedelta(hours=48):
            return "soon"
        return "normal"


class TaskDetailSerializer(serializers.ModelSerializer):
    owner_id = serializers.PrimaryKeyRelatedField(
        source="owner",
        queryset=User.objects.all(),
        write_only=True,
        required=False,
        allow_null=True,
    )
    owner_id_read = serializers.IntegerField(source="owner.id", read_only=True, allow_null=True)
    owner_username = serializers.CharField(source="owner.username", read_only=True)

    customer_ids = serializers.SerializerMethodField()
    customer_ids_write = serializers.PrimaryKeyRelatedField(
        source="customers",
        queryset=Customer.objects.filter(is_active=True),
        many=True,
        write_only=True,
        required=False,
    )
    customer_names = serializers.SerializerMethodField()

    comments = TaskCommentSerializer(many=True, read_only=True)
    case_links = TaskCaseLinkSerializer(many=True, read_only=True)
    linked_case_count = serializers.IntegerField(read_only=True)
    due_state = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = [
            "id",
            "title",
            "description",
            "status",
            "priority",
            "due_date",
            "created_at",
            "updated_at",
            "owner_id",
            "owner_id_read",
            "owner_username",
            "customer_ids",
            "customer_ids_write",
            "customer_names",
            "comments",
            "case_links",
            "linked_case_count",
            "due_state",
        ]
        read_only_fields = [
            "id",
            "created_at",
            "updated_at",
            "owner_id_read",
            "owner_username",
            "comments",
            "case_links",
            "linked_case_count",
            "due_state",
        ]

    def get_customer_ids(self, obj):
        return [str(x) for x in obj.customers.values_list("id", flat=True)]

    def get_customer_names(self, obj):
        return list(obj.customers.values_list("name", flat=True))

    def get_due_state(self, obj):
        if not obj.due_date:
            return "none"
        now = timezone.now()
        if obj.status in (Task.Status.DONE, Task.Status.CANCELED):
            return "completed"
        if obj.due_date < now:
            return "overdue"
        if obj.due_date <= now + timezone.timedelta(hours=48):
            return "soon"
        return "normal"