import requests
import logging

from django.core.exceptions import ValidationError

from .crypto_secrets import decrypt_secret
from .models import AIProvider
from .outbound_proxy import build_outbound_proxies


logger = logging.getLogger(__name__)


def validate_provider_url(url: str):
    url = (url or "").strip()
    if not url.startswith(("https://", "http://")):
        raise ValidationError("Provider URL must start with http:// or https://")


def _build_chat_completions_url(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        raise ValidationError("Provider base URL is required")

    if base.endswith("/v1/chat/completions") or base.endswith("/chat/completions"):
        return base

    if base.endswith("/v1"):
        return f"{base}/chat/completions"

    return f"{base}/v1/chat/completions"


class LLMService:
    def __init__(self, provider: AIProvider):
        self.provider = provider
        self.last_response_preview = ""
        validate_provider_url(provider.base_url)

    def generate(self, *, system_prompt: str, user_prompt: str) -> str:
        response = None
        api_key = self.provider.get_api_key()

        if not api_key:
            raise ValidationError("AI provider API key is missing or could not be decrypted")

        url = _build_chat_completions_url(self.provider.base_url)

        logger.debug(
            "LLM request: url=%s model=%s timeout=%s",
            url,
            self.provider.default_model,
            self.provider.timeout_seconds,
        )

        try:
            response = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self.provider.default_model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": 0.2,
                },
                timeout=self.provider.timeout_seconds,
                proxies=build_outbound_proxies(),
            )

            self.last_response_preview = response.text[:2000]

            logger.debug("LLM response status: %s", response.status_code)
            print("DOKO_LLM_RESPONSE_STATUS:", response.status_code)

            response.raise_for_status()

            payload = response.json()
            content = payload["choices"][0]["message"]["content"].strip()
            self.last_response_preview = content[:2000]

            return content

        except requests.RequestException as exc:
            error_response = response or getattr(exc, "response", None)
            status_code = getattr(error_response, "status_code", "no_response")
            body_preview = (getattr(error_response, "text", "") or "")[:2000]

            logger.warning(
                "LLM request failed: status=%s error=%s body_preview=%s",
                status_code,
                exc,
                body_preview,
            )

            self.last_response_preview = body_preview
            raise ValidationError(
                f"LLM request failed: {exc}. Response preview: {body_preview}"
            ) from exc

        except (KeyError, IndexError, TypeError, ValueError) as exc:
            body_preview = (getattr(response, "text", "") or "")[:2000]

            logger.warning(
                "LLM response parsing failed: status=%s error=%s body_preview=%s",
                getattr(response, "status_code", "no_response"),
                exc,
                body_preview,
            )

            self.last_response_preview = body_preview
            raise ValidationError("LLM response format is invalid") from exc