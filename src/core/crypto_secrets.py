from __future__ import annotations

import base64
import hashlib
import hmac
import os
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

ENV_KEY_NAME = "DOKO_SECRET_ENCRYPTION_KEY"
LEGACY_ENV_KEY_NAME = "CONNECTOR_SECRET_ENCRYPTION_KEY"

_PLACEHOLDERS = {
    "",
    "change_me",
    "changeme",
    "change-me",
    "CHANGE_ME",
    "CHANGE-ME",
    "replace_me",
    "replace-me",
}


class SecretEncryptionError(RuntimeError):
    pass


def _clean(value: str | None) -> str:
    return (value or "").strip().strip('"').strip("'")


def _is_placeholder(value: str | None) -> bool:
    return _clean(value) in _PLACEHOLDERS


def _derive_key_from_django_secret() -> str:
    secret_key = _clean(os.getenv("DJANGO_SECRET_KEY"))
    if _is_placeholder(secret_key) or secret_key == "unsafe-test-secret-key":
        raise SecretEncryptionError(f"{ENV_KEY_NAME} is not configured")
    digest = hmac.new(
        secret_key.encode("utf-8"),
        b"doko.secret-encryption.v1",
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest).decode("utf-8")


def _normalize_key(raw: str) -> str:
    k = _clean(raw)
    if not k:
        raise SecretEncryptionError(f"{ENV_KEY_NAME} is not configured")
    try:
        decoded = base64.urlsafe_b64decode(k.encode("utf-8"))
    except Exception as e:
        raise SecretEncryptionError(f"{ENV_KEY_NAME} is invalid: {e}") from e
    if len(decoded) != 32:
        raise SecretEncryptionError(f"{ENV_KEY_NAME} is invalid")
    return k


@lru_cache(maxsize=1)
def _get_fernet() -> Fernet:
    raw = _clean(os.getenv(ENV_KEY_NAME))
    if _is_placeholder(raw):
        raw = _clean(os.getenv(LEGACY_ENV_KEY_NAME))
    if _is_placeholder(raw):
        raw = _derive_key_from_django_secret()
    key = _normalize_key(raw)
    return Fernet(key.encode("utf-8"))


def encrypt_secret(plain: Optional[str]) -> str:
    if plain is None:
        return ""
    s = str(plain)
    if not s.strip():
        return ""
    f = _get_fernet()
    token = f.encrypt(s.encode("utf-8"))
    return token.decode("utf-8")


def decrypt_secret(token: Optional[str]) -> str:
    if token is None:
        return ""
    t = str(token).strip()
    if not t:
        return ""
    f = _get_fernet()
    try:
        out = f.decrypt(t.encode("utf-8"))
        return out.decode("utf-8")
    except InvalidToken as e:
        raise SecretEncryptionError("Failed to decrypt secret: invalid token or key") from e
    except Exception as e:
        raise SecretEncryptionError(f"Failed to decrypt secret: {e}") from e


def can_encrypt() -> bool:
    try:
        _get_fernet()
        return True
    except Exception:
        return False


def generate_fernet_key() -> str:
    return Fernet.generate_key().decode("utf-8")