# The job worker (GPU)

Imports and other background work run as *jobs*, stored in the `jobs` table of the database. The web process runs
most kinds itself. Slow or GPU-bound kinds are meant to run in a separate **worker** that claims them from the same
table and writes results the same way. The design is in the
[architecture notes](https://github.com/liftedkilt/fretbook/blob/main/docs/ARCHITECTURE.md).

!!! info "What runs on it today"
    The worker runs **stem separation** (`audio.stems`, see below), **audio transcription** (`audio.transcribe`, see below), **sheet music recognition** (`import.omr`, optional) and a built-in test kind, `echo`. Recognising tabs in video frames is on the
    [roadmap](https://github.com/liftedkilt/fretbook/blob/main/ROADMAP.md) and will use it too. You do not need a
    worker for any other feature.

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

## Stem separation

With a worker running, **Stems** appears in the practice panel of a song that has a recording. **Separate stems**
runs [Demucs](https://github.com/adefossez/demucs) (`htdemucs_6s`) on the recording and stores the bass, drums,
guitar, piano, vocals and the rest as separate files. Tick **Play with stems** to get a mixer with mute, solo and a
volume for each, for example to play along without the bass or to solo the guitar. **Remove stems** frees the space
(about 5 MB a minute per stem); replacing the song's audio removes them too, and library backups leave them out.

- `Dockerfile.worker` installs Demucs (`requirements-stems.txt`). The first run downloads the model (about 100 MB
  to the worker's torch cache, `~/.cache/torch`; mount a volume there to keep it).
- It needs about 4 GB of memory. A GPU makes a four-minute song take under a minute.
- **Without a GPU** it still works, on the CPU, but expect several minutes per song. If you run
  `python -m fretbook.worker` yourself on a machine without a GPU, `pip install -r requirements-stems.txt` and
  ffmpeg are all it needs.
- A worker where Demucs is not installed does not claim the kind, so the feature stays hidden. With no worker at all
  nothing is shown and the rest of Fretbook is unaffected.

## Audio transcription

With a worker that has `onnxruntime`, a song with a recording gets a **Transcribe** button in the sync tools of the
player. It turns the recording into a new draft tab track: [basic-pitch](https://github.com/spotify/basic-pitch)
(Spotify, Apache 2.0; the ONNX model ships in `fretbook/audio/models/`) finds the notes, the beat tracker used by
auto-sync gives the tempo and bar lines, and the fingering pass picks strings and frets. The song's sync marks are set
from the beat grid, and the song is flagged for review: expect wrong notes and octave errors, especially in a full
mix. Pick the **bass** or **guitar** stem to run Demucs first (needs `requirements-stems.txt` too), which helps a lot.
The upload endpoint `POST /api/imports/transcribe` does the same for a new audio file and creates the song.

- `Dockerfile.worker` installs `requirements-transcribe.txt` (`onnxruntime`, `scipy`). On a machine without Docker,
  `pip install -r requirements-transcribe.txt` and ffmpeg are all it needs; it runs on the CPU, in about a tenth of
  the recording's length.
- A worker without `onnxruntime` does not claim the kind, so the button stays hidden.
- `python scripts/transcribe_eval.py` prints note precision, recall and F-measure on synthetic audio rendered from
  the MIDI corpus.

## Sheet music recognition

With a worker that has [Audiveris](https://github.com/Audiveris/audiveris), dropping a PDF or an image of standard
notation into **Add** reads it into a tab draft (`import.omr`, see [Importing](../guides/importing.md#sheet-music)).
It is optional because Audiveris is Java and adds about 200 MB to the image. Build the worker with the Ubuntu 22.04
package from the [releases page](https://github.com/Audiveris/audiveris/releases):

```sh
docker build -f Dockerfile.worker \
  --build-arg AUDIVERIS_DEB_URL=https://github.com/Audiveris/audiveris/releases/download/5.11.0/Audiveris-5.11.0-ubuntu22.04-x86_64.deb \
  -t fretbook-worker .
```

Outside Docker, install Audiveris so that `audiveris` is on the `PATH`, or set `FRETBOOK_AUDIVERIS` to its launcher
(`/opt/audiveris/bin/Audiveris` for the package). A worker without it does not claim `import.omr`, and a worker needs no
GPU for this. A page takes from several seconds to a few minutes; the job times out after 15 minutes.

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
