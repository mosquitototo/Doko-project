import os
from celery.schedules import crontab

CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://redis:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", CELERY_BROKER_URL)
CELERY_TIMEZONE = "Europe/Paris"

CELERY_BEAT_SCHEDULE = {
    "auto-archive-cases": {
        "task": "core.celerytasks.auto_archive_cases",
        "schedule": crontab(minute=0, hour=0),
    },
    "hard-delete-cases": {
        "task": "core.celerytasks.hard_delete_cases",
        "schedule": crontab(minute=10, hour=0),
    },
    "audit-log-retention": {
        "task": "core.celerytasks.purge_audit_logs",
        "schedule": crontab(minute=20, hour=0),
    },
    "case-auto-followups": {
        "task": "core.celerytasks.run_case_auto_followups",
        "schedule": 60.0,
    },
    "run-scheduled-automation-rules": {
        "task": "core.celerytasks.run_scheduled_automation_rules_task",
        "schedule": 5.0,
    },
}

########
# to test :
# docker compose exec web python manage.py shell -c "from core.celerytasks import auto_archive_cases, hard_delete_cases; print(auto_archive_cases()); print(hard_delete_cases())"
########