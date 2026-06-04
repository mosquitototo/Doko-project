from __future__ import annotations

import json
from urllib.parse import urlparse

from django.conf import settings
from django.db import transaction
from django.db.models import Q

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status

from .rbac import user_has_perm, get_accessible_customer_ids

from .models import (
    Addon,
    AddonAction,
    ActionRun,
    ConnectorResult,
    Event,
    ConnectorInstance,
    ConnectorEndpoint,
    ConnectorAllowlistDomain,
)
from .serializers import (
    ConnectorResultSerializer,
    ConnectorInstanceSerializer,
    ConnectorEndpointSerializer,
    ConnectorAllowlistDomainSerializer,
)
from .addons import run_hub_request, validate_external_base_url
from .crypto_secrets import encrypt_secret, decrypt_secret
from .outbound_proxy import build_outbound_proxy_url



def _connector_hub_url() -> str:
    return (getattr(settings, "CONNECTOR_HUB_URL", "") or "").strip()


def _connector_hmac_secret() -> str:
    return (getattr(settings, "CONNECTOR_HMAC_SECRET", "") or "").strip()


def _require_connector_hub_config():
    hub_url = _connector_hub_url()
    hmac_secret = _connector_hmac_secret()

    if not hub_url:
        raise ValueError("CONNECTOR_HUB_URL is not set")
    if not (hub_url.startswith("http://") or hub_url.startswith("https://")):
        raise ValueError(f"CONNECTOR_HUB_URL must include scheme (http/https), got: {hub_url}")

    if not hmac_secret:
        raise ValueError("CONNECTOR_HMAC_SECRET is not set")

    return hub_url, hmac_secret


def _normalize_base_url(base_url: str) -> str:
    base_url = validate_external_base_url((base_url or "").strip())
    if base_url and not base_url.endswith("/"):
        base_url += "/"
    return base_url


def _headers_dict_from_any(value) -> dict:
    if value is None:
        return {}

    if isinstance(value, dict):
        obj = value
    elif isinstance(value, str):
        txt = value.strip()
        if not txt:
            return {}
        try:
            obj = json.loads(txt)
        except Exception as e:
            raise ValueError(f"headers must be valid JSON: {e}")
    else:
        raise ValueError("headers must be a JSON object or JSON string")

    if not isinstance(obj, dict):
        raise ValueError('headers must be a JSON object (ex: {"accept":"application/json"})')

    out: dict[str, str] = {}
    for k, v in obj.items():
        if k is None:
            continue
        out[str(k)] = "" if v is None else str(v)
    return out


def _parse_headers_payload(request_data) -> dict:
    if not hasattr(request_data, "get"):
        raise ValueError("Invalid request payload (expected JSON object)")

    if "headers" in request_data:
        return _validate_connector_headers(_headers_dict_from_any(request_data.get("headers")))

    if "headers_text" in request_data:
        return _validate_connector_headers(_headers_dict_from_any(request_data.get("headers_text")))

    return {}


def _dump_headers_text(headers: dict) -> str:
    try:
        return json.dumps(headers or {}, ensure_ascii=False)
    except Exception:
        return "{}"


def _headers_from_endpoint(ep: ConnectorEndpoint) -> dict:
    raw = getattr(ep, "headers_text", None)

    if raw is None:
        return {}

    if isinstance(raw, dict):
        return {str(k): "" if v is None else str(v) for k, v in raw.items()}

    if isinstance(raw, str):
        txt = raw.strip()
        if not txt:
            return {}
        try:
            obj = json.loads(txt)
        except Exception as e:
            raise ValueError(f"Invalid endpoint headers_text JSON: {e}")
        if not isinstance(obj, dict):
            raise ValueError("Endpoint headers_text must be a JSON object")
        return _validate_connector_headers({str(k): "" if v is None else str(v) for k, v in obj.items()})

    raise ValueError("Endpoint headers_text has invalid type")


def _safe_json_from_response(resp) -> dict:
    try:
        return resp.json()
    except Exception:
        txt = ""
        try:
            txt = (resp.text or "")[:20000]
        except Exception:
            txt = ""
        return {"raw": txt}


def _get_case_for_connector_run(user, case_id: str):
    qs = Event.objects.filter(is_deleted=False)

    if user.is_staff:
        return qs.filter(id=case_id).first()

    customer_ids = get_accessible_customer_ids(user)
    if not customer_ids:
        return None

    return (
        qs.filter(customer_id__in=customer_ids, id=case_id)
        .first()
    )


def _get_case_for_connector_read(user, case_id: str):
    qs = Event.objects.filter(is_deleted=False)

    if user.is_staff:
        return qs.filter(id=case_id).first()

    customer_ids = get_accessible_customer_ids(user)
    return qs.filter(customer_id__in=customer_ids, id=case_id).first()


def _domain_from_url(url: str) -> str:
    try:
        u = urlparse(url)
        return (u.hostname or "").lower().strip(".")
    except Exception:
        return ""


def _is_valid_allowlist_domain(domain: str) -> bool:
    d = (domain or "").lower().strip().strip(".")

    if not d:
        return False
    if d == "localhost" or d.endswith(".localhost"):
        return False
    if d.endswith(".local"):
        return False
    if "/" in d or "\\" in d or "@" in d or ":" in d or "*" in d:
        return False
    if ".." in d:
        return False
    if len(d) > 253:
        return False

    try:
        import ipaddress
        ipaddress.ip_address(d)
        return False
    except Exception:
        pass

    parts = d.split(".")
    if len(parts) < 2:
        return False

    for part in parts:
        if not part or len(part) > 63:
            return False
        if part.startswith("-") or part.endswith("-"):
            return False
        if not all(ch.isalnum() or ch == "-" for ch in part):
            return False

    return True


def _is_domain_allowed(hostname: str) -> bool:
    if not hostname:
        return False
    hostname = hostname.lower().strip(".")
    allowed = ConnectorAllowlistDomain.objects.filter(is_enabled=True).values_list("domain", flat=True)
    for d in allowed:
        d = (d or "").lower().strip(".")
        if not d:
            continue
        if hostname == d or hostname.endswith("." + d):
            return True
    return False


def _render_template(s: str, *, secret: str, case_id: str, target_key: str, target_value: str) -> str:
    out = (s or "")

    out = out.replace("{{secret}}", secret or "")
    out = out.replace("{{case_id}}", case_id or "")
    out = out.replace("{{key}}", target_key or "")
    out = out.replace("{{value}}", target_value or "")

    out = out.replace("{secret}", secret or "")
    out = out.replace("{case_id}", case_id or "")
    out = out.replace("{key}", target_key or "")
    out = out.replace("{value}", target_value or "")

    return out


def _merge_default_accept(headers: dict) -> dict:
    low = {k.lower(): k for k in headers.keys()}
    if "accept" not in low:
        headers["accept"] = "application/json"
    return headers


def _redact_headers(headers: dict) -> dict:
    out = dict(headers or {})
    for k in list(out.keys()):
        lk = str(k).lower()
        if lk in (
            "authorization",
            "x-apikey",
            "x-api-key",
            "x_api_key",
            "apikey",
            "api-key",
            "x-auth-token",
            "x-token",
            "cookie",
            "set-cookie",
        ):
            out[k] = "***"
    return out


_ALLOWED_CONNECTOR_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}

def _normalize_connector_method(value) -> str:
    method = str(value or "GET").upper().strip()
    if method not in _ALLOWED_CONNECTOR_METHODS:
        raise ValueError("Unsupported HTTP method")
    return method


def _normalize_connector_timeout_ms(value) -> int:
    try:
        timeout_ms = int(value or 8000)
    except Exception:
        raise ValueError("Invalid timeout_ms")

    if timeout_ms < 1000 or timeout_ms > 60000:
        raise ValueError("timeout_ms must be between 1000 and 60000")

    return timeout_ms



# ----------------------------
# Addons settings endpoints
# ----------------------------

@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_addons(request):
    if not (request.user.is_staff or user_has_perm(request.user, "settings.connectors.view")):
        return Response({"detail": "Forbidden"}, status=403)
    
    addons = Addon.objects.all().order_by("name")
    return Response([
        {
            "id": str(a.id),
            "name": a.name,
            "version": a.version,
            "description": a.description,
            "is_enabled": a.is_enabled,
            "actions": [
                {
                    "action_id": ac.action_id,
                    "label": ac.label,
                    "scope": ac.scope,
                    "method": ac.method,
                    "path": ac.path,
                    "is_enabled": ac.is_enabled
                }
                for ac in a.actions.all().order_by("label")
            ],
        }
        for a in addons
    ])


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def install_addon(request):
    if not (request.user.is_staff or user_has_perm(request.user, "settings.connectors.manage")):
        return Response({"detail": "Forbidden"}, status=403)

    manifest = request.data
    addon_id = manifest.get("id")
    if not addon_id:
        return Response({"detail": "Missing id"}, status=400)

    with transaction.atomic():
        a, _ = Addon.objects.update_or_create(
            id=addon_id,
            defaults={
                "name": manifest.get("name", addon_id),
                "version": manifest.get("version", "1.0.0"),
                "description": manifest.get("description", ""),
                "is_enabled": True,
            },
        )

        AddonAction.objects.filter(addon=a).delete()
        for act in manifest.get("actions", []):
            AddonAction.objects.create(
                addon=a,
                action_id=act["id"],
                label=act.get("label", act["id"]),
                scope=act.get("scope", "case"),
                method=act.get("method", "POST"),
                path=act.get("path", "/"),
                timeout_ms=int(act.get("timeout_ms", 8000)),
                is_enabled=True,
            )

    return Response({"ok": True})


@api_view(["DELETE"])
@permission_classes([IsAuthenticated])
def uninstall_addon(request, addon_id: str):
    if not (request.user.is_staff or user_has_perm(request.user, "settings.connectors.delete")):
        return Response({"detail": "Forbidden"}, status=403)
    
    Addon.objects.filter(id=addon_id).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(["PATCH"])
@permission_classes([IsAuthenticated])
def patch_addon_config(request, addon_id: str):
    if not (request.user.is_staff or user_has_perm(request.user, "settings.connectors.manage")):
        return Response({"detail": "Forbidden"}, status=403)

    a = Addon.objects.filter(id=addon_id).first()
    if not a:
        return Response({"detail": "Addon not found"}, status=404)

    is_enabled = request.data.get("is_enabled", None)
    if is_enabled is not None:
        a.is_enabled = bool(is_enabled)
        a.save(update_fields=["is_enabled"])

    return Response(
        {
            "id": str(a.id),
            "name": a.name,
            "version": a.version,
            "description": a.description,
            "is_enabled": a.is_enabled,
        }
    )


def _connector_forbidden(request, perm_code: str):
    if request.user.is_staff:
        return None
    if user_has_perm(request.user, perm_code):
        return None
    return Response({"detail": "Forbidden"}, status=403)


_BLOCKED_CONNECTOR_HEADERS = {
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "proxy-authorization",
    "proxy-authenticate",
    "upgrade",
}


def _validate_connector_headers(headers: dict) -> dict:
    out = {}

    for k, v in (headers or {}).items():
        key = str(k or "").strip()
        if not key:
            continue

        low = key.lower()
        if low in _BLOCKED_CONNECTOR_HEADERS:
            raise ValueError(f"Header not allowed: {key}")

        if "\r" in key or "\n" in key:
            raise ValueError("Invalid header name")

        value = "" if v is None else str(v)
        if "\r" in value or "\n" in value:
            raise ValueError(f"Invalid header value for {key}")

        out[key] = value

    return out

# ----------------------------
# Connector settings (Instances + Endpoints + Allowlist)
# ----------------------------

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def connector_instances(request):
    forbidden = _connector_forbidden(
        request,
        "settings.connectors.view" if request.method == "GET" else "settings.connectors.manage",
    )
    if forbidden:
        return forbidden

    if request.method == "GET":
        qs = ConnectorInstance.objects.all().order_by("name")
        return Response(ConnectorInstanceSerializer(qs, many=True).data)

    name = str(request.data.get("name") or "").strip()
    if not name:
        return Response({"detail": "Missing name"}, status=400)

    instance = ConnectorInstance.objects.create(
        name=name,
        description=str(request.data.get("description") or ""),
        connector_type=str(request.data.get("connector_type") or "http"),
        is_enabled=bool(request.data.get("is_enabled", True)),
        config=request.data.get("config") or {},
        created_by=request.user,
    )

    secret = str(request.data.get("secret") or "").strip()
    if secret:
        instance.encrypted_secret = encrypt_secret(secret)
        instance.save(update_fields=["encrypted_secret"])

    return Response(ConnectorInstanceSerializer(instance).data, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def connector_instance_detail(request, instance_id: str):
    forbidden = _connector_forbidden(
        request,
        "settings.connectors.delete" if request.method == "DELETE" else "settings.connectors.manage",
    )
    if forbidden:
        return forbidden

    inst = ConnectorInstance.objects.filter(id=instance_id).first()
    if not inst:
        return Response({"detail": "connector_instance_detail Not found"}, status=404)

    if request.method == "DELETE":
        inst.delete()
        return Response(status=204)

    if "name" in request.data:
        inst.name = str(request.data.get("name") or "").strip()
    if "description" in request.data:
        inst.description = str(request.data.get("description") or "")
    if "connector_type" in request.data:
        inst.connector_type = str(request.data.get("connector_type") or "http")
    if "config" in request.data:
        inst.config = request.data.get("config") or {}
    if "is_enabled" in request.data:
        inst.is_enabled = bool(request.data.get("is_enabled"))

    if "secret" in request.data:
        s = str(request.data.get("secret") or "").strip()
        if s:
            inst.encrypted_secret = encrypt_secret(s)

    inst.save()
    return Response(ConnectorInstanceSerializer(inst).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def connector_instance_add_endpoint(request, instance_id: str):
    forbidden = _connector_forbidden(request, "settings.connectors.manage")
    if forbidden:
        return forbidden

    inst = ConnectorInstance.objects.filter(id=instance_id).first()
    if not inst:
        return Response({"detail": "Instance not found"}, status=404)

    name = str(request.data.get("name") or "").strip()
    target_type = str(request.data.get("target_type") or "case").strip()
    base_url = str(request.data.get("base_url") or "").strip()
    path_template = str(request.data.get("path_template") or "").strip()

    if target_type not in {"case", "ioc", "asset"}:
        target_type = "case"

    if not name or not base_url or not path_template:
        return Response({"detail": "Missing fields (name, base_url, path_template)"}, status=400)

    base_url = _normalize_base_url(base_url)

    host = _domain_from_url(base_url)
    if not _is_domain_allowed(host):
        return Response({"detail": f"Domain not allowed: {host}"}, status=400)

    try:
        headers = _parse_headers_payload(request.data)
    except ValueError as e:
        return Response({"detail": str(e)}, status=400)

    try:
        method = _normalize_connector_method(request.data.get("method") or "GET")
        timeout_ms = _normalize_connector_timeout_ms(request.data.get("timeout_ms") or 8000)
    except ValueError as e:
        return Response({"detail": str(e)}, status=400)

    ep = ConnectorEndpoint.objects.create(
        instance=inst,
        name=name,
        label=str(request.data.get("label") or name),
        target_type=target_type,
        method=method,
        base_url=base_url,
        path_template=path_template,
        headers_text=_dump_headers_text(headers),
        timeout_ms=timeout_ms,
        is_enabled=bool(request.data.get("is_enabled", True)),
    )

    return Response(ConnectorEndpointSerializer(ep).data, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def connector_endpoint_detail(request, endpoint_id: str):
    forbidden = _connector_forbidden(
        request,
        "settings.connectors.delete" if request.method == "DELETE" else "settings.connectors.manage",
    )
    if forbidden:
        return forbidden

    ep = ConnectorEndpoint.objects.select_related("instance").filter(id=endpoint_id).first()
    if not ep:
        return Response({"detail": "connector_endpoint_detail Not found"}, status=404)

    if request.method == "DELETE":
        ep.delete()
        return Response(status=204)

    if "name" in request.data:
        ep.name = str(request.data.get("name") or "").strip()
    if "label" in request.data:
        ep.label = str(request.data.get("label") or "")
    if "target_type" in request.data:
        ep.target_type = str(request.data.get("target_type") or "").strip()
    if "method" in request.data:
        try:
            ep.method = _normalize_connector_method(request.data.get("method"))
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)

    if "headers" in request.data or "headers_text" in request.data:
        try:
            headers = _parse_headers_payload(request.data)
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)
        ep.headers_text = _dump_headers_text(headers)

    if "timeout_ms" in request.data:
        try:
            ep.timeout_ms = _normalize_connector_timeout_ms(request.data.get("timeout_ms"))
        except ValueError as e:
            return Response({"detail": str(e)}, status=400)
        
    if "is_enabled" in request.data:
        ep.is_enabled = bool(request.data.get("is_enabled"))

    if "base_url" in request.data:
        base_url = _normalize_base_url(str(request.data.get("base_url") or "").strip())
        host = _domain_from_url(base_url)
        if not _is_domain_allowed(host):
            return Response({"detail": f"Domain not allowed: {host}"}, status=400)
        ep.base_url = base_url

    if "path_template" in request.data:
        ep.path_template = str(request.data.get("path_template") or "").strip()

    ep.save()
    return Response(ConnectorEndpointSerializer(ep).data)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def connector_allowlist(request):
    forbidden = _connector_forbidden(
        request,
        "settings.connectors.view" if request.method == "GET" else "settings.connectors.manage",
    )
    if forbidden:
        return forbidden

    if request.method == "GET":
        qs = ConnectorAllowlistDomain.objects.all().order_by("domain")
        return Response(ConnectorAllowlistDomainSerializer(qs, many=True).data)

    domain = str(request.data.get("domain") or "").lower().strip().strip(".")
    if not domain:
        return Response({"detail": "Missing domain"}, status=400)

    if not _is_valid_allowlist_domain(domain):
        return Response({"detail": "Invalid allowlist domain"}, status=400)

    obj, _ = ConnectorAllowlistDomain.objects.update_or_create(
        domain=domain,
        defaults={"is_enabled": bool(request.data.get("is_enabled", True))},
    )
    return Response(ConnectorAllowlistDomainSerializer(obj).data, status=201)


@api_view(["DELETE", "PATCH"])
@permission_classes([IsAuthenticated])
def connector_allowlist_detail(request, domain_id: str):
    forbidden = _connector_forbidden(
        request,
        "settings.connectors.delete" if request.method == "DELETE" else "settings.connectors.manage",
    )
    if forbidden:
        return forbidden

    obj = ConnectorAllowlistDomain.objects.filter(id=domain_id).first()
    if not obj:
        return Response({"detail": "connector_allowlist_detail Not found"}, status=404)

    if request.method == "DELETE":
        obj.delete()
        return Response(status=204)

    if "is_enabled" in request.data:
        obj.is_enabled = bool(request.data.get("is_enabled"))
        obj.save(update_fields=["is_enabled"])

    return Response(ConnectorAllowlistDomainSerializer(obj).data)


# ----------------------------
# Connector-Hub run + results
# ----------------------------

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def run_connector_action(request):
    user = request.user

    if not (user.is_staff or user_has_perm(user, "chat.soar.use")):
        return Response({"detail": "Forbidden"}, status=403)
    
    case_id = request.data.get("case_id")
    target_type = request.data.get("target_type")
    targets = request.data.get("targets") or []
    context = request.data.get("context") or {}

    connector_instance_id = request.data.get("connector_instance_id")
    endpoint_id = request.data.get("endpoint_id")

    if not case_id or not target_type:
        return Response({"detail": "Missing required fields"}, status=400)
    if not connector_instance_id or not endpoint_id:
        return Response({"detail": "Missing connector_instance_id or endpoint_id"}, status=400)

    case = _get_case_for_connector_run(user, str(case_id))
    if not case:
        return Response({"detail": "Case not found"}, status=404)

    inst = ConnectorInstance.objects.filter(id=connector_instance_id, is_enabled=True).first()
    if not inst:
        return Response({"detail": "Connector instance not found"}, status=404)

    ep = ConnectorEndpoint.objects.select_related("instance").filter(
        id=endpoint_id,
        instance=inst,
        is_enabled=True,
    ).first()
    if not ep:
        return Response({"detail": "Connector endpoint not found"}, status=404)

    if ep.target_type not in {target_type, "case"}:
        return Response({"detail": f"Endpoint target_type mismatch (expected {target_type})"}, status=400)

    if target_type in ("ioc", "asset"):
        if not isinstance(targets, list) or not targets:
            return Response({"detail": "targets must be a non-empty list"}, status=400)
    elif target_type == "case":
        targets = [{"key": "case", "value": str(case.id)}]
    else:
        return Response({"detail": "Invalid target_type"}, status=400)

    try:
        hub_url, hmac_secret = _require_connector_hub_config()
    except ValueError as e:
        return Response({"detail": str(e)}, status=500)

    base_url = _normalize_base_url(str(ep.base_url or "").strip())
    host = _domain_from_url(base_url)
    if not _is_domain_allowed(host):
        return Response({"detail": f"Domain not allowed: {host}"}, status=400)

    instance_secret = ""
    if inst.encrypted_secret:
        instance_secret = decrypt_secret(inst.encrypted_secret) or ""

    try:
        base_headers = _headers_from_endpoint(ep)
    except ValueError as e:
        return Response({"detail": str(e)}, status=400)

    base_headers = _merge_default_accept(base_headers)

    run = ActionRun.objects.create(
        connector_instance=inst,
        connector_endpoint=ep,
        scope=target_type,
        target_id=str(case.id),
        requested_by=user,
        status="pending",
    )

    payload = {
        "run_id": str(run.id),
        "actor": {"id": user.id, "username": user.username},
        "case": {"id": str(case.id), "title": case.title},
        "target_type": target_type,
        "targets": targets,
        "context": context,
        "connector": {
            "instance_id": str(inst.id),
            "endpoint_id": str(ep.id),
            "name": ep.name,
            "method": (ep.method or "GET").upper(),
            "base_url": base_url,
            "path_template": ep.path_template or "",
            "timeout_ms": int(ep.timeout_ms or 8000),
        },
    }

    try:
        resolved_calls = []
        redacted_calls = []

        for t in targets:
            tkey = str(t.get("key") or "")
            tval = str(t.get("value") or "")

            resolved_headers = {
                hk: _render_template(
                    hv,
                    secret=instance_secret,
                    case_id=str(case.id),
                    target_key=tkey,
                    target_value=tval,
                )
                for hk, hv in (base_headers or {}).items()
            }

            resolved_path = _render_template(
                ep.path_template or "",
                secret=instance_secret,
                case_id=str(case.id),
                target_key=tkey,
                target_value=tval,
            )

            url = base_url.rstrip("/") + ("/" + resolved_path.lstrip("/"))

            final_host = _domain_from_url(url)
            if not _is_domain_allowed(final_host):
                return Response({"detail": f"Domain not allowed: {final_host}"}, status=400)

            resolved_calls.append({
                "key": tkey,
                "value": tval,
                "method": (ep.method or "GET").upper(),
                "url": url,
                "headers": resolved_headers,
            })

            redacted_calls.append({
                "key": tkey,
                "value": tval,
                "method": (ep.method or "GET").upper(),
                "url": url,
                "headers": _redact_headers(resolved_headers),
            })

        payload["resolved_calls"] = redacted_calls

        hub_payload = {
            "run_id": str(run.id),
            "calls": resolved_calls,
            "timeout_ms": int(ep.timeout_ms or 8000),
            "proxy_url": build_outbound_proxy_url(),
        }

        resp = run_hub_request(
            path="run/http",
            payload=hub_payload,
            timeout_ms=int(ep.timeout_ms or 8000),
            hub_url=hub_url,
            secret=hmac_secret,
        )

        http_status = getattr(resp, "status_code", None)
        body = _safe_json_from_response(resp)

        run.http_status = int(http_status) if http_status is not None else None
        run.status = "success" if (http_status is not None and 200 <= int(http_status) < 300) else "error"
        try:
            run.result_message = json.dumps(body)[:2000]
        except Exception:
            run.result_message = str(body)[:2000]
        run.save(update_fields=["http_status", "status", "result_message"])

        created_ids: list[str] = []
        results_list = body.get("results") if isinstance(body, dict) else None
        results_list = results_list if isinstance(results_list, list) else None

        with transaction.atomic():
            for t in targets:
                tkey = str(t.get("key") or "")
                tval = str(t.get("value") or "")

                per_target = None
                if results_list:
                    for it in results_list:
                        if str(it.get("key") or "") == tkey and str(it.get("value") or "") == tval:
                            per_target = it
                            break

                result_payload = per_target if per_target is not None else body

                per_http = None
                if isinstance(result_payload, dict):
                    hs = result_payload.get("http_status")
                    if isinstance(hs, int):
                        per_http = hs

                if per_http is not None:
                    ok = 200 <= int(per_http) < 300
                else:
                    ok = (run.status == "success")

                err_msg = ""
                if not ok:
                    data_part = None
                    if isinstance(result_payload, dict):
                        data_part = result_payload.get("data")

                    if isinstance(data_part, (dict, list)):
                        try:
                            err_msg = json.dumps(data_part)[:2000]
                        except Exception:
                            err_msg = str(data_part)[:2000]
                    else:
                        err_msg = f"HTTP {per_http}" if per_http is not None else (
                            json.dumps(body)[:2000] if isinstance(body, (dict, list)) else str(body)[:2000]
                        )

                cr = ConnectorResult.objects.create(
                    case=case,
                    instance=inst,
                    endpoint=ep,
                    action_id=str(ep.name or ""),
                    target_type=target_type,
                    target_key=tkey,
                    target_value=tval,
                    request_payload=payload,
                    response_payload=result_payload if isinstance(result_payload, (dict, list)) else {"raw": str(result_payload)},
                    status=ConnectorResult.Status.SUCCESS if ok else ConnectorResult.Status.ERROR,
                    error=err_msg,
                    created_by=user,
                )
                created_ids.append(str(cr.id))

        return Response(
            {
                "run_id": str(run.id),
                "status": run.status,
                "http_status": run.http_status,
                "connector_result_ids": created_ids,
            }
        )

    except Exception as e:
        run.status = "error"
        run.result_message = str(e)[:2000]
        run.save(update_fields=["status", "result_message"])
        return Response(
            {"run_id": str(run.id), "status": "error", "message": run.result_message},
            status=400,
        )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def list_connector_results(request):
    user = request.user

    if not (
        user.is_staff
        or user_has_perm(user, "chat.soar.use")
        or user_has_perm(user, "case.view")
    ):
        return Response({"detail": "Forbidden"}, status=403)
    
    case_id = request.query_params.get("case_id")
    if not case_id:
        return Response({"detail": "Missing case_id"}, status=400)

    case = _get_case_for_connector_read(user, str(case_id))
    if not case:
        return Response({"detail": "Case not found"}, status=404)

    qs = ConnectorResult.objects.filter(case=case).order_by("-created_at")

    target_type = request.query_params.get("target_type")
    target_key = request.query_params.get("target_key")
    target_value = request.query_params.get("target_value")

    if target_type:
        qs = qs.filter(target_type=target_type)
    if target_key:
        qs = qs.filter(target_key=target_key)
    if target_value:
        qs = qs.filter(target_value=target_value)

    qs = qs[:50]
    return Response(ConnectorResultSerializer(qs, many=True).data)
