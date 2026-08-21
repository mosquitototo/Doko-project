from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Any
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


@app.get("/health")
def health():
    return {"ok": True}


class HttpCall(BaseModel):
    key: str = ""
    value: str = ""
    method: str = "GET"
    url: str
    headers: dict[str, str] = Field(default_factory=dict)
    body: Any | None = None


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


_USED_NONCES: dict[str, int] = {}


def _sign_body(secret: str, body: bytes, ts: str, nonce: str) -> str:
    msg = ts.encode("utf-8") + b"." + nonce.encode("utf-8") + b"." + body
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _verify_hmac(request: Request, body: bytes) -> None:
    ts = request.headers.get("X-Doko-Timestamp", "").strip()
    nonce = request.headers.get("X-Doko-Nonce", "").strip()
    sig = request.headers.get("X-Doko-Signature", "").strip()

    if not ts or not nonce or not sig:
        raise HTTPException(status_code=401, detail="Missing connector signature")

    if len(nonce) < 16 or len(nonce) > 128:
        raise HTTPException(status_code=401, detail="Invalid connector nonce")

    try:
        timestamp = int(ts)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid connector timestamp")

    if abs(int(time.time()) - timestamp) > _HMAC_TOLERANCE_SECONDS:
        raise HTTPException(status_code=401, detail="Expired connector signature")

    now = int(time.time())
    for used_nonce, expires_at in list(_USED_NONCES.items()):
        if expires_at <= now:
            _USED_NONCES.pop(used_nonce, None)

    if nonce in _USED_NONCES:
        raise HTTPException(status_code=401, detail="Replayed connector signature")

    expected = _sign_body(_derive_connector_hmac_secret(), body, ts, nonce)

    if not hmac.compare_digest(expected, sig):
        raise HTTPException(status_code=401, detail="Invalid connector signature")

    _USED_NONCES[nonce] = now + _HMAC_TOLERANCE_SECONDS
    

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
    client_kwargs = {
        "timeout": timeout_s,
        "follow_redirects": False,
        "trust_env": False,
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
                async with client.stream(method=method, url=c.url, headers=headers, json=c.body) as r:
                    chunks = []
                    size = 0
                    too_large = False
                    async for chunk in r.aiter_bytes():
                        size += len(chunk)
                        if size > 1_000_000:
                            too_large = True
                            break
                        chunks.append(chunk)
                    raw = b"".join(chunks)

                if too_large:
                    data = {"error": "Response too large"}
                else:
                    try:
                        data = json.loads(raw)
                    except Exception:
                        data = {"raw": raw.decode("utf-8", errors="replace")[:20000]}

                results.append(
                    {
                        "key": c.key or "",
                        "value": c.value or "",
                        "http_status": r.status_code,
                        "data": data,
                    }
                )
            except Exception:
                results.append(
                    {
                        "key": c.key or "",
                        "value": c.value or "",
                        "http_status": 0,
                        "data": {"error": "Connector request failed"},
                    }
                )

    return {"results": results}
