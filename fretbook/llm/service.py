"""Who may call the model, with whose key, and how often.

Key choice (``select_key``): the provider must be on; a user set to ``disabled`` is refused; a local model needs no
key; a saved personal key is used first and never counts against a quota; otherwise ``shared`` users use the admin
key and ``own_key`` users are asked to bring one. Shared (and local) requests are held to the user's daily and
monthly limits and optional spend cap, and shared requests to the instance-wide monthly cap. Every user is rate
limited, and an identical request (same user, model, system and prompt) is answered from the cache.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any

import httpx

from fretbook.config import Settings
from fretbook.llm import providers
from fretbook.llm.providers import Completion, ProviderError
from fretbook.llm.store import LlmStore, day_start, month_start

WARN_AT = 0.8


class LlmRefused(Exception):
    """The request was not made. ``code`` and ``message`` are for the API error; the message is shown to people."""

    def __init__(self, code: str, message: str, status: int = 403, **details: Any) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details


@dataclass(frozen=True)
class KeyChoice:
    source: str  # "own" | "shared" | "local"
    key: str | None


@dataclass(frozen=True)
class Generation:
    text: str
    cached: bool
    source: str
    input_tokens: int
    output_tokens: int
    cost_usd: float


def select_key(provider: str, mode: str, admin_key: str | None, own_key: str | None) -> KeyChoice:
    """Pick the key for a request, or raise :class:`LlmRefused`."""
    if provider == "none":
        raise LlmRefused("llm.off", "LLM features are turned off on this server", 503)
    if mode == "disabled":
        raise LlmRefused("llm.noAccess", "an administrator has turned off LLM features for your account")
    if provider == "ollama":
        return KeyChoice("local", None)
    if own_key:
        return KeyChoice("own", own_key)
    if mode == "shared":
        if admin_key:
            return KeyChoice("shared", admin_key)
        raise LlmRefused("llm.noAdminKey", "the server has no shared API key set; add your own key in settings", 503)
    raise LlmRefused("llm.keyRequired", "add your own API key in settings to use LLM features")


class LlmService:
    def __init__(self, settings: Settings, *, transport: httpx.BaseTransport | None = None) -> None:
        self.settings = settings
        self.store = LlmStore(settings)
        self.transport = transport
        self._calls: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    # --- guards ---------------------------------------------------------------

    def _rate_limit(self, user_id: str, per_minute: int) -> None:
        now = time.monotonic()
        with self._lock:
            calls = self._calls[user_id]
            while calls and now - calls[0] >= 60:
                calls.popleft()
            if len(calls) >= per_minute:
                wait = max(1, int(60 - (now - calls[0])) + 1)
                raise LlmRefused(
                    "llm.rateLimited",
                    f"too many LLM requests; try again in {wait} seconds",
                    429,
                    retry_after=wait,
                    limit=per_minute,
                )
            calls.append(now)

    def _enforce_quota(self, user_id: str, source: str, access: dict[str, Any], cap: float | None) -> None:
        if source == "own":
            return
        today = self.store.usage_since(user_id, day_start(), quota_only=True)
        month = self.store.usage_since(user_id, month_start(), quota_only=True)
        daily, monthly, spend = access["daily_limit"], access["monthly_limit"], access["monthly_spend_cap_usd"]
        if daily is not None and today["generations"] >= daily:
            raise LlmRefused(
                "llm.quotaDaily", f"daily limit of {daily} generations reached; try again tomorrow", 429, limit=daily
            )
        if monthly is not None and month["generations"] >= monthly:
            raise LlmRefused(
                "llm.quotaMonthly",
                f"monthly limit of {monthly} generations reached",
                429,
                limit=monthly,
            )
        if spend is not None and month["cost_usd"] >= spend:
            raise LlmRefused("llm.quotaSpend", f"monthly spend limit of ${spend:.2f} reached", 429, limit=spend)
        if source == "shared" and cap is not None:
            used = self.store.usage_since(None, month_start(), key_source="shared")["cost_usd"]
            if used >= cap:
                raise LlmRefused(
                    "llm.instanceCap",
                    "the server's monthly LLM budget is used up; add your own key in settings or ask an administrator",
                    429,
                    limit=cap,
                )

    def _warn(self, user_id: str, source: str, access: dict[str, Any]) -> None:
        """Leave the admin a notice when this request took a user to 80% of a limit."""
        if source == "own":
            return
        today = self.store.usage_since(user_id, day_start(), quota_only=True)
        month = self.store.usage_since(user_id, month_start(), quota_only=True)
        checks = (
            ("daily", today["generations"], access["daily_limit"], day_start()),
            ("monthly", month["generations"], access["monthly_limit"], month_start()),
            ("spend", month["cost_usd"], access["monthly_spend_cap_usd"], month_start()),
        )
        for kind, used, limit, period in checks:
            if limit and used >= WARN_AT * limit:
                self.store.add_notice(user_id, kind, period)

    # --- the call -------------------------------------------------------------

    def generate(self, user_id: str, *, system: str, prompt: str, max_tokens: int = 4096) -> Generation:
        cfg = self.store.get_settings()
        access = self.store.get_user(user_id)
        choice = select_key(cfg["provider"], access["mode"], self.store.admin_key(), self.store.own_key(user_id))
        digest = hashlib.sha256(
            json.dumps([cfg["provider"], cfg["model"], system, prompt, max_tokens], sort_keys=True).encode()
        ).hexdigest()
        hit = self.store.cache_get(user_id, digest)
        if hit is not None:
            return Generation(hit, True, choice.source, 0, 0, 0.0)
        self._rate_limit(user_id, cfg["rate_limit_per_minute"])
        self._enforce_quota(user_id, choice.source, access, cfg["instance_monthly_cap_usd"])
        try:
            done: Completion = providers.complete(
                cfg["provider"],
                base_url=cfg["base_url"],
                model=cfg["model"],
                key=choice.key,
                system=system,
                prompt=prompt,
                max_tokens=max_tokens,
                transport=self.transport,
            )
        except ProviderError as exc:
            raise LlmRefused("llm.providerError", exc.message, exc.status) from exc
        cost = providers.estimate_cost(cfg["provider"], cfg["model"], done.input_tokens, done.output_tokens)
        self.store.record_usage(
            user_id,
            model=cfg["model"],
            key_source=choice.source,
            input_tokens=done.input_tokens,
            output_tokens=done.output_tokens,
            cost_usd=cost,
        )
        self.store.cache_put(user_id, digest, done.text)
        self._warn(user_id, choice.source, access)
        return Generation(done.text, False, choice.source, done.input_tokens, done.output_tokens, cost)

    def status(self, user_id: str) -> dict[str, Any]:
        """What the signed-in user sees: whether LLM features work for them and where they stand. No keys."""
        cfg = self.store.get_settings()
        access = self.store.get_user(user_id)
        try:
            choice: KeyChoice | None = select_key(
                cfg["provider"], access["mode"], self.store.admin_key(), self.store.own_key(user_id)
            )
            reason = None
        except LlmRefused as refused:
            choice, reason = None, refused.code
        today = self.store.usage_since(user_id, day_start(), quota_only=True)
        month = self.store.usage_since(user_id, month_start(), quota_only=True)
        return {
            "provider": cfg["provider"],
            "model": cfg["model"],
            "needs_key": cfg["provider"] in providers.HOSTED,
            "mode": access["mode"],
            "has_own_key": access["has_own_key"],
            "available": choice is not None,
            "source": choice.source if choice else None,
            "unavailable_reason": reason,
            "daily_limit": access["daily_limit"],
            "monthly_limit": access["monthly_limit"],
            "monthly_spend_cap_usd": access["monthly_spend_cap_usd"],
            "generations_today": today["generations"],
            "generations_month": month["generations"],
            "cost_month_usd": round(month["cost_usd"], 4),
        }
