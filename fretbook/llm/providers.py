"""Calls to the model: Ollama (local), Anthropic, and OpenAI-compatible servers."""

from __future__ import annotations

from dataclasses import dataclass

import httpx

PROVIDERS = ("none", "ollama", "anthropic", "openai")
HOSTED = ("anthropic", "openai")
DEFAULT_BASE_URL = {
    "anthropic": "https://api.anthropic.com",
    "openai": "https://api.openai.com/v1",
    "ollama": "http://localhost:11434",
}
TIMEOUT_SECONDS = 300  # a local model on a CPU can be slow

# Rough US dollars per million (input, output) tokens, matched by substring of the model name. Estimates only: they
# size quotas and the cap, not an invoice. Local models cost nothing.
_PRICES: tuple[tuple[str, tuple[float, float]], ...] = (
    ("haiku", (1.0, 5.0)),
    ("sonnet", (3.0, 15.0)),
    ("opus", (5.0, 25.0)),
    ("mini", (0.4, 1.6)),
    ("nano", (0.1, 0.4)),
)
_DEFAULT_PRICE = {"anthropic": (3.0, 15.0), "openai": (2.5, 10.0)}


class ProviderError(Exception):
    """The provider refused or could not answer. ``message`` is safe to show; it never includes a key."""

    def __init__(self, message: str, status: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass(frozen=True)
class Completion:
    text: str
    input_tokens: int
    output_tokens: int


def estimate_cost(provider: str, model: str, input_tokens: int, output_tokens: int) -> float:
    if provider == "ollama":
        return 0.0
    low = model.lower()
    price = next((p for name, p in _PRICES if name in low), _DEFAULT_PRICE.get(provider, (3.0, 15.0)))
    return round((input_tokens * price[0] + output_tokens * price[1]) / 1_000_000, 6)


def complete(
    provider: str,
    *,
    base_url: str,
    model: str,
    key: str | None,
    system: str,
    prompt: str,
    max_tokens: int,
    transport: httpx.BaseTransport | None = None,
) -> Completion:
    base = (base_url or DEFAULT_BASE_URL[provider]).rstrip("/")
    try:
        with httpx.Client(timeout=TIMEOUT_SECONDS, transport=transport) as client:
            if provider == "anthropic":
                response = client.post(
                    f"{base}/v1/messages",
                    headers={"x-api-key": key or "", "anthropic-version": "2023-06-01"},
                    json={
                        "model": model,
                        "max_tokens": max_tokens,
                        "system": system,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
            elif provider == "openai":
                response = client.post(
                    f"{base}/chat/completions",
                    headers={"Authorization": f"Bearer {key or ''}"},
                    json={
                        "model": model,
                        "max_tokens": max_tokens,
                        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                    },
                )
            elif provider == "ollama":
                response = client.post(
                    f"{base}/api/chat",
                    json={
                        "model": model,
                        "stream": False,
                        "options": {"num_predict": max_tokens},
                        "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                    },
                )
            else:
                raise ProviderError("no LLM provider is configured", 503)
    except httpx.HTTPError as exc:
        raise ProviderError(f"could not reach the LLM provider ({type(exc).__name__})") from exc
    if response.status_code in (401, 403):
        raise ProviderError("the LLM provider rejected the API key", 502)
    if response.status_code == 429:
        raise ProviderError("the LLM provider is rate limiting requests; try again shortly", 503)
    if response.status_code >= 400:
        raise ProviderError(f"the LLM provider answered HTTP {response.status_code}")
    try:
        data = response.json()
        if provider == "anthropic":
            text = "".join(block.get("text", "") for block in data["content"] if block.get("type") == "text")
            usage = data.get("usage", {})
            return Completion(text, int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0)))
        if provider == "openai":
            usage = data.get("usage", {})
            text = data["choices"][0]["message"]["content"] or ""
            return Completion(text, int(usage.get("prompt_tokens", 0)), int(usage.get("completion_tokens", 0)))
        return Completion(
            data["message"]["content"], int(data.get("prompt_eval_count", 0)), int(data.get("eval_count", 0))
        )
    except (ValueError, KeyError, IndexError, TypeError, AttributeError) as exc:
        raise ProviderError("the LLM provider sent a response Fretbook could not read") from exc
