# The job worker (GPU)

Imports and other background work run as *jobs*, stored in the `jobs` table of the database. The web process runs
most kinds itself. Slow or GPU-bound kinds are meant to run in a separate **worker** that claims them from the same
table and writes results the same way. The design is in the
[architecture notes](https://github.com/liftedkilt/fretbook/blob/main/docs/ARCHITECTURE.md).

!!! info "What ships today"
    The worker framework is in place, but the only job kind that runs on it is a built-in test kind, `echo`.
    Stem separation, transcription and recognising tabs in video frames are on the
    [roadmap](https://github.com/liftedkilt/fretbook/blob/main/ROADMAP.md) and will use this worker. You do not need
    a worker for any feature that exists now. This page is for when you want to be ready, or want to move a kind off
    the web process.

## Running it with Docker Compose

`docker-compose.yml` defines an optional `worker` service behind a profile. It builds `Dockerfile.worker` (an NVIDIA
CUDA base with ffmpeg and tesseract) and shares the `fretbook-data` volume with the web container:

```sh
docker compose --profile worker up -d
```

Requirements:

- The [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/) on the host.
- The worker must share the **database file and data directory** with the web container: same host and volume, or a
  host that mounts the same storage (with working file locks, as for SQLite generally).
- The same settings as the web container for anything it reads (`FRETBOOK_DATA_DIR`, `FRETBOOK_DATABASE`, ...).

The worker runs `python -m fretbook.worker`, which claims every worker-only kind. Pass `--kinds a,b` to claim a
subset, and `--id` to name it. It records a heartbeat in the database, so `GET /api/meta` can report which kinds have
a live worker.

## Moving a kind off the web process

`FRETBOOK_WORKER_KINDS` lists extra kinds the web process leaves for a worker, for example
`FRETBOOK_WORKER_KINDS=import.youtube_frames`. Set it on the web container and run a worker that claims the same
kinds. Worker-only kinds are always left to the worker, whatever this says.

## Checking it

```sh
docker compose --profile worker logs -f worker     # "worker <id> claiming echo"
```

A worker that starts, migrates the database if needed and logs a `claiming` line is connected. If a job is claimed
by a worker that then stops, it is returned to the queue when a worker starts again.
