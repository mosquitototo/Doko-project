from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0039_rename_event_case")]

    operations = [
        migrations.AddField(
            model_name="connectorendpoint",
            name="body_template",
            field=models.JSONField(blank=True, default=None, null=True),
        )
    ]
