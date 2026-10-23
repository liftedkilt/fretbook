"""Per-user audio latency calibrations for audio output and input device pairs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from fretbook.api.deps import context, principal
from fretbook.api.schemas import AUTH_RESPONSES, AudioCalibration
from fretbook.auth.base import Principal
from fretbook.context import AppContext

router = APIRouter()


class AudioCalibrationBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    output_device: str = Field(default="default", max_length=120)
    input_device: str = Field(default="default", max_length=120)
    offset_ms: float = Field(ge=-1000.0, le=2000.0)
    jitter_ms: float | None = Field(default=None, ge=0.0, le=1000.0)


@router.get(
    "/api/me/calibrations",
    response_model=list[AudioCalibration],
    tags=["audio"],
    responses=AUTH_RESPONSES,
)
def list_calibrations(
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Return all stored audio calibrations for the calling user."""
    return JSONResponse(ctx.songs.list_calibrations(user.user_id))


@router.get(
    "/api/me/calibration",
    response_model=AudioCalibration | None,
    tags=["audio"],
    responses=AUTH_RESPONSES,
)
def get_calibration(
    output_device: str = Query("default", max_length=120),
    input_device: str = Query("default", max_length=120),
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Return the calibration for the given output and input device pair, or null if unset."""
    item = ctx.songs.get_calibration(user.user_id, output_device=output_device, input_device=input_device)
    return JSONResponse(item)


@router.put(
    "/api/me/calibration",
    response_model=AudioCalibration,
    tags=["audio"],
    responses=AUTH_RESPONSES,
)
def save_calibration(
    body: AudioCalibrationBody,
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> JSONResponse:
    """Store or update the audio calibration for the given output and input device pair."""
    saved = ctx.songs.save_calibration(
        user.user_id,
        output_device=body.output_device,
        input_device=body.input_device,
        offset_ms=body.offset_ms,
        jitter_ms=body.jitter_ms,
    )
    return JSONResponse(saved)


@router.delete(
    "/api/me/calibration",
    status_code=204,
    tags=["audio"],
    responses=AUTH_RESPONSES,
)
def delete_calibration(
    output_device: str = Query("default", max_length=120),
    input_device: str = Query("default", max_length=120),
    ctx: AppContext = Depends(context),
    user: Principal = Depends(principal),
) -> Response:
    """Delete the calibration for the given output and input device pair."""
    ctx.songs.delete_calibration(user.user_id, output_device=output_device, input_device=input_device)
    return Response(status_code=204)
