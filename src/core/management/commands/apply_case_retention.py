from django.core.management.base import BaseCommand
from django.utils import timezone
from django.db import transaction

from core.models import Event, CaseRetentionSettings

class Command(BaseCommand):
    help = "Apply case retention policy: auto-archive then hard delete archived cases after expiration."

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Do not write changes, only print counts.")

    def handle(self, *args, **options):
        dry = options["dry_run"]
        settings, _ = CaseRetentionSettings.objects.get_or_create(id=1)

        now = timezone.now()
        archive_cutoff = now - timezone.timedelta(days=settings.auto_archive_after_days)
        delete_cutoff = now - timezone.timedelta(days=settings.hard_delete_after_days)

        to_archive = Event.objects.filter(
            archived_at__isnull=True,
            is_deleted=False,
            created_at__lt=archive_cutoff,
        )

        to_delete = Event.objects.filter(
            archived_at__isnull=False,
            archived_at__lt=delete_cutoff,
        )

        self.stdout.write(f"Retention settings: archive_after={settings.auto_archive_after_days}d delete_after={settings.hard_delete_after_days}d")
        self.stdout.write(f"Candidates: archive={to_archive.count()} delete={to_delete.count()}")

        if dry:
            self.stdout.write("Dry-run enabled, no changes applied.")
            return

        with transaction.atomic():
            archived_count = to_archive.update(archived_at=now)
            delete_count = to_delete.count()
            to_delete.delete()

        self.stdout.write(self.style.SUCCESS(f"Done: archived={archived_count} hard_deleted={delete_count}"))
