from django.core.management.base import BaseCommand
from core.models import Severity, Classification, Customer
import uuid

SEVERITIES = [
    ("low", "Low", 10),
    ("medium", "Medium", 20),
    ("high", "High", 30),
    ("critical", "Critical", 40),
]

CLASSIFICATIONS = [
    ("generic", "Generic"),
    ("malware", "Malware"),
    ("phishing", "Phishing"),
    ("spear_phishing", "Spear phishing"),
    ("spam", "Spam"),
    ("scam", "Scam"),
    ("data_leak", "Data leak"),
    ("spoofing", "Spoofing"),
    ("account_compromise_unprivileged", "Account compromise - Unprivileged"),
    ("account_compromise_privileged", "Account compromise - Privileged"),
    ("workstation_compromise_admin", "Workstation compromise - Admin"),
    ("workstation_compromise", "Workstation compromise"),
    ("third_party_compromise", "Third party compromise"),
    ("server_compromise", "Server compromise"),
    ("reconnaissance", "Reconnaissance"),
    ("intrusion_attempts", "Intrusion attempts"),
    ("other", "Other"),
    ("dos", "Denial of service"),
    ("outage", "Outage (no malice)"),
    ("out_of_scope", "Out of scope"),
    ("vulnerability", "Vulnerability"),
    ("data_exposure", "Data exposure"),
]

DEFAULT_CUSTOMER_ID = uuid.UUID("00000000-0000-0000-0000-000000000001")


class Command(BaseCommand):
    help = "Seed default severities, classifications and default customer (idempotent)."

    def handle(self, *args, **kwargs):
        for code, label, order in SEVERITIES:
            Severity.objects.update_or_create(code=code, defaults={"label": label, "order": order})

        for code, label in CLASSIFICATIONS:
            Classification.objects.update_or_create(code=code, defaults={"label": label})

        defaults = {"name": "Default"}
        if hasattr(Customer, "is_active"):
            defaults["is_active"] = True

        Customer.objects.update_or_create(
            id=DEFAULT_CUSTOMER_ID,
            defaults=defaults,
        )

        self.stdout.write(self.style.SUCCESS("Seeded severities + classifications + default customer"))
