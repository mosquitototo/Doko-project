from django.conf import settings
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver
from django.utils import timezone

from .models import Alert, Case, CaseExchange, CaseExchangeFollowup, ReportInstance, UserProfile
from .sla import alert_snapshot


@receiver(post_save, sender=CaseExchange)
def stop_answered_exchange_followups(sender, instance, raw=False, using="default", **kwargs):
    if raw or instance.direction != "inbound":
        return
    configs = CaseExchangeFollowup.objects.using(using).filter(
        enabled=True, exchange__case_id=instance.case_id,
        exchange__created_at__lt=instance.created_at,
    ).select_related("exchange")
    ids = [cfg.pk for cfg in configs if instance.is_reply_to(cfg.exchange)]
    if ids:
        CaseExchangeFollowup.objects.using(using).filter(pk__in=ids).update(enabled=False, updated_at=timezone.now())


@receiver(post_save, sender=Alert)
@receiver(post_save, sender=Case)
def remove_foreign_customer_subgroups(sender, instance, raw=False, **kwargs):
    if raw:
        return
    foreign_ids = list(instance.subgroups.exclude(customer_id=instance.customer_id).values_list("id", flat=True))
    if foreign_ids:
        instance.subgroups.remove(*foreign_ids)


@receiver(post_save, sender=Alert)
def preserve_alert_sla(sender, instance, raw=False, using="default", **kwargs):
    if raw:
        return
    snapshot = alert_snapshot(instance)
    if snapshot != instance.sla_snapshot:
        sender.objects.using(using).filter(pk=instance.pk).update(sla_snapshot=snapshot)
        instance.sla_snapshot = snapshot

@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def ensure_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)
    else:
        UserProfile.objects.get_or_create(user=instance)


@receiver(post_delete, sender=ReportInstance)
def delete_report_file(sender, instance, **kwargs):
    f = getattr(instance, "pdf", None)
    if f and f.name:
        try:
            f.delete(save=False)
        except Exception:
            pass


@receiver(post_delete, sender=UserProfile)
def delete_avatar_file(sender, instance, **kwargs):
    f = getattr(instance, "avatar", None)
    if f and f.name:
        try:
            f.delete(save=False)
        except Exception:
            pass
