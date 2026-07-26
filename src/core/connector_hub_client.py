import hmac
import hashlib
import json
import time
import ipaddress
import socket
from urllib.parse import urlparse
import requests


# ----------------------------
# SSRF protections for EXTERNAL base_url
# ----------------------------

def _is_private_host(hostname: str) -> bool:
    try:
        infos = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        return True
    for info in infos:
        ip = info[4][0]
        try:
            ipobj = ipaddress.ip_address(ip)
            if (
                ipobj.is_private
                or ipobj.is_loopback
                or ipobj.is_link_local
                or ipobj.is_reserved
                or ipobj.is_multicast
            ):
                return True
        except ValueError:
            return True
    return False


def validate_external_base_url(base_url: str) -> str:
    u = urlparse(base_url)
    if u.scheme != "https":
        raise ValueError("base_url must be https")
    if not u.hostname or _is_private_host(u.hostname):
        raise ValueError("base_url host is not allowed")
    return base_url.rstrip("/")


# ----------------------------
# HMAC signing
# ----------------------------

def _sign(secret: str, body: bytes, ts: str) -> str:
    msg = ts.encode("utf-8") + b"." + body
    return hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()


def _join_url(hub_url: str, path: str) -> str:
    hub_url = (hub_url or "").strip()
    if not hub_url:
        raise ValueError("hub_url is empty (check CONNECTOR_HUB_URL)")

    if not (hub_url.startswith("http://") or hub_url.startswith("https://")):
        raise ValueError(f"hub_url must include scheme (http/https), got: {hub_url}")

    p = (path or "").strip()
    if not p:
        raise ValueError("path is empty")

    if not p.startswith("/"):
        p = "/" + p

    return hub_url.rstrip("/") + p


def run_hub_request(*, hub_url: str, secret: str, path: str, timeout_ms: int, payload: dict):
    url = _join_url(hub_url, path)

    ts = str(int(time.time()))
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    sig = _sign(secret, body, ts) if secret else ""

    headers = {
        "Content-Type": "application/json",
        "X-Doko-Timestamp": ts,
    }
    if sig:
        headers["X-Doko-Signature"] = sig

    resp = requests.post(
        url=url,
        data=body,
        headers=headers,
        timeout=max(1, int(timeout_ms / 1000)),
        allow_redirects=False,
    )
    return resp
