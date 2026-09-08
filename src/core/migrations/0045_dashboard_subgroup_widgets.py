from django.db import migrations


def add_subgroup_widgets(apps, schema_editor):
    Preference = apps.get_model("core", "DashboardPreference")
    for preference in Preference.objects.using(schema_editor.connection.alias).iterator():
        if isinstance(preference.widgets, list) and preference.widgets:
            additions = [
                widget for widget in ("alerts_by_subgroup_period", "cases_by_subgroup_period")
                if widget not in preference.widgets
            ]
            if additions:
                preference.widgets = [*preference.widgets, *additions]
                preference.save(update_fields=["widgets"])


class Migration(migrations.Migration):
    dependencies = [("core", "0044_customer_subgroups")]

    operations = [migrations.RunPython(add_subgroup_widgets, migrations.RunPython.noop)]
