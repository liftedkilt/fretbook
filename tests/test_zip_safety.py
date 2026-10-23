import zipfile
from pathlib import Path

import pytest

from fretbook.importers.base import ImportError
from fretbook.importers.zip_safety import (
    MAX_ZIP_FILE_COUNT,
    safe_extract_zip,
)


def _make_zip(zip_path: Path, files: dict[str, bytes | str]) -> None:
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            content = data.encode("utf-8") if isinstance(data, str) else data
            zf.writestr(name, content)


def test_safe_extract_valid_files(tmp_path: Path) -> None:
    zip_path = tmp_path / "test.zip"
    dest_dir = tmp_path / "extracted"

    _make_zip(
        zip_path,
        {
            "song1.musicxml": "<score-partwise></score-partwise>",
            "subfolder/song2.cho": "{title: Song 2}",
        },
    )

    extracted = safe_extract_zip(zip_path, dest_dir)
    assert len(extracted) == 2
    filenames = {e.filename for e in extracted}
    assert filenames == {"song1.musicxml", "song2.cho"}
    for item in extracted:
        assert item.path.exists()
        assert item.path.is_relative_to(dest_dir.resolve())


def test_skips_macosx_and_metadata(tmp_path: Path) -> None:
    zip_path = tmp_path / "test.zip"
    dest_dir = tmp_path / "extracted"

    _make_zip(
        zip_path,
        {
            "song.tab": "e|---|",
            "__MACOSX/._song.tab": b"\x00\x05\x16",
            "folder/.DS_Store": b"\x00\x00\x00",
            "folder/Thumbs.db": b"\x00\x00\x00",
        },
    )

    extracted = safe_extract_zip(zip_path, dest_dir)
    assert len(extracted) == 1
    assert extracted[0].filename == "song.tab"


def test_rejects_path_traversal(tmp_path: Path) -> None:
    zip_path = tmp_path / "traversal.zip"
    dest_dir = tmp_path / "extracted"

    # ZipFile.writestr sanitizes leading slashes, so we construct ZipInfo directly
    with zipfile.ZipFile(zip_path, "w") as zf:
        info = zipfile.ZipInfo("../evil.txt")
        zf.writestr(info, "evil content")

    with pytest.raises(ImportError) as exc_info:
        safe_extract_zip(zip_path, dest_dir)
    assert exc_info.value.key == "import.zipPathTraversal"


def test_rejects_too_many_files(tmp_path: Path) -> None:
    zip_path = tmp_path / "many.zip"
    dest_dir = tmp_path / "extracted"

    files = {f"file_{i}.txt": "abc" for i in range(MAX_ZIP_FILE_COUNT + 5)}
    _make_zip(zip_path, files)

    with pytest.raises(ImportError) as exc_info:
        safe_extract_zip(zip_path, dest_dir)
    assert exc_info.value.key == "import.zipTooManyFiles"


def test_rejects_zip_bomb_ratio(tmp_path: Path) -> None:
    zip_path = tmp_path / "bomb.zip"
    dest_dir = tmp_path / "extracted"

    # Highly compressible data: 2MB of zeroes compresses to under 2KB (>1000:1 ratio)
    large_zeros = b"\x00" * (2 * 1024 * 1024)
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("bomb.txt", large_zeros)

    with pytest.raises(ImportError) as exc_info:
        safe_extract_zip(zip_path, dest_dir)
    assert exc_info.value.key == "import.zipBomb"


def test_rejects_file_too_large(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import fretbook.importers.zip_safety as zs

    monkeypatch.setattr(zs, "MAX_UNCOMPRESSED_FILE_BYTES", 500)
    zip_path = tmp_path / "toolarge.zip"
    dest_dir = tmp_path / "extracted"

    _make_zip(zip_path, {"large.txt": b"x" * 1000})

    with pytest.raises(ImportError) as exc_info:
        safe_extract_zip(zip_path, dest_dir)
    assert exc_info.value.key == "import.zipFileTooLarge"
