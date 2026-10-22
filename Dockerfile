# The UI is built with Node, then copied into the Python image so Fretbook
# still ships as one container. FastAPI serves the static files.
FROM node:22-bookworm-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY fretbook ./fretbook
COPY --from=web /src/web/dist ./fretbook/static
ENV FRETBOOK_HOST=0.0.0.0 \
    FRETBOOK_PORT=8137 \
    FRETBOOK_DATA_DIR=/data \
    FRETBOOK_LEGACY_SONGS_DIR=/songs \
    PYTHONUNBUFFERED=1
VOLUME /data
EXPOSE 8137
CMD ["python", "-m", "fretbook"]
