from django.conf import settings
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

from .models import UserProfile

@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def ensure_profile(sender, instance, created, **kwargs):
    if created:
        UserProfile.objects.create(user=instance)
    else:
        UserProfile.objects.get_or_create(user=instance)


#@receiver(post_delete, sender=Attachment)
#def delete_attachment_file(sender, instance: Attachment, **kwargs):

#    f = getattr(instance, "file", None)
#    if f and f.name:
#        try:
#            f.delete(save=False)
#        except Exception:
#            pass

@receiver(post_delete, sender=settings.AUTH_USER_MODEL)
def delete_report_file(sender, instance, **kwargs):
    f = getattr(instance, "pdf", None)
    if f and f.name:
        try:
            f.delete(save=False)
        except Exception:
            pass


@receiver(post_delete, sender=settings.AUTH_USER_MODEL)
def delete_avatar_file(sender, instance, **kwargs):
    f = getattr(instance, "avatar", None)
    if f and f.name:
        try:
            f.delete(save=False)
        except Exception:
            pass