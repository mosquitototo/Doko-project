import core.models
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0040_connectorendpoint_body_template'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='actionrun',
            name='addon',
        ),
        migrations.AlterUniqueTogether(
            name='addonaction',
            unique_together=None,
        ),
        migrations.RemoveField(
            model_name='addonaction',
            name='addon',
        ),
        migrations.RemoveField(
            model_name='actionrun',
            name='action',
        ),
        migrations.AlterField(
            model_name='actionrun',
            name='connector_endpoint',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='action_runs', to='core.connectorendpoint'),
        ),
        migrations.AlterField(
            model_name='actionrun',
            name='connector_instance',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='action_runs', to='core.connectorinstance'),
        ),
        migrations.AlterField(
            model_name='attachment',
            name='file',
            field=models.FileField(upload_to=core.models.case_attachment_upload_to),
        ),
        migrations.DeleteModel(
            name='Addon',
        ),
        migrations.DeleteModel(
            name='AddonAction',
        ),
    ]
