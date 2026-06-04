from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Any, Literal, Optional
from urllib.parse import urlparse
import ipaddress
import socket
import httpx
import hashlib
import hmac
import json
import os
import time


app = FastAPI(title="Doko Connector Hub")

class Target(BaseModel):
    key: str
    value: str


class RunRequest(BaseModel):
    run_id: str
    actor: dict[str, Any]
    case: dict[str, Any]
    target_type: Literal["case", "ioc", "asset"]
    targets: list[Target]
    context: dict[str, Any] = {}


@app.get("/health")
def health():
    return {"ok": True}


class HttpCall(BaseModel):
    key: str = ""
    value: str = ""
    method: str = "GET"
    url: str
    headers: dict[str, str] = Field(default_factory=dict)


class HttpRunRequest(BaseModel):
    run_id: str
    calls: list[HttpCall]
    timeout_ms: int = 8000
    proxy_url: str = ""


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except Exception:
        return False


def _host_is_private_or_local(host: str) -> bool:
    h = (host or "").strip().lower().strip(".")
    if not h:
        return True
    if h in ("localhost",):
        return True
    if h.endswith(".local"):
        return True
    if _is_ip_literal(h):
        try:
            ip = ipaddress.ip_address(h)
            return ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved
        except Exception:
            return True
    try:
        infos = socket.getaddrinfo(h, None)
    except Exception:
        return True

    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved:
                return True
        except Exception:
            return True
    return False


def _validate_url(url: str) -> None:
    u = urlparse(url)
    if u.scheme != "https":
        raise HTTPException(status_code=400, detail="Only HTTPS URLs are allowed")
    if not u.hostname:
        raise HTTPException(status_code=400, detail="Invalid URL hostname")
    if _host_is_private_or_local(u.hostname):
        raise HTTPException(status_code=400, detail=f"Blocked hostname: {u.hostname}")


def _validate_proxy_url(proxy_url: str) -> str:
    value = (proxy_url or "").strip()

    if not value:
        return ""

    if "\r" in value or "\n" in value or "\t" in value:
        raise HTTPException(status_code=400, detail="Invalid proxy URL")

    u = urlparse(value)

    if u.scheme not in {"http", "https"}:
        raise HTTPException(status_code=400, detail="Invalid proxy URL scheme")

    if not u.hostname:
        raise HTTPException(status_code=400, detail="Invalid proxy URL hostname")

    return value


_HMAC_TOLERANCE_SECONDS = 300


def _clean_secret(value: str | None) -> str:
    return (value or "").strip().strip('"').strip("'")


def _derive_connector_hmac_secret() -> str:
    explicit = _clean_secret(os.getenv("CONNECTOR_HMAC_SECRET"))
    if explicit and explicit not in {"change_me", "changeme", "change-me"}:
        return explicit

    django_secret = _clean_secret(os.getenv("DJANGO_SECRET_KEY"))
    if not django_secret or django_secret == "unsafe-test-secret-key":
        raise HTTPException(status_code=500, detail="Internal HMAC secret is not configured")

    return hmac.new(
        django_secret.encode("utf-8"),
        b"doko.connector-hub.hmac.v1",
        hashlib.sha256,
    ).hexdigest()


def _sign_body(secret: str, body: bytes, ts: str) -> str:
    msg = ts.encode("utf-8") + b"." + body
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _verify_hmac(request: Request, body: bytes) -> None:
    ts = request.headers.get("X-Doko-Timestamp", "").strip()
    sig = request.headers.get("X-Doko-Signature", "").strip()

    if not ts or not sig:
        raise HTTPException(status_code=401, detail="Missing connector signature")

    try:
        timestamp = int(ts)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid connector timestamp")

    if abs(int(time.time()) - timestamp) > _HMAC_TOLERANCE_SECONDS:
        raise HTTPException(status_code=401, detail="Expired connector signature")

    expected = _sign_body(_derive_connector_hmac_secret(), body, ts)

    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status_code=401, detail="Invalid connector signature")
    

@app.post("/run/http")
async def run_http(request: Request):
    body = await request.body()
    _verify_hmac(request, body)

    try:
        req = HttpRunRequest.model_validate_json(body)
    except AttributeError:
        req = HttpRunRequest.parse_raw(body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid payload")
    
    if not req.calls:
        return {"results": []}

    timeout_ms = min(max(int(req.timeout_ms or 8000), 1000), 60000)
    timeout_s = float(timeout_ms) / 1000.0

    results: list[dict[str, Any]] = []
    proxy_url = _validate_proxy_url(req.proxy_url)
    print("DOKO_CONNECTOR_HUB_PROXY_URL:", "***configured***" if proxy_url else "")

    client_kwargs = {
        "timeout": timeout_s,
        "follow_redirects": False,
    }

    if proxy_url:
        client_kwargs["proxy"] = proxy_url

    async with httpx.AsyncClient(**client_kwargs) as client:
        for c in req.calls:
            _validate_url(c.url)

            method = (c.method or "GET").upper().strip()

            if method not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                results.append(
                    {
                        "key": c.key or "",
                        "value": c.value or "",
                        "http_status": 0,
                        "data": {"error": "Unsupported HTTP method"},
                    }
                )
                continue
            
            headers = {str(k): str(v) for k, v in (c.headers or {}).items()}

            try:
                r = await client.request(method=method, url=c.url, headers=headers)

                content_length = r.headers.get("content-length")
                if content_length and int(content_length) > 1_000_000:
                    results.append(
                        {
                            "key": c.key or "",
                            "value": c.value or "",
                            "http_status": r.status_code,
                            "data": {"error": "Response too large"},
                        }
                    )
                    continue

                print("HUB CALL", method, c.url, "->", r.status_code, "ct=", r.headers.get("content-type"))
                try:
                    data = r.json()
                except Exception as e:
                    data = {"raw": (r.text or "")[:20000]}
                    print("HUB CALL JSON PARSE ERROR", method, c.url, "->", str(e))

                results.append(
                    {
                        "key": c.key or "",
                        "value": c.value or "",
                        "http_status": r.status_code,
                        "data": data,
                    }
                )
            except Exception as e:
                results.append(
                    {
                        "key": c.key or "",
                        "value": c.value or "",
                        "http_status": 0,
                        "data": {"error": str(e)},
                    }
                )

    return {"results": results}
