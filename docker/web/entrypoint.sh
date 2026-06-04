#!/bin/sh
set -eu

echo "[entrypoint] waiting for database…"
python - <<'PY'
import os, time
os.environ.setdefault("DJANGO_SETTINGS_MODULE", os.getenv("DJANGO_SETTINGS_MODULE", "config.settings"))
import django
django.setup()
from django.db import connections
from django.db.utils import OperationalError

deadline = time.time() + 60
while True:
    try:
        conn = connections["default"]
        conn.ensure_connection()
        conn.close()
        print("[entrypoint] database is up")
        break
    except OperationalError:
        if time.time() > deadline:
            raise SystemExit("[entrypoint] database not ready after 60s")
        time.sleep(1)
PY



python manage.py migrate --noinput
python manage.py collectstatic --noinput



python - <<'PY'
import os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", os.getenv("DJANGO_SETTINGS_MODULE", "config.settings"))

import django
django.setup()

from django.contrib.auth import get_user_model
from core.models import Permission, Severity, Classification, Customer

User = get_user_model()

is_first_install = (
    User.objects.count() == 0
    and Permission.objects.count() == 0
    and Severity.objects.count() == 0
    and Classification.objects.count() == 0
    and Customer.objects.count() == 0
)

with open("/tmp/doko_first_install", "w", encoding="utf-8") as f:
    f.write("1" if is_first_install else "0")
PY

if [ "$(cat /tmp/doko_first_install)" = "1" ]; then
  echo "[entrypoint] first install detected, running initial seeds"
  python manage.py seed_permissions || exit 1
  python manage.py seed_data_models || exit 1
  python manage.py seed_superuser || exit 1
else
  echo "[entrypoint] existing installation detected, skipping initial seeds"
fi

exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers "${GUNICORN_WORKERS:-3}" --timeout "${GUNICORN_TIMEOUT:-300}" --access-logfile - --error-logfile -