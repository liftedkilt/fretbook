"""Regenerate `gp/riff.gpx` (Guitar Pro 6) from `gp/riff.gp`. Standard library only.

    python tests/fixtures/corpus/generate_gpx.py

Neither PyGuitarPro nor alphaTab can write `.gpx`, so this wraps the riff's `score.gpif` (the XML inside the
Guitar Pro 7/8 file, written by alphaTab) in the GPX container: a `BCFS` file system of 4096-byte sectors, inside
a `BCFZ` bit stream. The stream uses only literal runs (no back references), which every reader accepts but
Guitar Pro itself would compress further. The XML is declared as GPIF 6.1.0.
"""

import re
import struct
import zipfile
from pathlib import Path

GP = Path(__file__).parent / "gp"
SECTOR = 4096


def bcfs(name: str, data: bytes) -> bytes:
    """A file system with one file: the 4-byte header, an unused sector 0, the file entry, then its data.

    Sector numbers count from the end of the header, as alphaTab and the GPX spec's readers do."""
    count = -(-len(data) // SECTOR)
    entry = struct.pack("<I", 2) + name.encode().ljust(136, b"\0")  # the name fills bytes 4-139
    entry += struct.pack("<I", len(data)) + b"\0" * 4  # size at +140, then 4 unused bytes; block list at +148
    entry += b"".join(struct.pack("<I", 2 + i) for i in range(count))
    return b"BCFS" + b"\0" * SECTOR + entry.ljust(SECTOR, b"\0") + data.ljust(count * SECTOR, b"\0")


def bcfz(payload: bytes) -> bytes:
    """Compress with literal runs only: a 0 bit, a 2-bit length (low bit first), then up to 3 bytes."""
    bits: list[int] = []
    for start in range(0, len(payload), 3):
        chunk = payload[start : start + 3]
        bits += [0, len(chunk) & 1, len(chunk) >> 1]
        for byte in chunk:
            bits += [(byte >> shift) & 1 for shift in range(7, -1, -1)]
    bits += [0] * (-len(bits) % 8)
    packed = bytes(int("".join(map(str, bits[i : i + 8])), 2) for i in range(0, len(bits), 8))
    return b"BCFZ" + struct.pack("<I", len(payload)) + packed


def main() -> None:
    with zipfile.ZipFile(GP / "riff.gp") as archive:
        gpif = archive.read("Content/score.gpif").decode("utf-8")
    gpif = re.sub(r"<GPVersion>[^<]*</GPVersion>", "<GPVersion>6.1.0</GPVersion>", gpif, count=1)
    gpif = gpif.replace(">GP8</EncodingDescription>", ">GP6</EncodingDescription>")
    out = bcfz(bcfs("score.gpif", gpif.encode("utf-8")))
    (GP / "riff.gpx").write_bytes(out)
    print("wrote riff.gpx", len(out), "bytes")


if __name__ == "__main__":
    main()
