from django.conf import settings
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

from .models import Alert, ReportInstance, UserProfile
from .sla import alert_snapshot


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
