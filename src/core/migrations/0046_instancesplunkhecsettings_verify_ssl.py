from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0045_dashboard_subgroup_widgets")]

    operations = [
        migrations.AddField(
            model_name="instancesplunkhecsettings",
            name="verify_ssl",
            field=models.BooleanField(default=True),
        ),
    ]
