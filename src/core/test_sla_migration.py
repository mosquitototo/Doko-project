from datetime import datetime, timezone

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class SlaMigrationTests(TransactionTestCase):
    def test_upgrade_keeps_content_and_deadlines_and_adds_widget_without_reordering(self):
        old_target = [("core", "0042_instancesyslogsettings")]
        new_target = [("core", "0043_customer_sla_calendar_alert_snapshot")]
        executor = MigrationExecutor(connection)
        executor.migrate(old_target)
        try:
            apps = executor.loader.project_state(old_target).apps
            Customer = apps.get_model("core", "Customer")
            Alert = apps.get_model("core", "Alert")
            User = apps.get_model("auth", "User")
            Preference = apps.get_model("core", "DashboardPreference")
            customer = Customer.objects.create(name="Before calendar", sla_rules={"medium": {"value": 1, "unit": "day"}})
            user = User.objects.create(username="before-calendar")
            pref = Preference.objects.create(user=user, widgets=["alerts_open", "sla_global"])
            alert = Alert.objects.create(customer=customer, title="Keep title", description="Keep description", raw={"keep": "raw"})
            created = datetime(2026, 9, 11, 13, tzinfo=timezone.utc)
            Alert.objects.filter(pk=alert.pk).update(created_at=created, updated_at=created)
            executor = MigrationExecutor(connection)
            executor.migrate(new_target)
            new_apps = executor.loader.project_state(new_target).apps
            upgraded = new_apps.get_model("core", "Alert").objects.get(pk=alert.pk)
            self.assertEqual(datetime.fromisoformat(upgraded.sla_snapshot["due_at"]), datetime(2026, 9, 12, 13, tzinfo=timezone.utc))
            self.assertEqual(upgraded.created_at, created)
            self.assertEqual(upgraded.updated_at, created)
            self.assertEqual(upgraded.description, "Keep description")
            self.assertEqual(upgraded.raw, {"keep": "raw"})
            self.assertEqual(upgraded.customer_id, customer.pk)
            self.assertEqual(new_apps.get_model("core", "DashboardPreference").objects.get(pk=pref.pk).widgets, ["alerts_open", "sla_global", "alerts_out_of_hours"])
        finally:
            MigrationExecutor(connection).migrate(new_target)
