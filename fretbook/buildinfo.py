"""Build identity baked into the image: the git commit of a non-release build."""

import os


def git_sha() -> str | None:
    """The commit the image was built from, or ``None`` for a release build or a source checkout.

    The Dockerfile sets ``FRETBOOK_GIT_SHA`` from a build argument, which CI leaves empty for ``v*`` tags.
    """
    return os.environ.get("FRETBOOK_GIT_SHA", "").strip()[:40] or None
