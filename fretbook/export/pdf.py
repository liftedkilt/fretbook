"""Export hooks.

Issue #3 should implement :meth:`PdfExporter.export` and register it in
:func:`available_exporters`. The player shows an Export PDF action only when
``pdf`` is in that list (see ``GET /api/meta`` and ``web/src/lib/export/pdf.ts``).

alphaTab's ``api.print()`` already opens an A4 print view of the rendered
score. A server-side PDF can instead render the :class:`ScoreDocument` with
the song title, artist, tuning, and track name in the header, and must not
split a staff across a page. It has to cover at least 4-string bass, 5-string
bass, and 6-string guitar.
"""

from __future__ import annotations

from typing import Protocol

from fretbook.score.model import ScoreDocument


class Exporter(Protocol):
    kind: str

    def export(self, document: ScoreDocument, *, title: str, artist: str, track_id: str | None) -> bytes: ...


class PdfNotImplemented(RuntimeError):
    pass


class PdfExporter:
    kind = "pdf"

    def export(self, document: ScoreDocument, *, title: str, artist: str, track_id: str | None) -> bytes:
        del document, title, artist, track_id
        raise PdfNotImplemented(
            "PDF export is issue #3 and is not implemented. See fretbook/export/pdf.py "
            "and web/src/lib/export/pdf.ts (alphaTab api.print())."
        )


def available_exporters() -> list[str]:
    """Kinds the UI should offer. ``pdf`` is intentionally absent until issue #3."""
    return ["json"]
