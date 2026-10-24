"""Stem separation with Demucs. It runs only in the job worker, and only when ``demucs`` is installed.

``htdemucs_6s`` splits a recording into bass, drums, guitar, piano, vocals and other; ``htdemucs`` has no
separate guitar or piano. Install the dependency with ``requirements-stems.txt`` (the worker image does).
"""

from __future__ import annotations

import importlib.util
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

DEFAULT_MODEL = "htdemucs_6s"
MODELS = ("htdemucs_6s", "htdemucs")
STEM_NAMES = ("bass", "drums", "guitar", "piano", "vocals", "other")


class StemsError(Exception):
    """Separation failed. ``key`` is an ``errors`` catalog key."""

    def __init__(self, message: str, key: str) -> None:
        super().__init__(message)
        self.key = key


def available() -> bool:
    """Whether Demucs can be imported here. A worker that cannot run it does not advertise the job."""
    return importlib.util.find_spec("demucs") is not None


# (source file, model name, directory for the stems, progress callback) -> stem name to file.
Separator = Callable[[Path, str, Path, Callable[[str, str], None]], dict[str, Path]]


def separate(source: Path, model_name: str, out_dir: Path, progress: Callable[[str, str], None]) -> dict[str, Path]:
    """Split ``source`` into stems, written to ``out_dir`` as mp3 (wav when ffmpeg is missing)."""
    if model_name not in MODELS:
        raise StemsError(f"unknown stem model {model_name!r}", "stems.badModel")
    if not available():
        raise StemsError("Demucs is not installed in this worker", "stems.unavailable")
    import torch  # noqa: PLC0415  (heavy; only a worker that separates imports it)
    from demucs.apply import apply_model  # noqa: PLC0415
    from demucs.audio import AudioFile, save_audio  # noqa: PLC0415
    from demucs.pretrained import get_model  # noqa: PLC0415

    progress("Loading the model", "stems.loading")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = get_model(model_name)
    model.to(device)
    model.eval()
    try:
        wav = AudioFile(source).read(streams=0, samplerate=model.samplerate, channels=model.audio_channels)
    except Exception as exc:  # demucs raises a plain RuntimeError when ffmpeg cannot read the file
        raise StemsError("the audio file could not be decoded", "stems.decodeFailed") from exc
    reference = wav.mean(0)
    wav = (wav - reference.mean()) / (reference.std() + 1e-8)
    progress("Separating the stems (slow without a GPU)", "stems.separating")
    with torch.no_grad():
        sources = apply_model(model, wav[None], device=device, split=True, overlap=0.25, progress=False)[0]
    sources = sources * (reference.std() + 1e-8) + reference.mean()
    progress("Saving the stems", "stems.saving")
    out_dir.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which("ffmpeg")
    written: dict[str, Path] = {}
    for name, stem in zip(model.sources, sources, strict=True):
        wav_path = out_dir / f"{name}.wav"
        save_audio(stem.cpu(), str(wav_path), samplerate=model.samplerate)
        written[name] = encode_mp3(wav_path, ffmpeg) if ffmpeg else wav_path
    return written


def encode_mp3(wav_path: Path, ffmpeg: str) -> Path:
    """Shrink a wav stem to a 192 kbit/s mp3 (about a tenth the size). The wav is kept if encoding fails."""
    target = wav_path.with_suffix(".mp3")
    done = subprocess.run(
        [ffmpeg, "-v", "error", "-y", "-i", str(wav_path), "-codec:a", "libmp3lame", "-b:a", "192k", str(target)],
        capture_output=True,
        timeout=600,
        check=False,
    )
    if done.returncode != 0 or not target.is_file():
        target.unlink(missing_ok=True)
        return wav_path
    wav_path.unlink(missing_ok=True)
    return target


def scratch_dir() -> Path:
    return Path(tempfile.mkdtemp(prefix="fretbook-stems-"))
