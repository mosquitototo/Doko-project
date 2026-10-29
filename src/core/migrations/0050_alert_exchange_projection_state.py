import json

from django.db import migrations, models


def preserve_imported_messages(apps, schema_editor):
    Alert = apps.get_model("core", "Alert")
    Exchange = apps.get_model("core", "CaseExchange")
    db = schema_editor.connection.alias
    alerts = Alert.objects.using(db).filter(exchanges__raw__has_key="alert_exchange").distinct()
    for alert in alerts.iterator():
        raw = alert.raw if isinstance(alert.raw, dict) else {}
        items = raw.get("case_exchanges")
        if items is None and isinstance(raw.get("projections"), dict):
            items = raw["projections"].get("case_exchanges")
        if not isinstance(items, list):
            continue
        source_message_ids = {
            str(item.get("message_id") or "").strip()[:500]
            for item in items if isinstance(item, dict) and item.get("message_id")
        }
        messages = []
        for message in Exchange.objects.using(db).filter(alert_id=alert.pk, raw__has_key="alert_exchange"):
            origin = message.raw.get("alert_exchange") if isinstance(message.raw, dict) else None
            if isinstance(origin, dict) and origin.get("source_alert_id") == str(alert.pk):
                messages.append((message, origin))
        state = {}
        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            external_id = str(item.get("external_id") or item.get("id") or item.get("key") or "").strip()[:500]
            projection_key = str(item.get("external_id") or item.get("id") or item.get("key") or idx).strip()[:120]
            message_id = str(item.get("message_id") or "").strip()[:500]
            match = next((message for message, origin in messages if message_id and message.message_id == message_id), None)
            if match is None:
                match = next((
                    message for message, origin in messages
                    if origin.get("projection_key") == projection_key
                    and (external_id or not message_id or message.message_id not in source_message_ids)
                ), None)
            if match is not None:
                identity = json.dumps(["external_id", external_id] if external_id else ["message_id", message_id] if message_id else ["projection_key", projection_key])
                state[identity] = {"exchange_id": str(match.pk), "case_notified": True}
        if state:
            Alert.objects.using(db).filter(pk=alert.pk).update(exchange_projection_state=state)


class Migration(migrations.Migration):
    dependencies = [("core", "0049_alert_exchanges")]

    operations = [
        migrations.AddField(
            model_name="alert",
            name="exchange_projection_state",
            field=models.JSONField(blank=True, default=dict, editable=False),
        ),
        migrations.RunPython(preserve_imported_messages, migrations.RunPython.noop),
    ]
