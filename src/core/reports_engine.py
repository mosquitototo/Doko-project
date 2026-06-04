import json
from datetime import datetime
from collections.abc import Iterable
from jinja2.sandbox import SandboxedEnvironment
from jinja2 import StrictUndefined
from django.utils.html import escape
from django.utils.timezone import localtime
from django.db.models import Model, QuerySet
from django.db.models.manager import BaseManager


def _format_date(value):
    if not value:
        return ""
    try:
        if isinstance(value, str):
            return value
        if hasattr(value, "tzinfo"):
            value = localtime(value)
        return value.strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(value)


def _nl2br(value):
    if value is None:
        return ""
    s = escape(str(value))
    return s.replace("\n", "<br>\n")


def _tojson(value):
    try:
      return json.dumps(_normalize_value(value), ensure_ascii=False, indent=2)
    except Exception:
      return json.dumps(str(value), ensure_ascii=False)


class TemplateListProxy(list):
    def all(self):
        return self

    def count(self):
        return len(self)

    def first(self):
        return self[0] if self else None

    def last(self):
        return self[-1] if self else None


class TemplateObjectProxy:
    def __init__(self, obj):
        self._obj = obj

    def __getattr__(self, name):
        if not name or name.startswith("_"):
            raise AttributeError(name)

        value = getattr(self._obj, name)
        return _normalize_value(value)

    def __str__(self):
        return str(self._obj)

    def __repr__(self):
        return repr(self._obj)


def _normalize_iterable(value):
    return TemplateListProxy([_normalize_value(v) for v in value])


def _normalize_value(value):
    if value is None:
        return None

    if isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, dict):
        return {k: _normalize_value(v) for k, v in value.items()}

    if isinstance(value, BaseManager):
        return _normalize_iterable(value.all())

    if isinstance(value, QuerySet):
        return _normalize_iterable(value)

    if isinstance(value, (list, tuple, set)):
        return _normalize_iterable(value)

    if isinstance(value, Model):
        return TemplateObjectProxy(value)

    return value


def build_sandbox_env():
    env = SandboxedEnvironment(
        autoescape=True,
        undefined=StrictUndefined,
    )

    env.loader = None
    env.globals.clear()

    env.filters["format_date"] = _format_date
    env.filters["nl2br"] = _nl2br
    env.filters["tojson"] = _tojson

    return env


def render_report_html(template_html: str, context: dict) -> str:
    env = build_sandbox_env()
    tpl = env.from_string(template_html)
    normalized_context = {k: _normalize_value(v) for k, v in context.items()}
    return tpl.render(**normalized_context)


def default_context(case, **extras):
    return {
        "case": _normalize_value(case),
        "generated_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        **{k: _normalize_value(v) for k, v in extras.items()},
    }