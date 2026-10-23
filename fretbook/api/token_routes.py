"""Personal API tokens: scripts and the CLI send one as ``Authorization: Bearer``.

A token acts as its owner, so it can do what that user can and no more. It cannot manage tokens: that takes a
signed-in session, so a leaked token cannot mint another.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from fretbook.api.deps import context, principal
from fretbook.api.errors import api_error
from fretbook.api.schemas import AUTH_RESPONSES, ApiToken, ApiTokenCreated
from fretbook.auth.base import Principal
from fretbook.context import AppContext
from fretbook.storage.users import MAX_TOKENS_PER_USER

router = APIRouter()


class CreateTokenBody(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    name: str = Field(min_length=1, max_length=80)
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)
    """Days until the token stops working. Leave out for a token that does not expire."""


def session_user(user: Principal = Depends(principal)) -> Principal:
    if user.via_token:
        raise api_error(403, "token.sessionRequired", "API tokens cannot manage API tokens")
    return user


@router.get("/api/tokens", response_model=list[ApiToken], tags=["tokens"], responses=AUTH_RESPONSES)
def list_tokens(ctx: AppContext = Depends(context), user: Principal = Depends(session_user)) -> JSONResponse:
    """The caller's tokens, newest first. Never includes the secrets."""
    return JSONResponse(ctx.users.list_tokens(user.user_id))


@router.post("/api/tokens", status_code=201, response_model=ApiTokenCreated, tags=["tokens"], responses=AUTH_RESPONSES)
def create_token(
    body: CreateTokenBody, ctx: AppContext = Depends(context), user: Principal = Depends(session_user)
) -> JSONResponse:
    """Create a token. The secret is in this response only; Fretbook keeps just a hash."""
    name = body.name.strip()
    if not name:
        raise api_error(400, "token.nameRequired", "give the token a name")
    created = ctx.users.create_token(user.user_id, name, expires_in_days=body.expires_in_days)
    if created is None:
        raise api_error(409, "token.tooMany", "too many tokens; revoke one first", limit=MAX_TOKENS_PER_USER)
    secret, row = created
    return JSONResponse({**row, "token": secret}, status_code=201)


@router.delete(
    "/api/tokens/{token_id}", status_code=204, response_model=None, tags=["tokens"], responses=AUTH_RESPONSES
)
def revoke_token(
    token_id: str, ctx: AppContext = Depends(context), user: Principal = Depends(session_user)
) -> Response:
    """Revoke a token. It stops working at once."""
    if not ctx.users.revoke_token(user.user_id, token_id):
        raise api_error(404, "token.notFound", "token not found")
    return Response(status_code=204)
