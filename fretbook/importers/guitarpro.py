"""Guitar Pro files are parsed in the browser.

alphaTab (MPL-2.0) already reads Guitar Pro 3-8. Doing it again in Python
would add a second parser. ``web/src/lib/alphatab/importScore.ts`` loads the
file, maps the score into a Fretbook document, and posts that document.

This class stays in the server registry so a job can name the format. It does
not claim uploads (``can_handle`` is false); the UI never sends ``.gp`` bytes
to the server.
"""

from __future__ import annotations

from fretbook.importers.base import ImporterNotImplemented, ImportRequest, ImportResult, Progress


class GuitarProImporter:
    kind = "guitarpro"
    extensions = (".gp", ".gp3", ".gp4", ".gp5", ".gpx")

    def can_handle(self, request: ImportRequest) -> bool:
        return False

    def import_score(self, request: ImportRequest, progress: Progress) -> ImportResult:
        del request, progress
        raise ImporterNotImplemented(
            "Guitar Pro files are imported in the browser by alphaTab "
            "(web/src/lib/alphatab/importScore.ts), then saved as a Fretbook document."
        )
