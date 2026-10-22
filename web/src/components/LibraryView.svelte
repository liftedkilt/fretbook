<script lang="ts">
  import { ApiError, createSong, deleteSong, getMeta, importDocument, importFile, importUrl, listSongs, waitForJob } from "../lib/api";
  import { documentFromGuitarPro } from "../lib/alphatab/importScore";
  import { t, tOr } from "../lib/i18n.svelte";
  import { followLink, hrefFor, navigate } from "../lib/router.svelte";
  import type { InstrumentPreset, SongSummary } from "../lib/types";

  let songs = $state<SongSummary[]>([]);
  let presets = $state<InstrumentPreset[]>([]);
  let error = $state("");
  let busy = $state("");
  let title = $state("");
  let artist = $state("");
  let preset = $state("bass-4");
  let bpm = $state(120);
  let measures = $state(4);
  let numerator = $state(4);
  let denominator = $state(4);
  let url = $state("");
  let videoId = $state("");

  function message(err: unknown): string {
    if (err instanceof ApiError) return err.message;
    if (err instanceof Error) return err.message;
    return t("error.generic");
  }

  $effect(() => {
    void getMeta()
      .then((meta) => {
        presets = meta.instruments;
      })
      .catch((err: unknown) => {
        error = message(err);
      });
    void refresh();
  });

  async function refresh() {
    songs = await listSongs();
  }

  async function create() {
    error = "";
    try {
      const song = await createSong({
        title: title.trim() || "Untitled",
        artist: artist.trim(),
        preset,
        bpm,
        measures,
        signature: [numerator, denominator],
      });
      navigate(`/songs/${song.id}/edit`);
    } catch (err) {
      error = message(err);
    }
  }

  async function runJob(jobId: string) {
    const job = await waitForJob(jobId);
    if (job.status === "error") throw new Error(job.error || t("error.generic"));
    const warnings = job.result?.warnings ?? [];
    if (warnings.length) error = t("library.warnings", { warnings: warnings.join(" ") });
    if (job.result?.song_id) navigate(`/songs/${job.result.song_id}`);
  }

  async function submitUrl() {
    error = "";
    busy = t("library.importing");
    try {
      const started = await importUrl(url.trim(), videoId.trim());
      await runJob(started.job_id);
    } catch (err) {
      error = message(err);
    } finally {
      busy = "";
    }
  }

  async function submitFile(file: File) {
    error = "";
    busy = t("library.importing");
    try {
      const lower = file.name.toLowerCase();
      if (/\.gp[345x]?$/.test(lower) || lower.endsWith(".gpx")) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const parsed = documentFromGuitarPro(bytes);
        const saved = await importDocument({
          title: parsed.title,
          artist: parsed.artist,
          source_kind: "guitarpro",
          document: parsed.document,
        });
        navigate(`/songs/${saved.id}`);
        return;
      }
      const started = await importFile(file);
      await runJob(started.job_id);
    } catch (err) {
      error = message(err);
    } finally {
      busy = "";
    }
  }

  async function remove(song: SongSummary) {
    if (!confirm(t("library.confirmDelete", { title: song.title }))) return;
    await deleteSong(song.id);
    await refresh();
  }

  function presetLabel(item: InstrumentPreset): string {
    return tOr(item.label_key, item.label);
  }
</script>

<div class="stack">
  <section class="panel">
    <h2 class="section-title" style="margin-top:0">{t("library.importHeading")}</h2>
    <div class="row">
      <label class="field" style="flex:1">
        {t("library.url")}
        <input bind:value={url} placeholder={t("library.urlHint")} onkeydown={(event) => { if (event.key === "Enter") void submitUrl(); }} />
      </label>
      <label class="field">
        {t("library.videoId")}
        <input bind:value={videoId} maxlength="11" />
      </label>
      <button class="primary" disabled={Boolean(busy) || !url.trim()} onclick={() => void submitUrl()}>{t("library.importUrl")}</button>
    </div>
    <div class="row" style="margin-top:0.7rem">
      <label class="field">
        {t("library.file")}
        <input
          type="file"
          accept=".musicxml,.xml,.json,.gp,.gp3,.gp4,.gp5,.gpx"
          onchange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void submitFile(file);
          }}
        />
      </label>
      {#if busy}<span class="hint">{busy}</span>{/if}
    </div>
  </section>

  <section class="panel">
    <h2 class="section-title" style="margin-top:0">{t("library.createHeading")}</h2>
    <div class="row">
      <label class="field">{t("library.title")}<input bind:value={title} /></label>
      <label class="field">{t("library.artist")}<input bind:value={artist} /></label>
      <label class="field">
        {t("library.preset")}
        <select bind:value={preset}>
          {#each presets as item (item.id)}
            <option value={item.id}>{presetLabel(item)}</option>
          {/each}
        </select>
      </label>
      <label class="field">{t("library.bpm")}<input type="number" min="1" max="399" bind:value={bpm} /></label>
      <label class="field">{t("library.measureCount")}<input type="number" min="1" max="500" bind:value={measures} /></label>
      <label class="field">
        {t("library.signature")}
        <span class="row">
          <input type="number" min="1" max="32" bind:value={numerator} />
          <input type="number" min="1" max="32" bind:value={denominator} />
        </span>
      </label>
      <button class="primary" onclick={() => void create()}>{t("library.create")}</button>
    </div>
  </section>

  {#if error}<p class="error">{error}</p>{/if}

  <h2>{t("library.heading")}</h2>
  {#if songs.length === 0}
    <p class="hint">{t("library.empty")}</p>
  {:else}
    <div class="song-list">
      {#each songs as song (song.id)}
        <article class="song">
          <div>
            <h2>{song.title}</h2>
            <div class="meta">
              {#if song.artist}{song.artist} · {/if}
              <span class="badge">{song.preferred_instrument}</span>
              {t("library.strings", { count: song.string_count })}
              · {t("library.measures", { count: song.measure_count })}
              · {song.bpm} BPM
              · {song.has_audio ? t("library.audio") : t("library.noAudio")}
            </div>
          </div>
          <div class="actions">
            <a class="button" href={hrefFor(`/songs/${song.id}`)} onclick={(event) => followLink(event, `/songs/${song.id}`)}>{t("library.open")}</a>
            <a class="button" href={hrefFor(`/songs/${song.id}/edit`)} onclick={(event) => followLink(event, `/songs/${song.id}/edit`)}>{t("library.edit")}</a>
            <button onclick={() => void remove(song)}>{t("library.delete")}</button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>
