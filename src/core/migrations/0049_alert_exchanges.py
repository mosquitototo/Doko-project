import uuid

from django.db import migrations, models
import django.db.models.deletion


def preserve_origins(apps, schema_editor):
    Exchange = apps.get_model("core", "CaseExchange")
    Alert = apps.get_model("core", "Alert")
    db = schema_editor.connection.alias
    for message in Exchange.objects.using(db).filter(raw__has_key="alert_exchange").iterator():
        origin = message.raw.get("alert_exchange") if isinstance(message.raw, dict) else None
        if not isinstance(origin, dict):
            continue
        try:
            alert_id = uuid.UUID(str(origin.get("source_alert_id", "")))
        except (ValueError, TypeError):
            continue
        if Alert.objects.using(db).filter(pk=alert_id, case_id=message.case_id).exists():
            if message.message_id and Exchange.objects.using(db).filter(alert_id=alert_id, message_id=message.message_id).exists():
                continue
            Exchange.objects.using(db).filter(pk=message.pk).update(alert_id=alert_id, origin_alert_uuid=alert_id)

    changed = True
    while changed:
        changed = False
        for message in Exchange.objects.using(db).filter(alert__isnull=True, case__isnull=False).iterator():
            raw = message.raw if isinstance(message.raw, dict) else {}
            parent_id = raw.get("source_exchange_id") if raw.get("kind") in {"auto_followup", "automation_rule"} else None
            candidates = Exchange.objects.using(db).filter(case_id=message.case_id).exclude(pk=message.pk)
            if parent_id:
                try:
                    candidates = candidates.filter(pk=uuid.UUID(str(parent_id)))
                except (ValueError, TypeError):
                    continue
            else:
                parent = str(raw.get("in_reply_to") or "").strip()
                headers = raw.get("headers")
                if not parent and isinstance(headers, dict):
                    parent = next((str(value or "").strip() for key, value in headers.items() if str(key).lower() == "in-reply-to"), "")
                if not parent and isinstance(message.references, list) and message.references:
                    parent = str(message.references[-1] or "").strip()
                if not parent:
                    continue
                candidates = candidates.filter(message_id__in=[parent, parent.strip("<>"), f"<{parent.strip('<>')}>"])
            matches = list(candidates[:2])
            if len(matches) != 1 or not matches[0].alert_id:
                continue
            parent = matches[0]
            if message.message_id and Exchange.objects.using(db).filter(alert_id=parent.alert_id, message_id=message.message_id).exists():
                continue
            Exchange.objects.using(db).filter(pk=message.pk).update(alert_id=parent.alert_id, origin_alert_uuid=parent.alert_id, reply_to_id=parent.pk)
            changed = True


def check_rollback(apps, schema_editor):
    Exchange = apps.get_model("core", "CaseExchange")
    qs = Exchange.objects.using(schema_editor.connection.alias)
    if qs.filter(case__isnull=True).exists():
        raise RuntimeError("Rollback requires preserving standalone alert exchanges before removing alert ownership.")
    duplicate = qs.exclude(message_id="").values("case_id", "message_id").annotate(n=models.Count("id")).filter(n__gt=1).exists()
    if duplicate:
        raise RuntimeError("Rollback requires preserving exchanges with duplicate message IDs before restoring the case constraint.")


class Migration(migrations.Migration):
    dependencies = [("core", "0048_case_alert_catalog_severity")]

    operations = [
        migrations.AlterField(model_name="caseexchange", name="case", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="exchanges", to="core.case")),
        migrations.AddField(model_name="caseexchange", name="alert", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="exchanges", to="core.alert")),
        migrations.AddField(model_name="caseexchange", name="origin_alert_uuid", field=models.UUIDField(blank=True, null=True, editable=False)),
        migrations.AddField(model_name="caseexchange", name="reply_to", field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="replies", to="core.caseexchange")),
        migrations.RemoveConstraint(model_name="caseexchange", name="uniq_case_message_id"),
        migrations.AddConstraint(model_name="caseexchange", constraint=models.UniqueConstraint(fields=("case", "message_id"), condition=~models.Q(message_id="") & models.Q(origin_alert_uuid__isnull=True), name="uniq_case_message_id")),
        migrations.AddConstraint(model_name="caseexchange", constraint=models.UniqueConstraint(fields=("origin_alert_uuid", "message_id"), condition=~models.Q(message_id=""), name="uniq_alert_message_id")),
        migrations.AddConstraint(model_name="caseexchange", constraint=models.CheckConstraint(condition=models.Q(case__isnull=False) | models.Q(alert__isnull=False), name="exchange_has_owner")),
        migrations.RunPython(preserve_origins, migrations.RunPython.noop),
        migrations.RunPython(migrations.RunPython.noop, check_rollback),
    ]
