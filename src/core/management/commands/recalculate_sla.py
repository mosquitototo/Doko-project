from uuid import UUID

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from core.models import Alert, Customer
from core.sla import build_snapshot


class Command(BaseCommand):
    help = "Preview or apply SLA recalculation after configuring customer working calendars."

    def add_arguments(self, parser):
        scope = parser.add_mutually_exclusive_group(required=True)
        scope.add_argument("--customer", help="Customer UUID")
        scope.add_argument("--all", action="store_true", dest="all_customers")
        parser.add_argument("--apply", action="store_true", help="Replace stored SLA snapshots; without this flag nothing is changed.")

    def handle(self, *args, **options):
        alerts = Alert.objects.all()
        if options.get("customer"):
            try:
                customer_id = UUID(options["customer"])
            except (ValueError, TypeError):
                raise CommandError("Invalid customer UUID.") from None
            if not Customer.objects.filter(pk=customer_id).exists():
                raise CommandError("Customer not found.")
            alerts = alerts.filter(customer_id=customer_id)
        count = 0
        with transaction.atomic():
            if options["apply"]:
                alerts = alerts.select_for_update(of=("self",))
            for alert in alerts.select_related("customer").iterator(chunk_size=500):
                snapshot = build_snapshot(alert)
                if snapshot != alert.sla_snapshot:
                    count += 1
                    if options["apply"]:
                        Alert.objects.filter(pk=alert.pk).update(sla_snapshot=snapshot)
        verb = "Recalculated" if options["apply"] else "Would recalculate"
        self.stdout.write(f"{verb} {count} alert SLA snapshots. No alert content or timestamps changed.")
