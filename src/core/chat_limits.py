import math
import uuid
from contextlib import contextmanager
from functools import lru_cache

import psycopg
from redis import Redis, RedisError
from django.conf import settings
from django.db import connections
from rest_framework.exceptions import APIException, Throttled


RATE_KEY_PREFIX = "doko:interactive:rate:"
RATE_SCRIPT = """
local clock = redis.call('TIME')
local now = tonumber(clock[1]) + tonumber(clock[2]) / 1000000
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - 60)
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[1]) then
    local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    return tostring(60 - now + tonumber(first[2]))
end
redis.call('ZADD', KEYS[1], now, ARGV[2])
redis.call('EXPIRE', KEYS[1], 61)
return '0'
"""


@lru_cache(maxsize=4)
def _rate_client(url):
    return Redis.from_url(url, socket_connect_timeout=1, socket_timeout=1)


def reserve_prompt(user_id):
    try:
        client = _rate_client(settings.CELERY_BROKER_URL)
        wait = float(client.eval(RATE_SCRIPT, 1, f"{RATE_KEY_PREFIX}{user_id}", settings.DOKO_CHAT_PROMPTS_PER_MINUTE, uuid.uuid4().hex))
    except RedisError as exc:
        error = APIException("The interactive prompt limiter is temporarily unavailable.")
        error.status_code = 503
        raise error from exc
    if wait > 0:
        raise Throttled(wait=max(1, math.ceil(wait)), detail="Interactive prompt rate limit reached.")


@contextmanager
def interactive_generation_slot(user_id):
    params = connections["default"].get_connection_params()
    with psycopg.connect(**params, autocommit=True) as connection:
        acquired = False
        for slot in range(settings.DOKO_CHAT_MAX_CONCURRENT):
            if connection.execute("SELECT pg_try_advisory_lock(%s, %s)", (1870030000 + slot, int(user_id))).fetchone()[0]:
                acquired = True
                break
        yield acquired
