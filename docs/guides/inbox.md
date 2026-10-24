# Watched inbox folder

For tabs kept on a NAS share, in Syncthing or in Nextcloud: set `FRETBOOK_INBOX_DIR` to a folder the server can read
and write, and drop files into it. The folder is polled every `FRETBOOK_INBOX_INTERVAL` seconds (no inotify, so network
mounts work). A file is imported when its size and modification time are the same on two polls in a row, by the same
content detection as the Add button, so a mislabelled file still lands in the right importer. Partial files (`.part`,
`.tmp`, `.crdownload`, names starting with `.` or `~`) are left alone, and a file already in your library is skipped.

```yaml
services:
  fretbook:
    volumes:
      - fretbook-data:/data
      - /mnt/nas/tabs:/inbox
    environment:
      FRETBOOK_INBOX_DIR: /inbox
```

The container user (uid `1000`) must be able to read the folder, and to write it in `move` mode.

- **`move` mode (default).** An imported file moves to `processed/`; a file that could not be imported moves to
  `failed/` with `<name>.error.txt` beside it saying why. Subfolders are read, and keep their layout under
  `processed/` and `failed/`. Fix a failed file and drop it in again.
- **`library` mode (`FRETBOOK_INBOX_MODE=library`).** The folder is the source of truth and is never written to, so
  it can be mounted read-only. Fretbook remembers each file's hash; a file whose content changes replaces the song it
  made before, and an unchanged file is not read again. A file that failed is tried again only after it changes (the
  reason is in the server log).
- **Sign-in.** With OIDC each user has a subfolder named after their e-mail address, the part before the `@`, their
  display name or their OIDC subject (for example `<inbox>/ada/`). Files in the folder root, or in a folder that
  matches no user (or more than one), are ignored. In single-user mode the folder itself is the library.

This is not `$FRETBOOK_DATA_DIR/inbox`, which only holds uploads while they are being imported.
