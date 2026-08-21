import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("core", "0038_alert_raw"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    sql=(
                        'ALTER TABLE "core_event_members" '
                        'RENAME COLUMN "event_id" TO "case_id";'
                    ),
                    reverse_sql=(
                        'ALTER TABLE "core_event_members" '
                        'RENAME COLUMN "case_id" TO "event_id";'
                    ),
                ),
            ],
            state_operations=[
                migrations.RenameModel(old_name="Event", new_name="Case"),
                migrations.AlterModelTable(name="case", table="core_event"),
                migrations.AlterField(
                    model_name="case",
                    name="owner",
                    field=models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="cases",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                migrations.AlterField(
                    model_name="case",
                    name="members",
                    field=models.ManyToManyField(
                        blank=True,
                        related_name="cases_shared",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
                migrations.AlterField(
                    model_name="case",
                    name="customer",
                    field=models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="cases",
                        to="core.customer",
                    ),
                ),
                migrations.AlterField(
                    model_name="case",
                    name="auto_followup_quickpart",
                    field=models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="cases_auto_followup",
                        to="core.caseexchangereplyquickpart",
                    ),
                ),
            ],
        ),
        migrations.RenameField(
            model_name="timelineitem",
            old_name="event",
            new_name="case",
        ),
        migrations.RenameField(
            model_name="comment",
            old_name="event",
            new_name="case",
        ),
        migrations.RenameField(
            model_name="attachment",
            old_name="event",
            new_name="case",
        ),
        migrations.RenameField(
            model_name="workbookinstance",
            old_name="event",
            new_name="case",
        ),
        migrations.RenameField(
            model_name="caseuserstate",
            old_name="event",
            new_name="case",
        ),
    ]
