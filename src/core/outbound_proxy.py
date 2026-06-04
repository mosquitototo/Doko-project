from urllib.parse import quote

from .models import InstanceProxySettings


def build_outbound_proxy_url() -> str:
    settings = InstanceProxySettings.get_solo()

    if not settings.enabled:
        return ""

    host = str(settings.host or "").strip()
    port = settings.port

    if not host or not port:
        return ""

    if host.startswith(("http://", "https://")):
        base = host.rstrip("/")
    else:
        base = f"http://{host}"

    scheme, rest = base.split("://", 1)

    username = str(settings.username or "").strip()
    password = settings.get_password() if username else ""

    if username:
        credentials = quote(username, safe="")
        if password:
            credentials = f"{credentials}:{quote(password, safe='')}"
        rest = f"{credentials}@{rest}"

    return f"{scheme}://{rest}:{port}"


def build_outbound_proxies():
    url = build_outbound_proxy_url()

    if not url:
        return None

    return {
        "http": url,
        "https": url,
    }