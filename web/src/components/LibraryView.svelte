<script lang="ts">
  import {
    ApiError,
    createChordSheet,
    createTab,
    deleteSong,
    getMe,
    getMeta,
    importDocument,
    importFile,
    importUrl,
    listSongs,
    previewImport,
    saveSettings,
    waitForJob,
  } from "../lib/api";
  import { documentFromGuitarPro } from "../lib/alphatab/importScore";
  import { keyed, t, tOr } from "../lib/i18n.svelte";
  import { instrumentFamily, instrumentLabel, type InstrumentFilter } from "../lib/instruments";
  import { followLink, hrefFor, navigate } from "../lib/router.svelte";
  import { tuningLabel } from "../lib/tuning";
  import type { ImportPreview, InstrumentPreset, Job, SongSummary } from "../lib/types";

  let songs = $state<SongSummary[]>([]);
  let presets = $state<InstrumentPreset[]>([]);
  let defaultInstrument = $state("bass-4");
  let error = $state("");
  let notice = $state("");
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
  let sheetTitle = $state("");
  let sheetArtist = $state("");
  let sheetText = $state("");
  let filter = $state<"all" | InstrumentFilter>("all");
  let picker = $state<ImportPreview | null>(null);
  let previewUrl = $state("");
  let selected = $state<number[]>([]);

  const family = $derived(presets.find((item) => item.id === defaultInstrument)?.family ?? "bass");
  const visible = $derived(
    songs.filter((song) => filter === "all" || (song.content_kind === "tab" && instrumentFamily(song.preferred_instrument) === filter)),
  );

  function message(err: unknown): string {
    if (err instanceof ApiError || err instanceof Error) return err.message;
    return t("error.generic");
  }

  $effect(() => {
    Promise.all([getMeta(), getMe()])
      .then(([meta, me]) => {
        presets = meta.instruments;
        defaultInstrument = me.settings.default_instrument;
        preset = me.settings.default_instrument;
      })
      .catch((err: unknown) => {
        error = message(err);
      });
    void refresh();
  });

  async function refresh() {
    songs = await listSongs();
  }

  async function changeDefault(next: string) {
    error = "";
    try {
      defaultInstrument = (await saveSettings({ default_instrument: next })).default_instrument;
      preset = defaultInstrument;
    } catch (err) {
      error = message(err);
    }
  }

  async function create() {
    error = "";
    try {
      const song = await createTab({
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

  async function createSheet() {
    error = "";
    try {
      const song = await createChordSheet({ title: sheetTitle.trim(), artist: sheetArtist.trim(), chordpro: sheetText });
      navigate(`/songs/${song.id}`);
    } catch (err) {
      error = message(err);
    }
  }

  function progress(job: Job) {
    busy = tOr(job.progress_key, job.progress || t("library.importing"));
  }

  async function runJob(jobId: string) {
    const job = await waitForJob(jobId, progress);
    if (job.status === "error") {
      throw new Error(keyed({ key: job.error_key, message: job.error ?? "", params: job.error_params }));
    }
    const warnings = job.result?.warnings ?? [];
    if (warnings.length) notice = t("library.warnings", { warnings: warnings.map((item) => keyed(item)).join(" ") });
    if (job.result?.song_id) navigate(`/songs/${job.result.song_id}`);
  }

  const songsterrUrl = /^https:\/\/www\.songsterr\.com\/a\/wsa\/[\w-]+-s\d+/i;

  function togglePart(partId: number, checked: boolean) {
    selected = checked ? [...selected, partId] : selected.filter((id) => id !== partId);
  }

  async function startImport(target: string, partIds: number[] | null) {
    error = "";
    notice = "";
    busy = t("library.importing");
    try {
      const started = await importUrl(target, videoId.trim(), partIds);
      await runJob(started.job_id);
      picker = null;
    } catch (err) {
      error = message(err);
    } finally {
      busy = "";
    }
  }

  async function submitUrl() {
    error = "";
    notice = "";
    picker = null;
    const target = url.trim();
    if (!target) return;
    if (!songsterrUrl.test(target)) {
      await startImport(target, null);
      return;
    }
    busy = t("library.checkingTracks");
    let preview: ImportPreview;
    try {
      preview = await previewImport(target);
    } catch (err) {
      error = message(err);
      busy = "";
      return;
    }
    if (preview.tracks.length <= 1) {
      await startImport(target, null);
      return;
    }
    previewUrl = target;
    picker = preview;
    const matching = preview.tracks.filter((track) => (track.is_bass ? "bass" : "guitar") === family);
    const initial = matching.length ? matching : preview.tracks.slice(0, 1);
    selected = initial.map((track) => track.part_id);
    busy = "";
  }

  async function submitFile(file: File) {
    error = "";
    notice = "";
    busy = t("library.importing");
    try {
      if (/\.(gp|gp3|gp4|gp5|gpx)$/i.test(file.name)) {
        const parsed = documentFromGuitarPro(new Uint8Array(await file.arrayBuffer()), family);
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
    try {
      await deleteSong(song.id);
      await refresh();
    } catch (err) {
      error = message(err);
    }
  }

  function presetLabel(item: InstrumentPreset): string {
    return tOr(item.label_key, item.label);
  }
</script>

<div class="stack">
  <section class="panel">
    <div class="row">
      <label class="field">
        {t("settings.defaultInstrument")}
        <select value={defaultInstrument} onchange={(event) => void changeDefault(event.currentTarget.value)}>
          {#each presets as item (item.id)}
            <option value={item.id}>{presetLabel(item)}</option>
          {/each}
        </select>
      </label>
      <p class="hint" style="margin:0">{t("settings.defaultInstrumentHint")}</p>
    </div>
  </section>

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
    {#if picker}
      <div class="track-picker">
        <h3 class="section-title" style="margin-top:0.8rem">{t("library.pickTracks")}</h3>
        <p class="hint" style="margin-top:0">{t("library.pickTracksHint", { title: picker.title || picker.artist })}</p>
        {#each picker.tracks as track (track.part_id)}
          <label class="track-choice">
            <input
              type="checkbox"
              checked={selected.includes(track.part_id)}
              onchange={(event) => togglePart(track.part_id, event.currentTarget.checked)}
            />
            <span>
              {track.name || instrumentLabel(track.canonical_instrument || track.instrument)}
              · {instrumentLabel(track.canonical_instrument || track.instrument)}
              · {tuningLabel(track.tuning)}
              {#if track.capo > 0}· {t("player.capo", { fret: track.capo })}{/if}
            </span>
          </label>
        {/each}
        <div class="row" style="margin-top:0.6rem">
          <button class="primary" disabled={Boolean(busy) || selected.length === 0} onclick={() => void startImport(previewUrl, selected)}>
            {t("library.importSelected")}
          </button>
          <button type="button" onclick={() => (picker = null)}>{t("library.cancel")}</button>
        </div>
      </div>
    {/if}
    <div class="row" style="margin-top:0.7rem">
      <label class="field">
        {t("library.file")}
        <input
          type="file"
          accept=".musicxml,.xml,.json,.gp,.gp3,.gp4,.gp5,.gpx,.cho,.chordpro,.chopro,.crd,.txt"
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
          <select bind:value={denominator}>
            {#each [1, 2, 4, 8, 16, 32] as value (value)}<option {value}>{value}</option>{/each}
          </select>
        </span>
      </label>
      <button class="primary" onclick={() => void create()}>{t("library.create")}</button>
    </div>
  </section>

  <section class="panel">
    <h2 class="section-title" style="margin-top:0">{t("chords.createHeading")}</h2>
    <div class="row">
      <label class="field">{t("library.title")}<input bind:value={sheetTitle} /></label>
      <label class="field">{t("library.artist")}<input bind:value={sheetArtist} /></label>
    </div>
    <label class="field" style="margin-top:0.6rem">
      {t("chords.paste")}
      <textarea bind:value={sheetText} rows="6" spellcheck="false" placeholder={t("chords.pasteHint")}></textarea>
    </label>
    <div class="row" style="margin-top:0.6rem">
      <button class="primary" disabled={!sheetText.trim()} onclick={() => void createSheet()}>{t("chords.create")}</button>
    </div>
  </section>

  {#if error}<p class="error">{error}</p>{/if}
  {#if notice}<p class="hint">{notice}</p>{/if}

  <h2>{t("library.heading")}</h2>
  {#if songs.length === 0}
    <p class="hint">{t("library.empty")}</p>
  {:else}
    <div class="filter-row" role="group" aria-label={t("library.filters")}>
      <button type="button" aria-pressed={filter === "all"} onclick={() => (filter = "all")}>{t("library.filterAll")}</button>
      <button type="button" aria-pressed={filter === "bass"} onclick={() => (filter = "bass")}>{t("library.filterBass")}</button>
      <button type="button" aria-pressed={filter === "electric"} onclick={() => (filter = "electric")}>{t("library.filterElectric")}</button>
      <button type="button" aria-pressed={filter === "acoustic"} onclick={() => (filter = "acoustic")}>{t("library.filterAcoustic")}</button>
    </div>
    {#if visible.length === 0}
      <p class="hint">{t("library.filterEmpty")}</p>
    {/if}
    <div class="song-list">
      {#each visible as song (song.id)}
        <article class="song">
          <div>
            <h2>{song.title}</h2>
            <div class="meta">
              {#if song.artist}{song.artist} · {/if}
              {#if song.content_kind === "chords"}
                <span class="badge">{t("library.chordSheet")}</span>
              {:else}
                <span class="badge">{instrumentLabel(song.preferred_instrument)}</span>
                {t("library.strings", { count: song.string_count })}
                · {t("library.measures", { count: song.measure_count })}
                · {song.bpm} BPM
                · {song.has_audio ? t("library.audio") : t("library.noAudio")}
              {/if}
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
