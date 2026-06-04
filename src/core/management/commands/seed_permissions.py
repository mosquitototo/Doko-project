from django.core.management.base import BaseCommand
from core.models import Permission

DEFAULT_PERMS = [
    # Cases
    ("case.view", "View cases"),
    ("case.add", "Add cases"),
    ("case.update", "Update cases"),
    ("case.delete", "Delete cases"),

    # Alerts
    ("alert.view", "View alerts"),
    ("alert.add", "Add alerts"),
    ("alert.update", "Update alerts"),
    ("alert.delete", "Delete alerts"),
    ("alert.merge", "Merge alert into case"),
    ("alert.unmerge", "Unmerge alert from case"),
    ("alert.escalate", "Escalate alert to new case"),

    # Alerts
    ("hunt.view", "View hunts"),
    ("hunt.create", "Create hunts"),
    ("hunt.manage", "Manage hunts"),

    # Tasks
    ("task.view", "View tasks"),
    ("task.add", "Add tasks"),
    ("task.manage", "Manage all tasks"),

    # Settings / RBAC / Users
    ("settings.access.users.view", "View users"),
    ("settings.access.users.manage", "Manage users"),
    ("settings.access.users.delete", "delete users"),

    # Settings / RBAC / Roles
    ("settings.access.roles.view", "View roles"),
    ("settings.access.roles.manage", "Manage roles"),
    ("settings.access.roles.delete", "Delete roles"),

    # Settings / Data models
    ("settings.data_models.view", "View data models"),
    ("settings.data_models.manage", "Manage data models"),
    ("settings.data_models.delete", "Delete data models"),

    # Settings / Reports
    ("settings.reports.view", "View reports"),
    ("settings.reports.manage", "Manage reports"),
    ("settings.reports.delete", "Delete reports"),

    # Settings / Customers
    ("settings.customers.view", "View customers"),
    ("settings.customers.manage", "Manage customers"),
    ("settings.customers.delete", "Delete customers"),

    # Settings / Workbooks
    ("settings.workbooks.view", "View workbooks"),
    ("settings.workbooks.manage", "Manage workbooks"),
    ("settings.workbooks.delete", "Delete workbooks"),

    # Settings / Connectors
    ("settings.connectors.view", "View connectors"),
    ("settings.connectors.manage", "Manage connectors"),
    ("settings.connectors.delete", "Delete connectors"),

    # Settings / Case management
    ("settings.case_management.view", "View case management"),
    ("settings.case_management.manage", "Manage case management"),

    # Settings / Audit
    ("settings.audit.view", "View audit"),

    # Settings / Instance
    ("settings.instance.manage", "Manage instance settings"),

    # Settings / AIAndSOAR
    ("settings.aisoar.view", "View AIAndSOAR settings"),
    ("settings.aisoar.manage", "Manage AIAndSOAR settings"),

    # Settings / Chatbot
    ("chat.use", "Chatbot use"),
    ("chat.llm.use", "Chatbot LLM use"),
    ("chat.soar.use", "Chatbot SOAR use"),
    ("chat.read.case", "Chatbot read case"),
    ("chat.read.alert", "Chatbot read alert"),
    ("chat.read.hunt", "Chatbot read hunt"),
    ("chat.read.task", "Chatbot read task"),
    ("chat.read.dashboard", "Chatbot read dashboard"),
    ("chat.read.audit", "Chatbot read audit"),
    ("chat.comment.case.generate", "Chatbot comment case generation"),
    ("chat.comment.case.post", "Chatbot comment case post"),
    ("chat.comment.alert.generate", "Chatbot comment alert generation"),
    ("chat.comment.alert.post", "Chatbot comment alert post"),
    ("chat.comment.hunt.generate", "Chatbot comment hunt generation"),
    ("chat.comment.hunt.post", "Chatbot comment hunt post"),
    ("chat.provider.manage", "Chatbot provider manage"),
    ("chat.template.manage", "Chatbot template manage"),

    # Settings / Automation rules
    ("settings.automation_rules.view", "View automation rules"),
    ("settings.automation_rules.manage", "Manage automation rules"),
    ("settings.automation_rules.delete", "Delete automation rules"),

    # Settings / Documentation
    ("settings.documentation.view", "View Doko documentation"),
]


class Command(BaseCommand):
    help = "Seed default permission codes."

    def handle(self, *args, **options):
        created = 0
        updated = 0

        for code, label in DEFAULT_PERMS:
            obj, was_created = Permission.objects.get_or_create(code=code, defaults={"label": label})
            if was_created:
                created += 1
            else:
                if label and obj.label != label:
                    obj.label = label
                    obj.save(update_fields=["label"])
                    updated += 1

        self.stdout.write(self.style.SUCCESS(f"Permissions: created={created}, updated={updated}, total={Permission.objects.count()}"))
