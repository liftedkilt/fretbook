"""Safe ZIP extraction with protection against zip bombs and path traversal."""

from __future__ import annotations

import os
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from fretbook.importers.base import ImportError

# Safety limits
MAX_ZIP_FILE_COUNT = 1000
MAX_UNCOMPRESSED_TOTAL_BYTES = 250 * 1024 * 1024  # 250 MB
MAX_UNCOMPRESSED_FILE_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_COMPRESSION_RATIO = 100.0  # Suspected zip bomb if uncompressed/compressed exceeds this


@dataclass(frozen=True)
class ExtractedFile:
    path: Path
    filename: str
    original_relpath: str


def is_safe_member_name(name: str) -> bool:
    """Check if an archive member filename is safe against path traversal."""
    if not name or name.startswith("/") or name.startswith("\\"):
        return False
    # Check for drive letters like C:
    if len(name) >= 2 and name[1] == ":" and name[0].isalpha():
        return False
    # Normalize with PurePosixPath
    parts = PurePosixPath(name).parts
    if ".." in parts or "." in parts and len(parts) == 1:
        return False
    return True


def should_skip_member(info: zipfile.ZipInfo) -> bool:
    """Return True if the member is a directory or OS metadata file."""
    if info.is_dir():
        return True
    parts = PurePosixPath(info.filename).parts
    # Skip macOS resource fork / metadata folders and files
    if any(part == "__MACOSX" for part in parts):
        return True
    # Skip common OS metadata files
    basename = parts[-1] if parts else ""
    if basename in {".DS_Store", "Thumbs.db", "desktop.ini"} or basename.startswith("._"):
        return True
    return False


def is_symlink(info: zipfile.ZipInfo) -> bool:
    """Check if a ZipInfo entry is a Unix symlink."""
    mode = info.external_attr >> 16
    return (mode & 0o170000) == 0o120000


def safe_extract_zip(zip_path: Path, dest_dir: Path) -> list[ExtractedFile]:
    """Safely extract all valid files from a zip archive into dest_dir.

    Enforces limits on file count, total and per-file uncompressed size,
    compression ratio, and prevents path traversal (Zip Slip).
    """
    dest_dir = dest_dir.resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)

    try:
        archive = zipfile.ZipFile(zip_path, "r")
    except zipfile.BadZipFile as exc:
        raise ImportError("Invalid zip archive", "import.invalidZip") from exc

    with archive:
        entries = archive.infolist()

        # 1. File count check
        file_entries = [e for e in entries if not should_skip_member(e)]
        if len(file_entries) > MAX_ZIP_FILE_COUNT:
            raise ImportError(
                f"Zip archive contains too many files (max {MAX_ZIP_FILE_COUNT})",
                "import.zipTooManyFiles",
                limit=MAX_ZIP_FILE_COUNT,
                count=len(file_entries),
            )

        # 2. Size and ratio checks
        total_uncompressed = 0
        total_compressed = 0

        for info in file_entries:
            # Path traversal check
            if not is_safe_member_name(info.filename):
                raise ImportError(
                    f"Zip archive contains invalid or unsafe path: {info.filename}",
                    "import.zipPathTraversal",
                    filename=info.filename,
                )

            # Symlink check
            if is_symlink(info):
                raise ImportError(
                    f"Zip archive contains symlinks: {info.filename}",
                    "import.zipSymlinkNotAllowed",
                    filename=info.filename,
                )

            # Single file uncompressed limit
            if info.file_size > MAX_UNCOMPRESSED_FILE_BYTES:
                raise ImportError(
                    f"File '{info.filename}' in zip exceeds uncompressed size limit",
                    "import.zipFileTooLarge",
                    filename=info.filename,
                    limit=MAX_UNCOMPRESSED_FILE_BYTES,
                )

            total_uncompressed += info.file_size
            total_compressed += info.compress_size

            # Per-file ratio check for files of non-trivial size (> 100KB)
            if info.file_size > 100 * 1024 and info.compress_size > 0:
                file_ratio = info.file_size / info.compress_size
                if file_ratio > MAX_COMPRESSION_RATIO:
                    raise ImportError(
                        f"Zip entry '{info.filename}' exceeds compression ratio limit (suspected zip bomb)",
                        "import.zipBomb",
                        filename=info.filename,
                    )

        if total_uncompressed > MAX_UNCOMPRESSED_TOTAL_BYTES:
            raise ImportError(
                "Zip archive uncompressed size exceeds limit",
                "import.zipTooLarge",
                limit=MAX_UNCOMPRESSED_TOTAL_BYTES,
            )

        # Total archive ratio check
        if total_uncompressed > 1024 * 1024 and total_compressed > 0:
            ratio = total_uncompressed / total_compressed
            if ratio > MAX_COMPRESSION_RATIO:
                raise ImportError(
                    "Zip archive compression ratio is too high (suspected zip bomb)",
                    "import.zipBomb",
                )

        # 3. Safe extraction
        extracted: list[ExtractedFile] = []
        for info in file_entries:
            norm_name = os.path.normpath(info.filename)
            target_path = (dest_dir / norm_name).resolve()

            # Extra guarantee that target_path is within dest_dir
            if not target_path.is_relative_to(dest_dir):
                raise ImportError(
                    f"Zip archive path traversal detected: {info.filename}",
                    "import.zipPathTraversal",
                    filename=info.filename,
                )

            target_path.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as src, open(target_path, "wb") as dst:
                while chunk := src.read(65536):
                    dst.write(chunk)

            extracted.append(
                ExtractedFile(
                    path=target_path,
                    filename=Path(norm_name).name,
                    original_relpath=norm_name,
                )
            )

        return extracted
