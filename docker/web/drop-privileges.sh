#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  chown -R doko:doko /app/media /app/staticfiles /app/celerybeat
  exec gosu doko "$@"
fi

exec "$@"
