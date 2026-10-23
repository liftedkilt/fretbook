# The UI is built with Node, then copied into the Python image so Fretbook
# still ships as one container. FastAPI serves the static files.
FROM node:22-bookworm-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build && npm run build:gp-cli

FROM python:3.12-slim-bookworm
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY fretbook ./fretbook
COPY --from=web /src/web/dist ./fretbook/static
# Guitar Pro files are read on the server by alphaTab under Node: the node binary (about 120 MB
# unpacked) and one bundled script (about 2.4 MB). Same Debian release as this image, so it runs here.
COPY --from=web /usr/local/bin/node /usr/local/bin/node
COPY --from=web /src/web/dist-gp/gp-to-document.mjs ./fretbook/gp/gp-to-document.mjs

# Create non-root user and ensure data and app directories are owned by fretbook
RUN groupadd --gid 1000 fretbook \
    && useradd --uid 1000 --gid fretbook --shell /bin/sh --home-dir /app fretbook \
    && mkdir -p /data /songs \
    && chown -R fretbook:fretbook /data /songs /app

# Set by CI for builds that are not a release tag, so the app can report which commit it runs.
ARG GIT_SHA=""
ENV FRETBOOK_GIT_SHA=$GIT_SHA \
    FRETBOOK_HOST=0.0.0.0 \
    FRETBOOK_PORT=8137 \
    FRETBOOK_DATA_DIR=/data \
    FRETBOOK_LEGACY_SONGS_DIR=/songs \
    PYTHONUNBUFFERED=1

USER fretbook

VOLUME /data
EXPOSE 8137

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://127.0.0.1:8137/api/health || exit 1

CMD ["python", "-m", "fretbook"]
