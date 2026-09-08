import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [("core", "0043_customer_sla_calendar_alert_snapshot")]

    operations = [
        migrations.CreateModel(
            name="CustomerSubgroup",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("name", models.CharField(max_length=200)),
                ("description", models.TextField(blank=True)),
                ("contacts", models.JSONField(blank=True, default=list)),
                ("customer", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="subgroups", to="core.customer")),
            ],
            options={"ordering": ["name", "id"]},
        ),
        migrations.AddField(model_name="alert", name="subgroups", field=models.ManyToManyField(blank=True, related_name="alerts", to="core.customersubgroup")),
        migrations.AddField(model_name="case", name="subgroups", field=models.ManyToManyField(blank=True, related_name="cases", to="core.customersubgroup")),
    ]
