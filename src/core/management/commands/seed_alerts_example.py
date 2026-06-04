import random
import uuid
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone
from django.contrib.auth import get_user_model

from core.models import Alert, Customer


CLASSIFICATIONS = ["generic", "malware", "phishing"]
SOURCES = ["seed", "edr", "siem", "antispam", "waf", "ids"]

TITLE_BANK = {
    "generic": [
        "Suspicious outbound connection",
        "Brute force attempt detected",
        "Abnormal authentication pattern",
        "Unusual DNS query pattern",
        "Potential data exfiltration behavior",
    ],
    "phishing": [
        "Possible phishing email detected",
        "Credential harvesting attempt",
        "Suspicious OAuth consent grant",
        "Lookalike domain in email campaign",
        "Mailbox rule creation suspected",
    ],
    "malware": [
        "Malware execution detected",
        "Suspicious PowerShell activity",
        "Encoded script execution",
        "Persistence mechanism detected",
        "Ransomware-like behavior suspected",
    ],
}

DESC_BANK = {
    "generic": [
        "Telemetry indicates anomalous network behavior requiring triage.",
        "Multiple indicators suggest suspicious activity on the asset.",
        "Observed patterns match known suspicious tradecraft; investigate further.",
    ],
    "phishing": [
        "User received an email with suspicious link and urgent call-to-action.",
        "Mail gateway flagged message for potential credential theft techniques.",
        "Indicators suggest a phishing lure with brand impersonation.",
    ],
    "malware": [
        "EDR detected behavior matching a known malware family.",
        "Execution chain suggests malicious payload delivery and staging.",
        "Suspicious script activity indicates possible malware dropper execution.",
    ],
}

SEVERITIES = [
    Alert.Severity.LOW,
    Alert.Severity.MEDIUM,
    Alert.Severity.HIGH,
    Alert.Severity.CRITICAL,
]

STATUSES = [
    Alert.Status.OPEN,
]


def _rand_ip() -> str:
    return f"{random.choice([23, 45, 62, 77, 81, 91, 104, 141, 185])}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"


def _rand_hash32() -> str:
    return uuid.uuid4().hex


def _rand_domain(run_tag: str) -> str:
    roots = ["login", "secure", "account", "update", "verify", "portal", "auth"]
    tlds = ["com", "net", "org", "co", "io"]
    return f"{random.choice(roots)}-{run_tag[:6]}-{random.randint(10,999)}.{random.choice(tlds)}"


def _rand_url(run_tag: str) -> str:
    return f"http://{_rand_domain(run_tag)}/signin"


def _rand_host() -> str:
    prefixes = ["ws", "laptop", "srv", "dc", "proxy", "mail", "jump", "siem"]
    teams = ["it", "finance", "sales", "hr", "sec", "eng", "ops"]
    return f"{random.choice(prefixes)}-{random.choice(teams)}-{random.randint(1,99):02d}"


def _build_iocs(classification: str, run_tag: str):
    iocs = []
    if classification in ("generic", "phishing"):
        iocs.append({"type": "ip", "value": _rand_ip()})
    if classification == "phishing":
        iocs.append({"type": "url", "value": _rand_url(run_tag)})
        iocs.append({"type": "domain", "value": _rand_domain(run_tag)})
    if classification == "malware":
        iocs.append({"type": "hash", "value": _rand_hash32()})
        iocs.append({"type": "ip", "value": _rand_ip()})
    return iocs


def _build_assets():
    return [
        {"type": "host", "value": _rand_host()},
        {"type": "user", "value": f"user{random.randint(1,50)}@company.com"},
    ]


class Command(BaseCommand):
    help = "Seed sample cybersecurity alerts. Supports --force and generates varied data per run."

    def add_arguments(self, parser):
        parser.add_argument(
            "--force",
            action="store_true",
            help="Seed even if non-deleted alerts already exist.",
        )
        parser.add_argument(
            "--n",
            type=int,
            default=15,
            help="Number of alerts to create (default: 15).",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        force = bool(options.get("force"))
        n = int(options.get("n") or 15)

        active_exists = Alert.objects.filter(is_deleted=False).exists()
        if active_exists and not force:
            self.stdout.write(
                self.style.WARNING(
                    "Non-deleted alerts already exist. Use --force to seed anyway."
                )
            )
            return

        User = get_user_model()
        user = User.objects.filter(is_superuser=True).first() or User.objects.first()
        if not user:
            self.stdout.write(self.style.ERROR("No user found. Create a superuser first."))
            return

        customer = Customer.objects.first()

        now = timezone.now()
        run_tag = timezone.now().strftime("%Y%m%d%H%M%S") + "-" + uuid.uuid4().hex[:6]

        created = 0
        for i in range(n):
            classification = random.choice(CLASSIFICATIONS)
            title = random.choice(TITLE_BANK[classification])
            desc = random.choice(DESC_BANK[classification])

            severity = random.choice(SEVERITIES)
            status = random.choice(STATUSES)

            created_at = now - timedelta(days=random.randint(0, 30), hours=random.randint(0, 23))
            updated_at = created_at + timedelta(hours=random.randint(0, 72))

            alert = Alert.objects.create(
                title=f"{title}",
                description=desc,
                classification=classification,
                severity=severity,
                status=status,
                source=random.choice(SOURCES),
                iocs=_build_iocs(classification, run_tag),
                assets=_build_assets(),
                created_by=user,
                customer=customer,
                created_at=created_at,
                updated_at=updated_at,
            )

            alert.members.add(user)

            created += 1

        self.stdout.write(self.style.SUCCESS(f"Seeded {created} alerts (run_tag={run_tag})."))
