"""Encryption at rest for API keys.

The key is ``FRETBOOK_SECRET_KEY`` when set (any string; it is stretched), otherwise a random one that is created
once in ``$FRETBOOK_DATA_DIR/secret.key`` (mode 0600). Keep it out of backups that sit next to the database, or the
encryption buys nothing.
"""

from __future__ import annotations

import base64
import hashlib
import os
import secrets
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

KEY_FILE = "secret.key"


class SecretBox:
    def __init__(self, passphrase: str) -> None:
        digest = hashlib.sha256(b"fretbook-llm-keys:" + passphrase.encode()).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(digest))

    @classmethod
    def for_data_dir(cls, data_dir: Path, configured: str = "") -> SecretBox:
        if configured:
            return cls(configured)
        path = data_dir / KEY_FILE
        if not path.is_file():
            data_dir.mkdir(parents=True, exist_ok=True)
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as handle:
                handle.write(secrets.token_urlsafe(48))
        return cls(path.read_text(encoding="utf-8").strip())

    def encrypt(self, plain: str) -> str:
        return self._fernet.encrypt(plain.encode()).decode()

    def decrypt(self, token: str) -> str | None:
        """The plain text, or ``None`` when the token was made with another secret."""
        try:
            return self._fernet.decrypt(token.encode()).decode()
        except InvalidToken:
            return None
