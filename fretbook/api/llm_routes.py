"""LLM settings: the provider and shared key (admin), per-user access and quotas (admin), and a user's own key.

No endpoint returns a key. The admin key and a user's own key are write-only: responses carry ``has_admin_key`` and
``has_own_key`` flags instead. Single-user mode has no admin role, so its one user manages the instance settings.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from fretbook.api.deps import context, principal
from fretbook.api.errors import api_error
from fretbook.api.schemas import ADMIN_RESPONSES, AUTH_RESPONSES
from fretbook.api.token_routes import session_user
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.llm.providers import PROVIDERS
from fretbook.llm.service import LlmRefused

router = APIRouter()

Provider = Literal["none", "ollama", "anthropic", "openai"]
Mode = Literal["own_key", "shared", "disabled"]


def llm_admin(ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> Principal:
    if ctx.settings.oidc_enabled and not user.is_admin:
        raise api_error(403, "auth.adminOnly", "only administrators can do this")
    return user


def refusal(exc: LlmRefused) -> Exception:
    """The API error for a refused LLM request, for routes that call ``LlmService.generate``."""
    return api_error(exc.status, exc.code, exc.message, **exc.details)


class LlmSettings(BaseModel):
    provider: Provider
    base_url: str
    """Ollama URL, or an API base URL for a hosted provider. Empty uses the provider's default."""
    model: str
    instance_monthly_cap_usd: float | None
    """Monthly dollar cap on the shared admin key across all users. ``null``: none."""
    rate_limit_per_minute: int
    has_admin_key: bool
    """Whether a shared key is saved. The key itself is never returned."""
    admin_spend_month_usd: float
    admin_generations_month: int


class LlmSettingsBody(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    provider: Provider
    base_url: str = Field(default="", max_length=300)
    model: str = Field(default="", max_length=200)
    instance_monthly_cap_usd: float | None = Field(default=None, ge=0, le=1_000_000)
    rate_limit_per_minute: int = Field(default=5, ge=1, le=600)
    admin_key: str | None = Field(default=None, max_length=500)
    """A new shared key. Leave out to keep the saved one."""
    clear_admin_key: bool = False


class LlmUserAccess(BaseModel):
    user_id: str
    display_name: str
    email: str
    mode: Mode
    has_own_key: bool
    daily_limit: int | None
    monthly_limit: int | None
    monthly_spend_cap_usd: float | None
    generations_today: int
    generations_month: int
    cost_month_usd: float
    input_tokens: int
    output_tokens: int
    cost_total_usd: float


class LlmUserAccessBody(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    mode: Mode
    daily_limit: int | None = Field(default=None, ge=0, le=1_000_000)
    monthly_limit: int | None = Field(default=None, ge=0, le=1_000_000)
    monthly_spend_cap_usd: float | None = Field(default=None, ge=0, le=1_000_000)


class LlmUsageRow(BaseModel):
    id: int
    user_id: str
    user_name: str
    at: str
    model: str
    key_source: Literal["shared", "own", "local"]
    input_tokens: int
    output_tokens: int
    cost_usd: float


class LlmNotice(BaseModel):
    user_id: str
    user_name: str
    limit_kind: Literal["daily", "monthly", "spend"]
    period: str
    created_at: str


class LlmStatus(BaseModel):
    provider: Provider
    model: str
    needs_key: bool
    mode: Mode
    has_own_key: bool
    available: bool
    """Whether this user's LLM requests would go through right now."""
    source: Literal["shared", "own", "local"] | None
    unavailable_reason: str | None
    daily_limit: int | None
    monthly_limit: int | None
    monthly_spend_cap_usd: float | None
    generations_today: int
    generations_month: int
    cost_month_usd: float


class OwnKeyBody(BaseModel):
    key: str = Field(min_length=8, max_length=500)


class NoticesCleared(BaseModel):
    cleared: int


def _settings_payload(ctx: AppContext) -> dict:
    from fretbook.llm.store import month_start

    used = ctx.llm.store.usage_since(None, month_start(), key_source="shared")
    return {
        **ctx.llm.store.get_settings(),
        "admin_spend_month_usd": round(used["cost_usd"], 4),
        "admin_generations_month": used["generations"],
    }


@router.get("/api/admin/llm", response_model=LlmSettings, tags=["llm"], responses=ADMIN_RESPONSES)
def get_llm_settings(ctx: AppContext = Depends(context), _admin: Principal = Depends(llm_admin)) -> JSONResponse:
    """The provider, model and caps. Never the shared key."""
    return JSONResponse(_settings_payload(ctx))


@router.put("/api/admin/llm", response_model=LlmSettings, tags=["llm"], responses=ADMIN_RESPONSES)
def put_llm_settings(
    body: LlmSettingsBody, ctx: AppContext = Depends(context), _admin: Principal = Depends(llm_admin)
) -> JSONResponse:
    """Save the provider settings. The shared key is stored encrypted and cannot be read back."""
    if body.provider not in PROVIDERS:  # pragma: no cover - the model already restricts it
        raise api_error(400, "llm.badProvider", "unknown provider")
    if body.provider != "none" and not body.model.strip():
        raise api_error(400, "llm.modelRequired", "choose a model name")
    ctx.llm.store.update_settings(
        provider=body.provider,
        base_url=body.base_url.strip(),
        model=body.model.strip(),
        instance_monthly_cap_usd=body.instance_monthly_cap_usd,
        rate_limit_per_minute=body.rate_limit_per_minute,
        admin_key=(body.admin_key or "").strip() or None,
        clear_admin_key=body.clear_admin_key,
    )
    return JSONResponse(_settings_payload(ctx))


@router.get("/api/admin/llm/users", response_model=list[LlmUserAccess], tags=["llm"], responses=ADMIN_RESPONSES)
def list_llm_users(ctx: AppContext = Depends(context), _admin: Principal = Depends(llm_admin)) -> JSONResponse:
    """Every user's LLM mode, limits and usage totals."""
    return JSONResponse(ctx.llm.store.list_user_access())


@router.put("/api/admin/llm/users/{user_id}", response_model=LlmUserAccess, tags=["llm"], responses=ADMIN_RESPONSES)
def put_llm_user(
    user_id: str,
    body: LlmUserAccessBody,
    ctx: AppContext = Depends(context),
    _admin: Principal = Depends(llm_admin),
) -> JSONResponse:
    """Set a user's mode (`own_key`, `shared`, `disabled`) and quota. ``null`` removes a limit."""
    if not ctx.users.exists(user_id):
        raise api_error(404, "user.notFound", "user not found")
    ctx.llm.store.set_user_access(
        user_id,
        mode=body.mode,
        daily_limit=body.daily_limit,
        monthly_limit=body.monthly_limit,
        monthly_spend_cap_usd=body.monthly_spend_cap_usd,
    )
    row = next(item for item in ctx.llm.store.list_user_access() if item["user_id"] == user_id)
    return JSONResponse(row)


@router.get("/api/admin/llm/usage", response_model=list[LlmUsageRow], tags=["llm"], responses=ADMIN_RESPONSES)
def llm_usage_log(
    user_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=1000),
    ctx: AppContext = Depends(context),
    _admin: Principal = Depends(llm_admin),
) -> JSONResponse:
    """The usage log, newest first: user, time, model, tokens and estimated cost."""
    return JSONResponse(ctx.llm.store.usage_log(user_id, limit))


@router.get("/api/admin/llm/notices", response_model=list[LlmNotice], tags=["llm"], responses=ADMIN_RESPONSES)
def llm_notices(ctx: AppContext = Depends(context), _admin: Principal = Depends(llm_admin)) -> JSONResponse:
    """Users who reached 80% of a limit this period."""
    return JSONResponse(ctx.llm.store.list_notices())


@router.delete("/api/admin/llm/notices", response_model=NoticesCleared, tags=["llm"], responses=ADMIN_RESPONSES)
def clear_llm_notices(ctx: AppContext = Depends(context), _admin: Principal = Depends(llm_admin)) -> JSONResponse:
    return JSONResponse({"cleared": ctx.llm.store.clear_notices()})


@router.get("/api/llm", response_model=LlmStatus, tags=["llm"], responses=AUTH_RESPONSES)
def llm_status(ctx: AppContext = Depends(context), user: Principal = Depends(principal)) -> JSONResponse:
    """Whether LLM features work for the caller, which key they would use, and their quota use. No keys."""
    return JSONResponse(ctx.llm.status(user.user_id))


@router.put("/api/llm/key", response_model=LlmStatus, tags=["llm"], responses=AUTH_RESPONSES)
def put_own_key(
    body: OwnKeyBody, ctx: AppContext = Depends(context), user: Principal = Depends(session_user)
) -> JSONResponse:
    """Save the caller's own API key, encrypted. It is used only for the caller's requests and never shown again."""
    key = body.key.strip()
    if len(key) < 8:
        raise api_error(400, "llm.keyInvalid", "that does not look like an API key")
    ctx.llm.store.set_own_key(user.user_id, key)
    return JSONResponse(ctx.llm.status(user.user_id))


@router.delete("/api/llm/key", response_model=LlmStatus, tags=["llm"], responses=AUTH_RESPONSES)
def delete_own_key(ctx: AppContext = Depends(context), user: Principal = Depends(session_user)) -> JSONResponse:
    """Remove the caller's saved key."""
    ctx.llm.store.set_own_key(user.user_id, None)
    return JSONResponse(ctx.llm.status(user.user_id))
