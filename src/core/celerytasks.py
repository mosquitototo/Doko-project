from celery import shared_task

from dateutil.relativedelta import relativedelta

from django.db import transaction
from django.db.models import F
from django.db.models.functions import Coalesce, Greatest
from django.utils import timezone

from .models import Event, Alert, Hunt, TimelineItem, CaseRetentionSettings, Attachment, AuditLog, ChatRun, CaseExchange, CaseExchangeReplyQuickpart, CaseExchangeFollowup
from .services_chat import execute_chat_run
from .audit import audit_event


@shared_task
def auto_archive_cases() -> dict:
    s, _ = CaseRetentionSettings.objects.get_or_create(id=1)

    days = int(s.auto_archive_after_days or 0)
    if days <= 0:
        return {
            "archived_cases": 0,
            "archived_hunts": 0,
            "days": days,
            "disabled": True,
        }

    now = timezone.now()
    cutoff = now - timezone.timedelta(days=days)

    case_qs = (
        Event.objects
        .filter(is_deleted=False, archived_at__isnull=True)
        .annotate(
            last_activity=Greatest(
                F("updated_at"),
                Coalesce(F("unarchived_at"), F("updated_at")),
            )
        )
        .filter(last_activity__lte=cutoff)
    )
    case_ids = list(case_qs.values_list("id", flat=True)[:2000])

    hunt_ids = list(
        Hunt.objects
        .filter(is_deleted=False, archived_at__isnull=True, updated_at__lte=cutoff)
        .values_list("id", flat=True)[:2000]
    )

    if not case_ids and not hunt_ids:
        return {
            "archived_cases": 0,
            "archived_hunts": 0,
            "days": days,
        }

    with transaction.atomic():
        if case_ids:
            Event.objects.filter(id__in=case_ids, archived_at__isnull=True).update(
                archived_at=now,
                status="closed",
            )

            TimelineItem.objects.bulk_create([
                TimelineItem(
                    event_id=eid,
                    date=now.date(),
                    type="case_archived",
                    text=f"Case auto-archived after {days} day(s)",
                    actor=None,
                )
                for eid in case_ids
            ])

        if hunt_ids:
            Hunt.objects.filter(id__in=hunt_ids, archived_at__isnull=True).update(
                archived_at=now,
                status="abandoned",
            )

    return {
        "archived_cases": len(case_ids),
        "archived_hunts": len(hunt_ids),
        "days": days,
    }



@shared_task
def hard_delete_cases() -> dict:
    s, _ = CaseRetentionSettings.objects.get_or_create(id=1)

    days = int(s.hard_delete_after_days or 0)
    if days <= 0:
        return {"deleted": 0, "days": days, "disabled": True}

    now = timezone.now()
    cutoff = now - timezone.timedelta(days=days)

    case_soft_ids = list(
        Event.objects
        .filter(is_deleted=True, deleted_at__isnull=False, deleted_at__lte=cutoff)
        .values_list("id", flat=True)[:2000]
    )

    case_archived_qs = (
        Event.objects
        .filter(is_deleted=False, archived_at__isnull=False)
        .annotate(
            last_activity=Greatest(
                F("updated_at"),
                Coalesce(F("unarchived_at"), F("updated_at")),
            )
        )
        .filter(last_activity__lte=cutoff)
    )
    case_archived_ids = list(case_archived_qs.values_list("id", flat=True)[:2000])

    case_ids = list(dict.fromkeys([*case_soft_ids, *case_archived_ids]))

    alert_ids = list(
        Alert.objects
        .filter(is_deleted=True, deleted_at__isnull=False, deleted_at__lte=cutoff)
        .values_list("id", flat=True)[:2000]
    )

    hunt_soft_ids = list(
        Hunt.objects
        .filter(is_deleted=True, deleted_at__isnull=False, deleted_at__lte=cutoff)
        .values_list("id", flat=True)[:2000]
    )

    hunt_archived_ids = list(
        Hunt.objects
        .filter(is_deleted=False, archived_at__isnull=False, updated_at__lte=cutoff)
        .values_list("id", flat=True)[:2000]
    )

    hunt_ids = list(dict.fromkeys([*hunt_soft_ids, *hunt_archived_ids]))

    if not case_ids and not alert_ids and not hunt_ids:
        return {"deleted": 0, "days": days}

    with transaction.atomic():
        if case_ids:
            Attachment.objects.filter(event_id__in=case_ids).delete()

            TimelineItem.objects.bulk_create([
                TimelineItem(
                    event_id=eid,
                    date=now.date(),
                    type="case_deleted",
                    text=f"Case auto-deleted after {days} day(s)",
                    actor=None,
                )
                for eid in case_ids
            ])

            Event.objects.filter(id__in=case_ids).delete()

        if alert_ids:
            Alert.objects.filter(id__in=alert_ids).delete()

        if hunt_ids:
            Hunt.objects.filter(id__in=hunt_ids).delete()

    return {
        "deleted_cases": len(case_ids),
        "deleted_alerts": len(alert_ids),
        "deleted_hunts": len(hunt_ids),
        "days": days,
        "case_soft_deleted_purged": len(case_soft_ids),
        "case_archived_purged": len(case_archived_ids),
        "hunt_soft_deleted_purged": len(hunt_soft_ids),
        "hunt_archived_purged": len(hunt_archived_ids),
    }


@shared_task
def purge_audit_logs() -> dict:
    s, _ = CaseRetentionSettings.objects.get_or_create(id=1)

    days = int(s.auto_archive_after_days or 0)
    if days <= 0:
        return {"deleted": 0, "days": days, "disabled": True}

    now = timezone.now()
    cutoff = now - timezone.timedelta(days=days)

    ids = list(
        AuditLog.objects
        .filter(created_at__lt=cutoff)
        .order_by("created_at")
        .values_list("id", flat=True)[:2000]
    )

    if not ids:
        return {"deleted": 0, "days": days}

    with transaction.atomic():
        deleted, _ = AuditLog.objects.filter(id__in=ids).delete()

    return {"deleted": deleted, "days": days}


@shared_task(bind=True)
def execute_chat_run_task(self, run_id: str):
    run = (
        ChatRun.objects
        .select_related("provider", "snapshot", "session", "user")
        .filter(id=run_id)
        .first()
    )
    if not run:
        return

    if run.cancel_requested:
        if run.status not in {"completed", "failed", "cancelled"}:
            run.status = "cancelled"
            run.completed_at = timezone.now()
            run.save(update_fields=["status", "completed_at", "updated_at"])
        return

    if run.worker_task_id != (self.request.id or ""):
        run.worker_task_id = self.request.id or ""
        run.save(update_fields=["worker_task_id", "updated_at"])

    execute_chat_run(run)



def _followup_threshold(now, delay_value: int, delay_unit: str):
    delay_value = max(1, int(delay_value or 1))

    if delay_unit == "minute":
        return now - timezone.timedelta(minutes=delay_value)
    if delay_unit == "hour":
        return now - timezone.timedelta(hours=delay_value)
    if delay_unit == "day":
        return now - timezone.timedelta(days=delay_value)
    if delay_unit == "week":
        return now - timezone.timedelta(weeks=delay_value)
    if delay_unit == "month":
        return now - relativedelta(months=delay_value)

    return now - timezone.timedelta(hours=delay_value)


def _send_followup_if_needed(case, followup, action: str):
    if action != "send":
        return

    try:
        from .views import dispatch_case_exchange_send

        dispatch_case_exchange_send(case, followup, None)
    except Exception as exc:
        raw = followup.raw or {}
        raw["send_status"] = "error"
        raw["send_error"] = str(exc)[:1000]
        followup.raw = raw
        followup.save(update_fields=["raw"])


@shared_task
def run_case_auto_followups():
    now = timezone.now()
    created = 0
    skipped = 0
    reasons = {}

    def skip(reason: str):
        nonlocal skipped
        skipped += 1
        reasons[reason] = reasons.get(reason, 0) + 1
        
    exchange_followups = (
        CaseExchangeFollowup.objects
        .filter(
            enabled=True,
            last_triggered_at__isnull=True,
        )
        .select_related(
            "exchange",
            "exchange__case",
            "quickpart",
        )
        .order_by("exchange__created_at", "created_at")
    )

    for cfg in exchange_followups:
        source = cfg.exchange
        case = source.case

        if not case or case.is_deleted or case.archived_at:
            skip("case_deleted_or_archived")
            continue

        if not cfg.quickpart or not cfg.quickpart.is_active:
            skip("quickpart_missing_or_inactive")
            continue

        threshold = _followup_threshold(now, cfg.delay_value, cfg.delay_unit)

        if source.created_at > threshold:
            skip("delay_not_reached")
            continue

        replied = CaseExchange.objects.filter(
            case=case,
            direction="inbound",
            created_at__gt=source.created_at,
        ).exists()

        if replied:
            cfg.enabled = False
            cfg.save(update_fields=["enabled", "updated_at"])
            skip("inbound_reply_exists")
            continue

        already_followed_up = CaseExchange.objects.filter(
            case=case,
            direction="outbound",
            raw__kind="auto_followup",
            raw__source_exchange_id=str(source.id),
        ).exists()

        if already_followed_up:
            cfg.enabled = False
            cfg.last_triggered_at = now
            cfg.save(update_fields=["enabled", "last_triggered_at", "updated_at"])
            skip("already_followed_up")
            continue

        with transaction.atomic():
            followup = CaseExchange.objects.create(
                case=case,
                created_by=None,
                direction="outbound",
                channel=source.channel or "email",
                sender="",
                to=list(source.to or []),
                cc=list(source.cc or []),
                bcc=list(source.bcc or []),
                subject=source.subject or "",
                body=cfg.quickpart.body or "",
                message_id="",
                references=list(source.references or []),
                raw={
                    "kind": "auto_followup",
                    "source_exchange_id": str(source.id),
                    "followup_config_id": str(cfg.id),
                    "quickpart_id": str(cfg.quickpart.id),
                    "action": cfg.action,
                },
            )

            cfg.enabled = False
            cfg.last_triggered_at = now
            cfg.save(update_fields=["enabled", "last_triggered_at", "updated_at"])

            TimelineItem.objects.create(
                event=case,
                date=now.date(),
                type="case_exchange_created",
                text=f"Automatic follow-up created: {(followup.subject or '(no subject)')}",
                actor=None,
            )

        _send_followup_if_needed(case, followup, cfg.action)
        created += 1

    cases = (
        Event.objects
        .filter(
            is_deleted=False,
            archived_at__isnull=True,
            auto_followup_enabled=True,
            auto_followup_quickpart__isnull=False,
        )
        .select_related("auto_followup_quickpart")
    )

    for case in cases:
        delay_value = int(case.auto_followup_delay_value or 24)
        delay_unit = str(case.auto_followup_delay_unit or "hour")
        threshold = _followup_threshold(now, delay_value, delay_unit)

        last_outbound = (
            CaseExchange.objects
            .filter(case=case, direction="outbound")
            .order_by("-created_at")
            .first()
        )

        if not last_outbound:
            continue

        if last_outbound.created_at > threshold:
            continue

        replied = CaseExchange.objects.filter(
            case=case,
            direction="inbound",
            created_at__gt=last_outbound.created_at,
        ).exists()

        if replied:
            continue

        already_followed_up = CaseExchange.objects.filter(
            case=case,
            direction="outbound",
            created_at__gt=last_outbound.created_at,
            raw__kind="auto_followup",
        ).exists()

        if already_followed_up:
            continue

        qp = case.auto_followup_quickpart
        if not qp or not qp.is_active:
            continue

        followup = CaseExchange.objects.create(
            case=case,
            created_by=None,
            direction="outbound",
            channel=last_outbound.channel or "email",
            sender="",
            to=list(last_outbound.to or []),
            cc=list(last_outbound.cc or []),
            bcc=list(last_outbound.bcc or []),
            subject=last_outbound.subject or "",
            body=qp.body or "",
            message_id="",
            references=list(last_outbound.references or []),
            raw={
                "kind": "auto_followup",
                "source_exchange_id": str(last_outbound.id),
                "quickpart_id": str(qp.id),
                "action": case.auto_followup_action,
            },
        )

        case.auto_followup_enabled = False
        case.save(update_fields=["auto_followup_enabled", "updated_at"])

        TimelineItem.objects.create(
            event=case,
            date=now.date(),
            type="case_exchange_created",
            text=f"Automatic follow-up created: {(followup.subject or '(no subject)')}",
            actor=None,
        )

        _send_followup_if_needed(case, followup, case.auto_followup_action)
        created += 1

    return {"created": created, "skipped": skipped}


@shared_task
def run_scheduled_automation_rules_task():
    from .services_automation import run_scheduled_automation_rules

    return run_scheduled_automation_rules()


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_audit_log_to_splunk_hec_task(self, audit_log_id: str):
    audit_log = AuditLog.objects.filter(id=audit_log_id).first()

    if not audit_log:
        return {"sent": False, "reason": "not_found", "audit_log_id": audit_log_id}

    try:
        from .services_splunk_hec import send_audit_log_to_splunk_hec
        send_audit_log_to_splunk_hec(audit_log)
        return {"sent": True, "audit_log_id": audit_log_id}
    except Exception as exc:
        raise self.retry(exc=exc)


@shared_task
def run_automation_investigation_template_action_task(
    *,
    scope: str,
    target_id: str,
    event: str,
    action: dict,
    actor_id: str | None = None,
    data: dict | None = None,
):
    from django.contrib.auth import get_user_model
    from .models import Event, Alert, Hunt, AutomationExecutionLog
    from .services_automation import AutomationContext, _run_investigation_template

    target = None

    if scope == "case":
        target = Event.objects.filter(id=target_id, is_deleted=False).first()
    elif scope == "alert":
        target = Alert.objects.filter(id=target_id, is_deleted=False).first()
    elif scope == "hunt":
        target = Hunt.objects.filter(id=target_id, is_deleted=False).first()

    if not target:
        return {
            "status": "skipped",
            "reason": "target_not_found",
            "scope": scope,
            "target_id": target_id,
        }

    actor = None

    if actor_id:
        User = get_user_model()
        actor = User.objects.filter(id=actor_id, is_active=True).first()

    ctx = AutomationContext(
        scope=scope,
        target=target,
        event=event,
        actor=actor,
        data=data or {},
    )

    template_id = str((action or {}).get("template_id") or "")
    if template_id:
        recent_cutoff = timezone.now() - timezone.timedelta(seconds=120)
        already_running = AutomationExecutionLog.objects.filter(
            scope=scope,
            target_id=target_id,
            status__in=["running", "success", "partial_success"],
            started_at__gte=recent_cutoff,
            actions_results__contains=[{"result": {"queued": True, "template_id": template_id}}],
        ).exists()

        if already_running:
            return {
                "status": "skipped",
                "reason": "duplicate_execution",
                "scope": scope,
                "target_id": target_id,
            }

    result = _run_investigation_template(ctx, action if isinstance(action, dict) else {})

    return {
        "status": "success",
        "scope": scope,
        "target_id": target_id,
        "result": result,
    }