from datetime import timedelta

from django.db import migrations, models
import core.sla


def freeze_existing_slas(apps, schema_editor):
    Alert = apps.get_model("core", "Alert")
    connection = schema_editor.connection.alias
    batch = []
    units = {"minute": 60, "hour": 3600, "day": 86400, "week": 604800, "month": 2592000}
    for alert in Alert.objects.using(connection).select_related("customer").iterator(chunk_size=1000):
        rules = alert.customer.sla_rules if alert.customer_id else {}
        raw_rule = rules.get(alert.severity) if isinstance(rules, dict) else None
        rule = None
        seconds = None
        if isinstance(raw_rule, dict):
            try:
                value = int(raw_rule.get("value") or 0)
            except (ValueError, TypeError):
                value = 0
            unit = raw_rule.get("unit")
            if value > 0 and unit in units:
                rule = {"value": value, "unit": unit}
                seconds = value * units[unit]
        due = alert.created_at + timedelta(seconds=seconds) if seconds else None
        alert.sla_snapshot = {
            "customer_id": str(alert.customer_id) if alert.customer_id else None,
            "severity": alert.severity,
            "calendar": {},
            "rule": rule,
            "budget_seconds": seconds,
            "due_at": due.isoformat() if due else None,
        }
        batch.append(alert)
        if len(batch) >= 1000:
            Alert.objects.using(connection).bulk_update(batch, ["sla_snapshot"], batch_size=1000)
            batch.clear()
    if batch:
        Alert.objects.using(connection).bulk_update(batch, ["sla_snapshot"], batch_size=1000)


def add_dashboard_widget(apps, schema_editor):
    Preference = apps.get_model("core", "DashboardPreference")
    for preference in Preference.objects.using(schema_editor.connection.alias).iterator():
        if isinstance(preference.widgets, list) and preference.widgets and "alerts_out_of_hours" not in preference.widgets:
            preference.widgets = [*preference.widgets, "alerts_out_of_hours"]
            preference.save(update_fields=["widgets"])


class Migration(migrations.Migration):
    dependencies = [("core", "0042_instancesyslogsettings")]

    operations = [
        migrations.AddField(
            model_name="customer",
            name="sla_calendar",
            field=models.JSONField(blank=True, default=core.sla.default_calendar),
        ),
        migrations.AddField(
            model_name="alert",
            name="sla_snapshot",
            field=models.JSONField(blank=True, editable=False, null=True),
        ),
        migrations.RunPython(freeze_existing_slas, migrations.RunPython.noop),
        migrations.RunPython(add_dashboard_widget, migrations.RunPython.noop),
    ]
