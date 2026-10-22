from django.db import migrations, models
from django.db.models.functions import Substr


def prepare_severities(apps, schema_editor):
    Severity = apps.get_model("core", "Severity")
    severities = Severity.objects.using(schema_editor.connection.alias)
    severities.update(label=Substr("label", 1, 50))
    for code, color in (("low", "cyan"), ("medium", "amber"), ("high", "orange"), ("critical", "red")):
        severities.filter(code__iexact=code).update(color=color)


class Migration(migrations.Migration):
    dependencies = [("core", "0046_instancesplunkhecsettings_verify_ssl")]

    operations = [
        migrations.AddField(
            model_name="severity",
            name="color",
            field=models.CharField(choices=[("gray", "Gray"), ("cyan", "Cyan"), ("blue", "Blue"), ("violet", "Violet"), ("pink", "Pink"), ("emerald", "Emerald"), ("amber", "Amber"), ("orange", "Orange"), ("red", "Red")], default="gray", max_length=12),
        ),
        migrations.RunPython(prepare_severities, migrations.RunPython.noop),
        migrations.AlterField(model_name="severity", name="label", field=models.CharField(max_length=50)),
        migrations.AlterField(model_name="classification", name="code", field=models.CharField(max_length=120, unique=True)),
        migrations.AlterField(model_name="alert", name="classification", field=models.CharField(default="generic", max_length=120)),
        migrations.AlterField(model_name="case", name="classification", field=models.CharField(default="generic", max_length=120)),
    ]
