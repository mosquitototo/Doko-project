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
python manage.py seed_permissions
python manage.py seed_data_models
python manage.py seed_superuser

exec gunicorn config.wsgi:application --bind 0.0.0.0:8000 --workers "${GUNICORN_WORKERS:-3}" --timeout "${GUNICORN_TIMEOUT:-300}" --access-logfile - --error-logfile -
