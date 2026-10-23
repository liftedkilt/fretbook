from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from fretbook.app import create_app
from fretbook.config import Settings


def _client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings.for_tests(tmp_path)))


def test_calibration_lifecycle(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        # Initially empty
        resp = client.get("/api/me/calibrations")
        assert resp.status_code == 200
        assert resp.json() == []

        # Get unset returns null
        resp = client.get("/api/me/calibration", params={"output_device": "speakers", "input_device": "mic"})
        assert resp.status_code == 200
        assert resp.json() is None

        # Save calibration
        body = {
            "output_device": "speakers",
            "input_device": "mic",
            "offset_ms": 124.5,
            "jitter_ms": 4.2,
        }
        resp = client.put("/api/me/calibration", json=body)
        assert resp.status_code == 200
        saved = resp.json()
        assert saved["output_device"] == "speakers"
        assert saved["input_device"] == "mic"
        assert saved["offset_ms"] == 124.5
        assert saved["jitter_ms"] == 4.2
        assert "updated_at" in saved

        # Get specific calibration
        resp = client.get("/api/me/calibration", params={"output_device": "speakers", "input_device": "mic"})
        assert resp.status_code == 200
        assert resp.json() == saved

        # List calibrations includes it
        resp = client.get("/api/me/calibrations")
        assert resp.status_code == 200
        assert resp.json() == [saved]

        # Update the calibration (e.g. manual offset slider adjustment)
        update_body = {
            "output_device": "speakers",
            "input_device": "mic",
            "offset_ms": 130.0,
            "jitter_ms": 4.2,
        }
        resp = client.put("/api/me/calibration", json=update_body)
        assert resp.status_code == 200
        updated = resp.json()
        assert updated["offset_ms"] == 130.0

        # Delete calibration
        resp = client.delete("/api/me/calibration", params={"output_device": "speakers", "input_device": "mic"})
        assert resp.status_code == 204

        # Now returns null
        resp = client.get("/api/me/calibration", params={"output_device": "speakers", "input_device": "mic"})
        assert resp.status_code == 200
        assert resp.json() is None

        resp = client.get("/api/me/calibrations")
        assert resp.status_code == 200
        assert resp.json() == []


def test_calibration_validation(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        # Offset out of reasonable bounds (-1000 to 2000)
        resp = client.put("/api/me/calibration", json={"output_device": "out", "input_device": "in", "offset_ms": 5000})
        assert resp.status_code == 422

        # Negative jitter is invalid
        resp = client.put(
            "/api/me/calibration",
            json={"output_device": "out", "input_device": "in", "offset_ms": 50, "jitter_ms": -5},
        )
        assert resp.status_code == 422


def test_calibration_per_user_isolation(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        ctx = client.app.state.ctx

        # Direct repository calls to test multiple users
        ctx.songs.ensure_user("user-a", "User A")
        ctx.songs.ensure_user("user-b", "User B")

        ctx.songs.save_calibration("user-a", output_device="out-1", input_device="in-1", offset_ms=100.0, jitter_ms=2.0)
        ctx.songs.save_calibration("user-b", output_device="out-1", input_device="in-1", offset_ms=200.0, jitter_ms=5.0)

        cal_a = ctx.songs.get_calibration("user-a", "out-1", "in-1")
        cal_b = ctx.songs.get_calibration("user-b", "out-1", "in-1")

        assert cal_a is not None and cal_a["offset_ms"] == 100.0
        assert cal_b is not None and cal_b["offset_ms"] == 200.0

        # Deleting user-a cascade deletes calibrations
        with ctx.songs._session() as conn:
            conn.execute("DELETE FROM users WHERE id = 'user-a'")
        assert ctx.songs.get_calibration("user-a", "out-1", "in-1") is None
        assert ctx.songs.get_calibration("user-b", "out-1", "in-1") is not None
