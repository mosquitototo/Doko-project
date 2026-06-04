import uuid
from pathlib import PurePath

from django.conf import settings
from django.db.models import Q
from django.db import models, transaction
from django.utils import timezone
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator, MaxValueValidator
from django.contrib.postgres.indexes import GinIndex



##############
## Alerts
##############
class Alert(models.Model):
    class Severity(models.TextChoices):
        LOW = "low"
        MEDIUM = "medium"
        HIGH = "high"
        CRITICAL = "critical"

    class Status(models.TextChoices):
        OPEN = "open"
        MERGED = "merged"
        IN_PROGRESS = "in_progress"
        CLOSED = "closed"

    class Outcome(models.TextChoices):
        TPWI = "true_positive_with_impact", "TP with impact"
        TPWOI = "true_positive_without_impact", "TP without impact"
        FPT = "false_positive_technical", "FP technical"
        FP = "false_positive", "False positive"
        LEGIT = "legitimate", "Legitimate"
        NA = "not_applicable", "Not applicable"
        UKN = "unknown", "Unknown"

    case = models.ForeignKey("core.Event", null=True, blank=True, on_delete=models.SET_NULL, related_name="alerts",)
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    classification = models.CharField(max_length=100, default="generic")
    severity = models.CharField(max_length=20, choices=Severity.choices, default=Severity.MEDIUM)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    status_before_merge = models.CharField(max_length=20, choices=Status.choices, blank=True, default="")
    source = models.CharField(max_length=200, blank=True)
    iocs = models.JSONField(default=list, blank=True)
    assets = models.JSONField(default=list, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)
    raw = models.JSONField(default=dict, blank=True)
    sla_acknowledged_at = models.DateTimeField(null=True, blank=True, db_index=True)
    sla_acknowledged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="alerts_sla_acknowledged",
    )
    sla_acknowledgement_invalidated_at = models.DateTimeField(null=True, blank=True)
    members = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="alerts_shared")
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    customer = models.ForeignKey("core.Customer", null=True, blank=True, on_delete=models.PROTECT, related_name="alerts")
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="alerts_owned",)
    outcome = models.CharField(max_length=50, choices=Outcome.choices, default=Outcome.UKN, db_index=True,)

    def __str__(self):
        return self.title


class AlertComment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    alert = models.ForeignKey("core.Alert", on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="alert_comments",)
    author_label = models.CharField(max_length=255, blank=True, default="")
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        author = self.author.username if self.author else (self.author_label or "unknown")
        return f"{author} on {self.alert_id}"
    


##############
## Cases
##############
class Event(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    case_number = models.PositiveIntegerField(unique=True, null=True, blank=True, db_index=True)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events",
    )
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    members = models.ManyToManyField(settings.AUTH_USER_MODEL, blank=True, related_name="events_shared")
    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)
    unarchived_at = models.DateTimeField(null=True, blank=True, db_index=True)
    auto_followup_enabled = models.BooleanField(default=False)
    auto_followup_delay_value = models.PositiveIntegerField(default=24)
    auto_followup_delay_unit = models.CharField(
        max_length=16,
        default="hour",
    )
    auto_followup_quickpart = models.ForeignKey(
        "CaseExchangeReplyQuickpart",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="events_auto_followup",
    )

    class AutoFollowupAction(models.TextChoices):
        SAVE = "save", "Save only"
        SEND = "send", "Send"

    auto_followup_action = models.CharField(
        max_length=10,
        choices=AutoFollowupAction.choices,
        default=AutoFollowupAction.SAVE,
    )

    class Severity(models.TextChoices):
        LOW = "low"
        MEDIUM = "medium"
        HIGH = "high"
        CRITICAL = "critical"

    class Status(models.TextChoices):
        OPEN = "open", "Open"
        IN_PROGRESS = "in_progress", "In progress"
        RESOLVED = "resolved", "Resolved"
        CLOSED = "closed", "Closed"
        ARCHIVED = "archived", "Archived"
    
    class Outcome(models.TextChoices):
        TPWI = "true_positive_with_impact", "TP with impact"
        TPWOI = "true_positive_without_impact", "TP without impact"
        FPT = "false_positive_technical", "FP technical"
        FP = "false_positive", "False positive"
        LEGIT = "legitimate", "Legitimate"
        NA = "not_applicable", "Not applicable"
        UKN = "unknown", "Unknown"

    status = models.CharField(max_length=30, choices=Status.choices, default=Status.OPEN, db_index=True,)
    classification = models.CharField(max_length=100, default="generic")
    severity = models.CharField(max_length=20, choices=Severity.choices, default=Severity.MEDIUM)
    outcome = models.CharField(max_length=50, choices=Outcome.choices, default=Outcome.UKN, db_index=True,)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)
    customer = models.ForeignKey("core.Customer", null=True, blank=True, on_delete=models.PROTECT, related_name="events")
    iocs = models.JSONField(default=list, blank=True)
    assets = models.JSONField(default=list, blank=True)

    @property
    def customer_name(self):
        return self.customer.name if self.customer else None

    @property
    def owner_username(self):
        return self.owner.username if self.owner_id else None

    @property
    def owner_id_read(self):
        return self.owner_id

    @property
    def is_archived(self) -> bool:
        return self.archived_at is not None

    def save(self, *args, **kwargs):
        from django.db import transaction
        from django.db.models import F

        if self.case_number is None:
            with transaction.atomic():
                seq, _ = CaseNumberSequence.objects.select_for_update().get_or_create(id=1, defaults={"next_value": 1})
                self.case_number = seq.next_value
                seq.next_value = F("next_value") + 1
                seq.save(update_fields=["next_value"])

                update_fields = kwargs.get("update_fields")
                if update_fields is not None:
                    update_fields = list(update_fields)
                    if "case_number" not in update_fields:
                        update_fields.append("case_number")
                    kwargs["update_fields"] = update_fields

                super().save(*args, **kwargs)
            return

        return super().save(*args, **kwargs)


    def __str__(self) -> str:
        return f"{self.title} ({self.status})"


class CaseUserState(models.Model):
    event = models.ForeignKey(
        "Event",
        on_delete=models.CASCADE,
        related_name="user_states",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="case_states",
    )
    last_viewed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [("event", "user")]
        indexes = [
            models.Index(fields=["user", "last_viewed_at"]),
        ]


class CaseNumberSequence(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    next_value = models.PositiveIntegerField(default=1)

    def __str__(self):
        return f"CaseNumberSequence(next={self.next_value})"


class CaseRetentionSettings(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)

    auto_archive_after_days = models.PositiveIntegerField(default=365)
    hard_delete_after_days = models.PositiveIntegerField(default=1825)
    
    exchange_send_template = models.ForeignKey(
        "core.InvestigationTemplate",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="case_exchange_send_settings",
    )

    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="case_retention_settings_updates",
    )

    @classmethod
    def get_solo(cls) -> "CaseRetentionSettings":
        obj, _ = cls.objects.get_or_create(
            id=1,
            defaults={
                "auto_archive_after_days": 365,
                "hard_delete_after_days": 1825,
            },
        )
        return obj

    def set_updated_by(self, user):
        self.updated_by = user
        self.save(update_fields=["updated_by", "updated_at"])

    def __str__(self):
        return f"CaseRetentionSettings(archive={self.auto_archive_after_days}d, delete={self.hard_delete_after_days}d)"

#### Case activity
class TimelineItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="timeline_items",)
    date = models.DateField(db_index=True)
    type = models.CharField(max_length=50, default="note")
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="timeline_items",)
    alert = models.ForeignKey("core.Alert", null=True, blank=True, on_delete=models.SET_NULL, related_name="timeline_items",)

    class Meta:
        ordering = ["date", "created_at"]

    def __str__(self) -> str:
        return f"Event {self.event_id} - {self.date} - {self.type}"


#### Case comments
class Comment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="comments",)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="comments",)
    author_label = models.CharField(max_length=255, blank=True, default="")
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        author = self.author.username if self.author else (self.author_label or "unknown")
        return f"{author} on {self.event_id}"


#### Case attachments
def case_attachment_upload_to(instance, filename):
    case_id = str(getattr(instance, "event_id", "") or "unassigned")
    attachment_id = str(getattr(instance, "id", "") or uuid.uuid4())
    suffix = PurePath(filename or "").suffix.lower()

    if len(suffix) > 20:
        suffix = ""

    return f"attachments/{case_id}/{attachment_id}{suffix}"


class Attachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event = models.ForeignKey(Event, on_delete=models.CASCADE, related_name="attachments",)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="attachments",)
    file = models.FileField(upload_to=case_attachment_upload_to)
    original_name = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        return self.original_name or str(self.file)



class CaseExchange(models.Model):
    class Direction(models.TextChoices):
        INBOUND = "inbound", "Inbound"
        OUTBOUND = "outbound", "Outbound"

    class Channel(models.TextChoices):
        EMAIL = "email", "Email"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    case = models.ForeignKey("core.Event", on_delete=models.CASCADE, related_name="exchanges", db_index=True)

    direction = models.CharField(max_length=20, choices=Direction.choices, db_index=True)
    channel = models.CharField(max_length=20, choices=Channel.choices, default=Channel.EMAIL, db_index=True)

    subject = models.CharField(max_length=500, blank=True, default="")
    body = models.TextField(blank=True, default="")

    sender = models.CharField(max_length=500, blank=True, default="")
    to = models.JSONField(default=list, blank=True)
    cc = models.JSONField(default=list, blank=True)
    bcc = models.JSONField(default=list, blank=True)

    message_id = models.CharField(max_length=500, blank=True, default="", db_index=True)
    references = models.JSONField(default=list, blank=True) 

    raw = models.JSONField(default=dict, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="case_exchanges_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["case", "created_at"]),
            models.Index(fields=["case", "direction", "created_at"]),
            GinIndex(fields=["raw"], name="caseexchange_raw_gin"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["case", "message_id"],
                name="uniq_case_message_id",
                condition=~models.Q(message_id=""),
            )
        ]

    def __str__(self) -> str:
        return f"{self.case_id} {self.direction} {self.channel} {self.created_at}"


class CaseExchangeFollowup(models.Model):
    class Action(models.TextChoices):
        SAVE = "save", "Save only"
        SEND = "send", "Send"

    class DelayUnit(models.TextChoices):
        MINUTE = "minute", "Minute"
        HOUR = "hour", "Hour"
        DAY = "day", "Day"
        WEEK = "week", "Week"
        MONTH = "month", "Month"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    exchange = models.OneToOneField(
        "core.CaseExchange",
        on_delete=models.CASCADE,
        related_name="followup_config",
    )
    enabled = models.BooleanField(default=True)
    delay_value = models.PositiveIntegerField(default=24)
    delay_unit = models.CharField(max_length=16, choices=DelayUnit.choices, default=DelayUnit.HOUR)
    quickpart = models.ForeignKey(
        "core.CaseExchangeReplyQuickpart",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="exchange_followups",
    )
    action = models.CharField(max_length=10, choices=Action.choices, default=Action.SAVE)
    last_triggered_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=["enabled", "updated_at"]),
            models.Index(fields=["action", "enabled"]),
        ]


class CaseExchangeReplyQuickpart(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    name = models.CharField(max_length=160)
    description = models.CharField(max_length=255, blank=True, default="")
    body = models.TextField(blank=True, default="")

    is_active = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "case_exchange_reply_quickparts"
        ordering = ["name", "-updated_at"]

    def __str__(self) -> str:
        return self.name
 
   



##############
## Global auditlogs
##############
class AuditLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    created_at = models.DateTimeField(auto_now_add=True)

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_logs",
    )
    actor_username = models.CharField(max_length=160, blank=True, default="")

    action = models.CharField(max_length=180, db_index=True)
    object_type = models.CharField(max_length=80, blank=True, default="")
    object_id = models.CharField(max_length=80, blank=True, default="")
    object_repr = models.CharField(max_length=255, blank=True, default="")

    success = models.BooleanField(default=True)
    status_code = models.IntegerField(null=True, blank=True)

    ip_address = models.CharField(max_length=64, blank=True, default="")
    user_agent = models.CharField(max_length=255, blank=True, default="")
    method = models.CharField(max_length=12, blank=True, default="")
    path = models.CharField(max_length=255, blank=True, default="")

    request_id = models.UUIDField(null=True, blank=True)

    duration_ms = models.IntegerField(null=True, blank=True)

    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "audit_logs"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.created_at} {self.action} {self.actor_username or '-'}"


@receiver(post_save, sender=AuditLog)
def queue_audit_log_splunk_hec_export(sender, instance: AuditLog, created: bool, **kwargs):
    if not created:
        return

    audit_log_id = str(instance.id)

    def enqueue():
        try:
            from .celerytasks import send_audit_log_to_splunk_hec_task
            send_audit_log_to_splunk_hec_task.delay(audit_log_id)
        except Exception:
            pass

    transaction.on_commit(enqueue)


### 1y
class AuditLogRetentionSettings(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    max_days = models.PositiveIntegerField(default=365)
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="audit_retention_updates",
    )

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(
            id=1,
            defaults={"max_days": 365},
        )
        return obj

    def set_updated_by(self, user):
        self.updated_by = user
        self.save(update_fields=["updated_by", "updated_at"])

    def __str__(self):
        return f"AuditLogRetentionSettings(max_days={self.max_days})"
    

##############
## Others
##############
class Permission(models.Model):
    code = models.CharField(max_length=100, unique=True)
    label = models.CharField(max_length=200, blank=True)


class Role(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    permissions = models.ManyToManyField(Permission, blank=True, related_name="roles")


class UserRole(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="user_roles")
    role = models.ForeignKey(Role, on_delete=models.CASCADE, related_name="user_roles")

    class Meta:
        unique_together = [("user", "role")]


class Severity(models.Model):
    code = models.CharField(max_length=50, unique=True)
    label = models.CharField(max_length=100)
    order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.label


class Classification(models.Model):
    code = models.CharField(max_length=80, unique=True)
    label = models.CharField(max_length=120)
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return self.label


class Customer(models.Model):
    class SlaUnit(models.TextChoices):
        MINUTE = "minute", "Minute"
        HOUR = "hour", "Hour"
        DAY = "day", "Day"
        WEEK = "week", "Week"
        MONTH = "month", "Month"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200, unique=True)
    sla = models.CharField(max_length=200, blank=True)
    sla_rules = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def get_sla_rule(self, severity: str) -> dict | None:
        code = (severity or "").strip()
        if not code or not isinstance(self.sla_rules, dict):
            return None

        rule = self.sla_rules.get(code)
        if not isinstance(rule, dict):
            return None

        try:
            value = int(rule.get("value") or 0)
        except Exception:
            return None

        unit = (rule.get("unit") or "").strip()
        if value < 1 or unit not in {"minute", "hour", "day", "week", "month"}:
            return None

        return {"value": value, "unit": unit}

    def get_sla_delta(self, severity: str):
        rule = self.get_sla_rule(severity)
        if not rule:
            return None

        value = rule["value"]
        unit = rule["unit"]

        if unit == "minute":
            return timezone.timedelta(minutes=value)
        if unit == "hour":
            return timezone.timedelta(hours=value)
        if unit == "day":
            return timezone.timedelta(days=value)
        if unit == "week":
            return timezone.timedelta(weeks=value)
        if unit == "month":
            return timezone.timedelta(days=value * 30)

        return None

    def __str__(self):
        return self.name


class CustomerContact(models.Model):
    public_id = models.UUIDField(default=uuid.uuid4, editable=False, unique=True, db_index=True)
    customer = models.ForeignKey("core.Customer", on_delete=models.CASCADE, related_name="contacts")
    name = models.CharField(max_length=200)
    email = models.CharField(max_length=255, blank=True)
    phone = models.CharField(max_length=50, blank=True)
    title = models.CharField(max_length=200, blank=True)
    is_active = models.BooleanField(default=True, db_index=True)

    def __str__(self):
            return f"{self.name} ({self.customer_id})"


class CustomerAccess(models.Model):
    customer = models.ForeignKey("core.Customer", on_delete=models.CASCADE, related_name="access_rules")
    role = models.ForeignKey("core.Role", null=True, blank=True, on_delete=models.CASCADE, related_name="customer_access_rules")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="customer_access")

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    (Q(user__isnull=False) & Q(role__isnull=True)) |
                    (Q(user__isnull=True) & Q(role__isnull=False))
                ),
                name="customeraccess_exactly_one_of_user_or_role",
            ),

            models.UniqueConstraint(
                fields=["customer", "user"],
                condition=Q(role__isnull=True),
                name="uniq_customer_user_access",
            ),

            models.UniqueConstraint(
                fields=["customer", "role"],
                condition=Q(user__isnull=True),
                name="uniq_customer_role_access",
            ),
        ]


class WorkbookTemplate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)


class WorkbookTemplateItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(
        WorkbookTemplate,
        related_name="items",
        on_delete=models.CASCADE,
    )
    label = models.CharField(max_length=255)
    order = models.PositiveIntegerField(default=0)


class WorkbookInstance(models.Model):
    event = models.OneToOneField(
        Event,
        related_name="workbook_instance",
        on_delete=models.CASCADE,
    )
    template = models.ForeignKey(
        WorkbookTemplate,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
            return f"Workbook for event {self.event_id}"


class WorkbookInstanceItem(models.Model):
    instance = models.ForeignKey(
        WorkbookInstance,
        related_name="items",
        on_delete=models.CASCADE,
    )
    label = models.CharField(max_length=255)
    order = models.PositiveIntegerField(default=0)
    is_done = models.BooleanField(default=False)



##############
## Reports
##############
class ReportTemplate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    name = models.CharField(max_length=120)
    description = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)

    html = models.TextField()
    css = models.TextField(blank=True, default="")

    version = models.PositiveIntegerField(default=1)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="report_templates_created"
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.name} (v{self.version})"


def report_upload_to(instance, filename):
    ts = instance.created_at or timezone.now()
    return f"reports/{instance.case_id}/{ts:%Y/%m/%d}/{instance.id}.pdf"


class ReportInstance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    case = models.ForeignKey("Event", on_delete=models.CASCADE, related_name="reports")
    template = models.ForeignKey(ReportTemplate, null=True, blank=True, on_delete=models.SET_NULL, related_name="reports")

    template_name = models.CharField(max_length=120, blank=True, default="")
    template_version = models.PositiveIntegerField(default=1)
    template_html_snapshot = models.TextField(blank=True, default="")
    template_css_snapshot = models.TextField(blank=True, default="")

    params = models.JSONField(default=dict, blank=True)

    pdf = models.FileField(upload_to=report_upload_to, null=True, blank=True)

    generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="reports_generated"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Report {self.id} for case {self.case_id}"
    

##############
## Incident timeline (visual)
##############
class IncidentTimelineItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    case = models.ForeignKey(
        "core.Event",
        on_delete=models.CASCADE,
        related_name="incident_timeline_items",
        db_index=True,
    )

    occurred_at = models.DateTimeField(db_index=True, default=timezone.now)

    title = models.CharField(max_length=200)
    details = models.TextField(blank=True, default="")

    kind = models.CharField(max_length=80, blank=True, default="event")

    source = models.CharField(max_length=30, blank=True, default="manual")

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="incident_timeline_items_created",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


    class Severity(models.TextChoices):
        INFO = "info", "Info"
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        CRITICAL = "critical", "Critical"

    severity = models.CharField(
        max_length=20,
        choices=Severity.choices,
        default=Severity.INFO,
        db_index=True,
    )


    class Meta:
        ordering = ["occurred_at", "created_at"]
        indexes = [
            models.Index(fields=["case", "occurred_at"]),
            models.Index(fields=["case", "created_at"]),
        ]


    def __str__(self):
        return f"{self.case_id} - {self.occurred_at} - {self.title}"


class Addon(models.Model):
    id = models.CharField(primary_key=True, max_length=80)
    name = models.CharField(max_length=200)
    version = models.CharField(max_length=40, default="1.0.0")
    description = models.TextField(blank=True, default="")

    base_url = models.CharField(max_length=500, blank=True, default="")
    encrypted_secret = models.TextField(blank=True, default="")

    is_enabled = models.BooleanField(default=True)
    installed_at = models.DateTimeField(auto_now_add=True)

    def set_secret(self, value: str) -> None:
        from .crypto_secrets import encrypt_secret
        self.encrypted_secret = encrypt_secret(value)

    def get_secret(self) -> str:
        from .crypto_secrets import decrypt_secret
        return decrypt_secret(self.encrypted_secret)


class AddonAction(models.Model):
    class Scope(models.TextChoices):
        CASE = "case", "Case"
        IOC = "ioc", "IoC"
        ASSET = "asset", "Asset"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    addon = models.ForeignKey(Addon, on_delete=models.CASCADE, related_name="actions")

    action_id = models.CharField(max_length=120)
    label = models.CharField(max_length=200)
    scope = models.CharField(max_length=20, choices=Scope.choices)

    method = models.CharField(max_length=10, default="POST")
    path = models.CharField(max_length=300, default="/")
    timeout_ms = models.PositiveIntegerField(default=5000)

    is_enabled = models.BooleanField(default=True)

    class Meta:
        unique_together = [("addon", "action_id")]


class ActionRun(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    addon = models.ForeignKey(Addon, null=True, blank=True, on_delete=models.PROTECT)
    action = models.ForeignKey(AddonAction, null=True, blank=True, on_delete=models.PROTECT)

    connector_instance = models.ForeignKey(
        "core.ConnectorInstance", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="action_runs"
    )
    connector_endpoint = models.ForeignKey(
        "core.ConnectorEndpoint", null=True, blank=True,
        on_delete=models.SET_NULL, related_name="action_runs"
    )

    scope = models.CharField(max_length=20)
    target_id = models.CharField(max_length=100)

    requested_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    status = models.CharField(max_length=30, default="pending")
    http_status = models.IntegerField(null=True, blank=True)
    result_message = models.TextField(blank=True, default="")

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(connector_instance__isnull=False) & Q(connector_endpoint__isnull=False),
                name="actionrun_requires_connector_instance_and_endpoint",
            )
        ]



class ConnectorResult(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    case = models.ForeignKey("core.Event", on_delete=models.CASCADE, related_name="connector_results")
    instance = models.ForeignKey("core.ConnectorInstance", null=True, blank=True, on_delete=models.CASCADE, related_name="results")
    endpoint = models.ForeignKey("core.ConnectorEndpoint", null=True, blank=True, on_delete=models.SET_NULL, related_name="results")

    action_id = models.CharField(max_length=120)

    class TargetType(models.TextChoices):
        CASE = "case", "Case"
        IOC = "ioc", "IoC"
        ASSET = "asset", "Asset"

    target_type = models.CharField(max_length=20, choices=TargetType.choices, db_index=True)
    target_key = models.CharField(max_length=120, blank=True, default="", db_index=True)
    target_value = models.TextField(blank=True, default="", db_index=True)

    request_payload = models.JSONField(default=dict, blank=True)
    response_payload = models.JSONField(default=dict, blank=True)

    class Status(models.TextChoices):
        SUCCESS = "success", "Success"
        ERROR = "error", "Error"

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUCCESS, db_index=True)
    error = models.TextField(blank=True, default="")

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["case", "target_type"]),
            models.Index(fields=["case", "target_type", "target_key"]),
        ]


class ConnectorAllowlistDomain(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    domain = models.CharField(max_length=255, unique=True, db_index=True)
    is_enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.domain


class ConnectorInstance(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    name = models.CharField(max_length=120, db_index=True)
    description = models.TextField(blank=True, default="")
    is_enabled = models.BooleanField(default=True)

    connector_type = models.CharField(max_length=50, default="http", db_index=True)

    config = models.JSONField(default=dict, blank=True)

    encrypted_secret = models.TextField(blank=True, default="")

    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.name


class ConnectorEndpoint(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    instance = models.ForeignKey("core.ConnectorInstance", on_delete=models.CASCADE, related_name="endpoints")

    name = models.CharField(max_length=120)
    label = models.CharField(max_length=200, blank=True, default="")

    class TargetType(models.TextChoices):
        CASE = "case", "Case"
        IOC = "ioc", "IoC"
        ASSET = "asset", "Asset"

    target_type = models.CharField(max_length=20, choices=TargetType.choices, db_index=True)

    method = models.CharField(max_length=10, default="GET")
    base_url = models.CharField(max_length=500, default="")
    path_template = models.CharField(max_length=500, default="")

    headers_text = models.TextField(blank=True, default="{}")

    timeout_ms = models.PositiveIntegerField(default=8000)
    is_enabled = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("instance", "name")]
        indexes = [models.Index(fields=["instance", "target_type"])]
        constraints = [
            models.CheckConstraint(
                condition=Q(timeout_ms__gte=1000) & Q(timeout_ms__lte=60000),
                name="connector_endpoint_timeout_ms_range",
            )
        ]

    def clean(self):
        import json
        if self.headers_text:
            try:
                parsed = json.loads(self.headers_text)
                if not isinstance(parsed, dict):
                    raise ValidationError("headers_text must be a JSON object")
            except (json.JSONDecodeError, ValueError):
                raise ValidationError("headers_text must be valid JSON")
            
    def __str__(self) -> str:
        return f"{self.instance.name} / {self.name}"


##############
## user profile
##############
class UserProfile(models.Model):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    timezone = models.CharField(max_length=64, blank=True, default="Europe/Paris")
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)

    def __str__(self):
        return f"profile:{self.user_id}"


## signals
@receiver(post_delete, sender=Attachment)
def delete_attachment_file(sender, instance: Attachment, **kwargs):

    f = getattr(instance, "file", None)
    if f and f.name:
        try:
            f.delete(save=False)
        except Exception:
            pass


##############
## Hunts
##############
class Hunt(models.Model):
    class Status(models.TextChoices):
        TO_DO = "to_do", "To do"
        IN_PROGRESS = "in_progress", "In progress"
        COMPLETED = "completed", "Completed"
        ABANDONED = "abandoned", "Abandoned"

    class Verdict(models.TextChoices):
        UNKNOWN = "unknown", "Unknown"
        SUSPICIOUS = "suspicious", "Suspicious"
        MALICIOUS = "malicious", "Malicious"
        BENIGN = "benign", "Benign"
        FALSE_POSITIVE = "false_positive", "False positive"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    title = models.CharField(max_length=200)
    context = models.TextField(blank=True, default="")
    conclusion = models.TextField(blank=True, default="")

    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TO_DO, db_index=True)
    verdict = models.CharField(max_length=30, choices=Verdict.choices, default=Verdict.UNKNOWN, db_index=True)

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="hunts_owned",
    )
    reviewers = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="hunts_reviewing",
    )

    customer = models.ForeignKey(
        "core.Customer",
        null=True,
        blank=True,
        on_delete=models.PROTECT,
        related_name="hunts",
    )

    investigation_started_at = models.DateTimeField(null=True, blank=True, db_index=True)
    investigation_finished_at = models.DateTimeField(null=True, blank=True, db_index=True)
    search_timeframe_start = models.DateTimeField(null=True, blank=True, db_index=True)
    search_timeframe_end = models.DateTimeField(null=True, blank=True, db_index=True)

    iocs = models.JSONField(default=list, blank=True)
    assets = models.JSONField(default=list, blank=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="hunts_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    archived_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]

    @property
    def customer_name(self):
        return self.customer.name if self.customer else None

    #@property
    #def customer_id(self):
    #    return self.customer.id if self.customer else None

    @property
    def owner_username(self):
        return self.owner.username if self.owner_id else None

    @property
    def owner_id_read(self):
        return self.owner_id

    def __str__(self) -> str:
        return f"{self.title} ({self.status})"


class HuntJournalEntry(models.Model):
    class EntryType(models.TextChoices):
        NOTE = "note", "Note"
        QUERY = "query", "Query"
        FINDING = "finding", "Finding"
        PIVOT = "pivot", "Pivot"
        ESCALATION = "escalation", "Escalation"
        CONNECTOR_RUN = "connector_run", "Connector run"
        DECISION = "decision", "Decision"
        CONCLUSION = "conclusion", "Conclusion"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hunt = models.ForeignKey("core.Hunt", on_delete=models.CASCADE, related_name="journal_entries", db_index=True)
    entry_type = models.CharField(max_length=30, choices=EntryType.choices, default=EntryType.NOTE, db_index=True)
    text = models.TextField()

    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="hunt_journal_entries",
    )

    occurred_at = models.DateTimeField(default=timezone.now, db_index=True)
    linked_ioc_value = models.CharField(max_length=500, blank=True, default="")
    linked_asset_value = models.CharField(max_length=500, blank=True, default="")
    linked_action_run_id = models.CharField(max_length=100, blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["occurred_at", "created_at"]

    def __str__(self) -> str:
        return f"{self.hunt_id} - {self.entry_type} - {self.occurred_at}"


class HuntCaseLink(models.Model):
    class LinkType(models.TextChoices):
        RELATED = "related", "Related"
        CREATED_FROM_HUNT = "created_from_hunt", "Created from hunt"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    hunt = models.ForeignKey("core.Hunt", on_delete=models.CASCADE, related_name="case_links", db_index=True)
    case = models.ForeignKey("core.Event", on_delete=models.CASCADE, related_name="hunt_links", db_index=True)
    link_type = models.CharField(max_length=30, choices=LinkType.choices, default=LinkType.RELATED, db_index=True)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="hunt_case_links_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        constraints = [
            models.UniqueConstraint(fields=["hunt", "case"], name="uniq_hunt_case_link"),
        ]

    def __str__(self) -> str:
        return f"{self.hunt_id} -> {self.case_id} ({self.link_type})"
    

class AIProvider(models.Model):
    PROVIDER_KIND_CHOICES = [
        ("litellm", "LiteLLM"),
        ("openai_compatible", "OpenAI Compatible"),
        ("other", "Other"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120, unique=True)
    code = models.SlugField(max_length=80, unique=True)
    provider_kind = models.CharField(max_length=40, choices=PROVIDER_KIND_CHOICES)
    base_url = models.URLField(max_length=500)
    api_key_secret_ref = models.CharField(max_length=255, blank=True, default="")
    default_model = models.CharField(max_length=255)
    timeout_seconds = models.PositiveIntegerField(default=60)
    is_enabled = models.BooleanField(default=True)
    is_default = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    default_system_prompt = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["name"]
        constraints = [
            models.CheckConstraint(
                condition=Q(timeout_seconds__gte=1) & Q(timeout_seconds__lte=120),
                name="ai_provider_timeout_seconds_range",
            )
        ]

    def set_api_key(self, value: str) -> None:
        from .crypto_secrets import encrypt_secret
        self.api_key_secret_ref = encrypt_secret(value)

    def get_api_key(self) -> str:
        from .crypto_secrets import decrypt_secret
        return decrypt_secret(self.api_key_secret_ref)


class SOARProvider(models.Model):
    PROVIDER_KIND_CHOICES = [
        ("generic_http", "Generic HTTP"),
        ("n8n", "n8n"),
        ("splunk_soar", "Splunk SOAR"),
        ("xsoar", "XSOAR"),
        ("other", "Other"),
    ]

    AUTH_TYPE_CHOICES = [
        ("none", "None"),
        ("bearer", "Bearer"),
        ("basic", "Basic"),
        ("header", "Header"),
        ("query", "Query parameter"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120, unique=True)
    code = models.SlugField(max_length=80, unique=True)

    provider_kind = models.CharField(
        max_length=40,
        choices=PROVIDER_KIND_CHOICES,
        default="generic_http",
        db_index=True,
    )

    base_url = models.URLField(max_length=500)

    auth_type = models.CharField(
        max_length=20,
        choices=AUTH_TYPE_CHOICES,
        default="bearer",
    )

    auth_secret_ref = models.CharField(max_length=255, blank=True, default="")

    auth_config = models.JSONField(default=dict, blank=True)
    auth_config_schema = models.JSONField(default=dict, blank=True)

    request_config = models.JSONField(default=dict, blank=True)
    response_config = models.JSONField(default=dict, blank=True)
    status_config = models.JSONField(default=dict, blank=True)

    verify_ssl = models.BooleanField(default=True)
    timeout_seconds = models.PositiveIntegerField(default=90)
    is_enabled = models.BooleanField(default=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        constraints = [
            models.CheckConstraint(
                condition=Q(timeout_seconds__gte=1) & Q(timeout_seconds__lte=120),
                name="soar_provider_timeout_seconds_range",
            )
        ]

    def __str__(self) -> str:
        return self.name


class InvestigationTemplate(models.Model):
    ENTITY_TYPE_CHOICES = [
        ("ip", "IP"),
        ("user", "User"),
        ("host", "Host"),
        ("domain", "Domain"),
        ("hash", "Hash"),
        ("url", "URL"),
        ("email", "Email"),
        ("generic", "Generic"),
    ]

    TARGET_KIND_CHOICES = [
        ("single", "Single"),
        ("batch", "Batch"),
    ]

    RISK_LEVEL_CHOICES = [
        ("low", "Low"),
        ("medium", "Medium"),
        ("high", "High"),
    ]

    EXECUTION_MODE_CHOICES = [
        ("provider_default", "Provider default"),
        ("sync", "Synchronous"),
        ("async", "Asynchronous"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    code = models.SlugField(max_length=80, unique=True)
    name = models.CharField(max_length=120)
    description = models.TextField(blank=True)
    selection_hint = models.TextField(blank=True)

    entity_type = models.CharField(max_length=32, choices=ENTITY_TYPE_CHOICES)
    target_kind = models.CharField(max_length=32, choices=TARGET_KIND_CHOICES, default="single")

    chat_command = models.CharField(max_length=64, unique=True, null=True, blank=True)
    command_help = models.CharField(max_length=255, blank=True, default="")
    ai_context = models.TextField(blank=True, default="")
    default_variables = models.JSONField(default=dict, blank=True)
    prompt_overrides_schema = models.JSONField(default=dict, blank=True)

    soar_provider = models.ForeignKey(
        SOARProvider,
        on_delete=models.PROTECT,
        related_name="investigation_templates",
    )

    remote_template_code = models.CharField(
        max_length=255,
        help_text="Remote identifier of the target playbook, workflow, webhook or action.",
    )

    allowed_variables_schema = models.JSONField(default=dict, blank=True)

    input_mapping = models.JSONField(default=dict, blank=True)
    output_mapping = models.JSONField(default=dict, blank=True)
    status_mapping = models.JSONField(default=dict, blank=True)

    execution_config = models.JSONField(default=dict, blank=True)

    execution_mode = models.CharField(
        max_length=20,
        choices=EXECUTION_MODE_CHOICES,
        default="provider_default",
    )

    max_time_range_hours = models.PositiveIntegerField(default=24)
    risk_level = models.CharField(max_length=16, choices=RISK_LEVEL_CHOICES, default="low")
    is_enabled = models.BooleanField(default=True)
    version = models.PositiveIntegerField(default=1)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]
        indexes = [
            models.Index(fields=["soar_provider", "is_enabled"]),
            models.Index(fields=["entity_type", "target_kind"]),
        ]

    def __str__(self) -> str:
        return self.name


#########
## Chatbot
#########
class ChatSession(models.Model):
    SURFACE_CHOICES = [
        ("dedicated", "Dedicated"),
        ("contextual", "Contextual"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_sessions")
    title = models.CharField(max_length=255, blank=True)
    surface = models.CharField(max_length=32, choices=SURFACE_CHOICES)
    page_type = models.CharField(max_length=32, blank=True)
    object_id = models.CharField(max_length=64, blank=True)
    customer_id = models.CharField(max_length=64, blank=True, db_index=True)
    client_tab_id = models.CharField(max_length=120)
    is_archived = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        indexes = [
            models.Index(fields=["user", "surface", "updated_at"]),
            models.Index(fields=["client_tab_id"]),
        ]


class ChatMessage(models.Model):
    ROLE_CHOICES = [
        ("user", "User"),
        ("assistant", "Assistant"),
        ("system", "System"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name="messages")
    role = models.CharField(max_length=16, choices=ROLE_CHOICES)
    content = models.TextField()
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]


class ChatContextSnapshot(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name="snapshots")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_snapshots")
    page_type = models.CharField(max_length=32, blank=True)
    object_id = models.CharField(max_length=64, blank=True)
    current_tab = models.CharField(max_length=64, blank=True)
    inclusions = models.JSONField(default=list, blank=True)
    context_payload = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]


class ChatRun(models.Model):
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name="runs")
    snapshot = models.ForeignKey(ChatContextSnapshot, on_delete=models.PROTECT, related_name="runs")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="chat_runs")
    request_id = models.CharField(max_length=120)
    client_tab_id = models.CharField(max_length=120)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="queued")
    provider = models.ForeignKey(AIProvider, on_delete=models.PROTECT, related_name="chat_runs")
    prompt = models.TextField()
    response_text = models.TextField(blank=True)
    error_message = models.TextField(blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    selected_template_code = models.CharField(max_length=100, blank=True, default="")
    selected_command = models.CharField(max_length=64, blank=True, default="")
    provider_execution = models.JSONField(default=dict, blank=True)
    cancel_requested = models.BooleanField(default=False)
    cancel_requested_at = models.DateTimeField(null=True, blank=True)
    worker_task_id = models.CharField(max_length=255, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]
        unique_together = [("session", "request_id")]
        indexes = [
            models.Index(fields=["user", "client_tab_id", "status"]),
            models.Index(fields=["session", "created_at"]),
        ]


class ChatGeneratedDraft(models.Model):
    TARGET_TYPE_CHOICES = [
        ("case_comment", "Case comment"),
        ("alert_comment", "Alert comment"),
        ("hunt_note", "Hunt note"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    run = models.ForeignKey(ChatRun, on_delete=models.CASCADE, related_name="drafts")
    target_type = models.CharField(max_length=32, choices=TARGET_TYPE_CHOICES)
    target_id = models.CharField(max_length=64)
    content = models.TextField()
    is_posted = models.BooleanField(default=False)
    posted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["target_type", "target_id", "is_posted"]),
            models.Index(fields=["run", "is_posted"]),
        ]


class ChatActionRun(models.Model):
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
        ("cancelled", "Cancelled"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    run = models.ForeignKey(
        ChatRun,
        on_delete=models.CASCADE,
        related_name="actions",
    )

    template = models.ForeignKey(
        InvestigationTemplate,
        on_delete=models.PROTECT,
        related_name="action_runs",
    )

    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="queued", db_index=True)

    input_payload = models.JSONField(default=dict, blank=True)
    request_payload = models.JSONField(default=dict, blank=True)
    output_payload = models.JSONField(default=dict, blank=True)
    raw_response_payload = models.JSONField(default=dict, blank=True)

    remote_run_id = models.CharField(max_length=255, blank=True, default="", db_index=True)
    remote_status = models.CharField(max_length=64, blank=True, default="")

    error_message = models.TextField(blank=True)

    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status", "created_at"]),
            models.Index(fields=["template", "created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.template_id} / {self.status}"


##############
## Dashboard
##############
class DashboardPreference(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="dashboard_preference",
    )
    widgets = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "dashboard_preferences"

    def __str__(self) -> str:
        return f"dashboard-preferences:{self.user_id}"


##############
## Automation rules
##############
class AutomationRule(models.Model):
    class Scope(models.TextChoices):
        ALERT = "alert", "Alert"
        CASE = "case", "Case"
        HUNT = "hunt", "Hunt"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=160)
    scope = models.CharField(max_length=20, choices=Scope.choices, db_index=True)
    is_enabled = models.BooleanField(default=True, db_index=True)

    conditions = models.JSONField(default=dict, blank=True)
    actions = models.JSONField(default=list, blank=True)

    run_once_per_target = models.BooleanField(default=True)
    cooldown_seconds = models.PositiveIntegerField(default=0)
    stop_on_first_action_error = models.BooleanField(default=False)

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="automation_rules_created",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="automation_rules_updated",
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        ordering = ["name", "created_at"]
        indexes = [
            models.Index(fields=["scope", "is_enabled"]),
            models.Index(fields=["updated_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.scope})"


class AutomationExecutionLog(models.Model):
    class Status(models.TextChoices):
        RUNNING = "running", "Running"
        SUCCESS = "success", "Success"
        PARTIAL_SUCCESS = "partial_success", "Partial success"
        FAILED = "failed", "Failed"
        SKIPPED = "skipped", "Skipped"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    rule = models.ForeignKey(
        "core.AutomationRule",
        on_delete=models.CASCADE,
        related_name="execution_logs",
    )

    scope = models.CharField(max_length=20, db_index=True)
    target_id = models.CharField(max_length=80, db_index=True)
    trigger = models.CharField(max_length=120, blank=True, default="", db_index=True)

    matched = models.BooleanField(default=False)
    status = models.CharField(
        max_length=30,
        choices=Status.choices,
        default=Status.RUNNING,
        db_index=True,
    )

    context = models.JSONField(default=dict, blank=True)
    actions_results = models.JSONField(default=list, blank=True)
    error = models.TextField(blank=True, default="")

    started_at = models.DateTimeField(auto_now_add=True, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-started_at"]
        indexes = [
            models.Index(fields=["rule", "target_id"]),
            models.Index(fields=["scope", "target_id", "started_at"]),
            models.Index(fields=["status", "started_at"]),
            GinIndex(fields=["actions_results"], name="automationlog_actions_gin"),
        ]

    def __str__(self) -> str:
        return f"{self.rule_id} {self.scope}:{self.target_id} {self.status}"
    

##############
## Instance settings
##############
class InstanceProxySettings(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    enabled = models.BooleanField(default=False)
    host = models.CharField(max_length=255, blank=True, default="")
    port = models.PositiveIntegerField(null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(65535)])
    username = models.CharField(max_length=255, blank=True, default="")
    password_secret_ref = models.TextField(blank=True, default="")
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="instance_proxy_settings_updates",
    )

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(id=1)
        return obj

    def set_password(self, value: str) -> None:
        from .crypto_secrets import encrypt_secret
        self.password_secret_ref = encrypt_secret(value)

    def get_password(self) -> str:
        from .crypto_secrets import decrypt_secret
        if not self.password_secret_ref:
            return ""
        return decrypt_secret(self.password_secret_ref)

    def __str__(self):
        return f"InstanceProxySettings(enabled={self.enabled}, host={self.host}, port={self.port})"


class InstanceSplunkHecSettings(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    enabled = models.BooleanField(default=False)
    endpoint = models.URLField(max_length=500, blank=True, default="")
    token_secret_ref = models.TextField(blank=True, default="")
    index = models.CharField(max_length=120, blank=True, default="")
    source = models.CharField(max_length=200, blank=True, default="doko:audit")
    sourcetype = models.CharField(max_length=120, blank=True, default="_json")
    updated_at = models.DateTimeField(auto_now=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="instance_splunk_hec_settings_updates",
    )

    @classmethod
    def get_solo(cls):
        obj, _ = cls.objects.get_or_create(
            id=1,
            defaults={
                "enabled": False,
                "endpoint": "",
                "index": "",
                "source": "doko:audit",
                "sourcetype": "_json",
            },
        )
        return obj

    def set_token(self, value: str) -> None:
        from .crypto_secrets import encrypt_secret
        self.token_secret_ref = encrypt_secret(value)

    def get_token(self) -> str:
        from .crypto_secrets import decrypt_secret
        if not self.token_secret_ref:
            return ""
        return decrypt_secret(self.token_secret_ref)

    def to_public_dict(self) -> dict:
        return {
            "enabled": self.enabled,
            "endpoint": self.endpoint or "",
            "has_token": bool(self.token_secret_ref),
            "index": self.index or "",
            "source": self.source or "doko:audit",
            "sourcetype": self.sourcetype or "_json",
        }

    def __str__(self):
        return f"InstanceSplunkHecSettings(enabled={self.enabled}, endpoint={self.endpoint})"


class InstanceBackup(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    filename = models.CharField(max_length=255, unique=True)
    file_path = models.CharField(max_length=1024)
    file_size = models.BigIntegerField(default=0)
    content_type = models.CharField(max_length=100, default="application/octet-stream")
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="instance_backups_created",
    )
    sha256 = models.CharField(max_length=64, blank=True, default="")

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return self.filename


##############
## Tasks
##############
class Task(models.Model):
    class Status(models.TextChoices):
        TO_DO = "to_do", "To do"
        IN_PROGRESS = "in_progress", "In progress"
        DONE = "done", "Done"
        CANCELED = "canceled", "Canceled"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        MEDIUM = "medium", "Medium"
        HIGH = "high", "High"
        CRITICAL = "critical", "Critical"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")

    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.TO_DO,
        db_index=True,
    )
    priority = models.CharField(
        max_length=20,
        choices=Priority.choices,
        default=Priority.MEDIUM,
        db_index=True,
    )

    due_date = models.DateTimeField(null=True, blank=True, db_index=True)

    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tasks_owned",
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="tasks_created",
    )

    customers = models.ManyToManyField(
        "core.Customer",
        blank=True,
        related_name="tasks",
    )
    members = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        blank=True,
        related_name="tasks_shared",
    )

    is_deleted = models.BooleanField(default=False, db_index=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True, db_index=True)

    class Meta:
        ordering = ["-updated_at", "-created_at"]
        indexes = [
            models.Index(fields=["status", "priority"]),
            models.Index(fields=["due_date", "status"]),
        ]


    def __str__(self) -> str:
        return self.title


class TaskComment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task = models.ForeignKey("core.Task", on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="task_comments",
    )
    author_label = models.CharField(max_length=255, blank=True, default="")
    text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["created_at"]

    def __str__(self) -> str:
        author = self.author.username if self.author else (self.author_label or "unknown")
        return f"{author} on task {self.task_id}"


class TaskCaseLink(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    task = models.ForeignKey("core.Task", on_delete=models.CASCADE, related_name="case_links")
    case = models.ForeignKey("core.Event", on_delete=models.CASCADE, related_name="task_links")

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="task_case_links_created",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at"]
        unique_together = [("task", "case")]

    def __str__(self) -> str:
        return f"{self.task_id} -> {self.case_id}"