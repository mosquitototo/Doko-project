from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("core", "0047_data_model_limits_and_severity_color")]

    operations = [
        migrations.AlterField(model_name="alert", name="severity", field=models.CharField(default="medium", max_length=50)),
        migrations.AlterField(model_name="case", name="severity", field=models.CharField(default="medium", max_length=50)),
    ]
