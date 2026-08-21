import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0041_remove_actionrun_addon_remove_addonaction_addon_and_more"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="InstanceSyslogSettings",
            fields=[
                (
                    "id",
                    models.PositiveSmallIntegerField(
                        default=1,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("enabled", models.BooleanField(default=False)),
                ("host", models.CharField(blank=True, default="", max_length=255)),
                ("port", models.PositiveIntegerField(default=514)),
                (
                    "protocol",
                    models.CharField(
                        choices=[("udp", "UDP"), ("tcp", "TCP"), ("tcp_tls", "TCP/TLS")],
                        default="udp",
                        max_length=12,
                    ),
                ),
                (
                    "message_format",
                    models.CharField(
                        choices=[
                            ("rfc5424", "RFC 5424"),
                            ("rfc3164", "RFC 3164"),
                            ("cef", "CEF"),
                        ],
                        default="rfc5424",
                        max_length=12,
                    ),
                ),
                ("ca_certificate", models.TextField(blank=True, default="")),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "updated_by",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name="instance_syslog_settings_updates",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
        ),
    ]
