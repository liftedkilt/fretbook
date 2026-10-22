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
  let filter = $state<"all" | "chords" | InstrumentFilter>("all");
  let query = $state("");
  let activeTab = $state<"import" | "tab" | "chord">("import");
  let picker = $state<ImportPreview | null>(null);
  let previewUrl = $state("");
  let selected = $state<number[]>([]);

  const family = $derived(presets.find((item) => item.id === defaultInstrument)?.family ?? "bass");
  const visible = $derived(
    songs.filter((song) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "chords" && song.content_kind === "chords") ||
        (song.content_kind === "tab" && instrumentFamily(song.preferred_instrument) === filter);
      if (!matchesFilter) return false;
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return song.title.toLowerCase().includes(q) || song.artist.toLowerCase().includes(q);
    }),
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
        title: title.trim() || t("library.untitled"),
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
  <section class="panel studio-deck">
    <div class="studio-deck-header">
      <div class="segmented" role="group" aria-label={t("library.studioMode")}>
        <button
          type="button"
          aria-pressed={activeTab === "import"}
          onclick={() => (activeTab = "import")}
        >
          {t("library.tabImport")}
        </button>
        <button
          type="button"
          aria-pressed={activeTab === "tab"}
          onclick={() => (activeTab = "tab")}
        >
          {t("library.tabNewTab")}
        </button>
        <button
          type="button"
          aria-pressed={activeTab === "chord"}
          onclick={() => (activeTab = "chord")}
        >
          {t("library.tabNewChord")}
        </button>
      </div>

      <div class="row" style="align-items:center">
        <label class="field" title={t("settings.defaultInstrumentHint")} style="display:flex;align-items:center;gap:0.5rem">
          <span>{t("settings.defaultInstrument")}</span>
          <select value={defaultInstrument} onchange={(event) => void changeDefault(event.currentTarget.value)}>
            {#each presets as item (item.id)}
              <option value={item.id}>{presetLabel(item)}</option>
            {/each}
          </select>
        </label>
      </div>
    </div>

    <div class="studio-deck-body">
      <p class="hint" style="margin:0 0 0.75rem">{t("settings.defaultInstrumentHint")}</p>
      {#if activeTab === "import"}
        <h2 class="section-title">{t("library.importHeading")}</h2>
        <div class="import-grid">
          <div class="import-box">
            <div class="stack" style="gap:0.6rem">
              <label class="field">
                {t("library.url")}
                <input
                  bind:value={url}
                  placeholder={t("library.urlHint")}
                  onkeydown={(event) => {
                    if (event.key === "Enter") void submitUrl();
                  }}
                />
              </label>
              <div class="row" style="justify-content:space-between">
                <label class="field" style="flex:1;min-width:140px">
                  {t("library.videoId")}
                  <input bind:value={videoId} maxlength="11" />
                </label>
                <button class="primary" disabled={Boolean(busy) || !url.trim()} onclick={() => void submitUrl()}>
                  {t("library.importUrl")}
                </button>
              </div>
            </div>
          </div>

          <div class="import-box">
            <label class="file-dropzone">
              <span class="dropzone-icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </span>
              <strong style="color:var(--text);font-size:0.92rem">{t("library.dropHint")}</strong>
              <span class="hint">{t("library.file")}</span>
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
          </div>
        </div>
      {:else if activeTab === "tab"}
        <h2 class="section-title">{t("library.createHeading")}</h2>
        <div class="form-grid">
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
            <span class="row" style="flex-wrap:nowrap">
              <input type="number" min="1" max="32" bind:value={numerator} style="width:4.5rem" />
              <select bind:value={denominator} style="width:4.5rem">
                {#each [1, 2, 4, 8, 16, 32] as value (value)}<option {value}>{value}</option>{/each}
              </select>
            </span>
          </label>
        </div>
        <div class="row" style="margin-top:0.85rem">
          <button class="primary" onclick={() => void create()}>{t("library.create")}</button>
        </div>
      {:else}
        <h2 class="section-title">{t("chords.createHeading")}</h2>
        <div class="form-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
          <label class="field">{t("library.title")}<input bind:value={sheetTitle} /></label>
          <label class="field">{t("library.artist")}<input bind:value={sheetArtist} /></label>
        </div>
        <label class="field" style="margin-top:0.65rem">
          {t("chords.paste")}
          <textarea bind:value={sheetText} rows="6" spellcheck="false" placeholder={t("chords.pasteHint")}></textarea>
        </label>
        <div class="row" style="margin-top:0.65rem">
          <button class="primary" disabled={!sheetText.trim()} onclick={() => void createSheet()}>{t("chords.create")}</button>
        </div>
      {/if}

      {#if busy}
        <div class="badge brass" style="margin-top:0.75rem">{busy}</div>
      {/if}

      {#if picker}
        <div class="track-picker">
          <h3 class="section-title">{t("library.pickTracks")}</h3>
          <p class="hint" style="margin-top:0">{t("library.pickTracksHint", { title: picker.title || picker.artist })}</p>
          <div class="stack" style="gap:0.2rem">
            {#each picker.tracks as track (track.part_id)}
              <label class="track-choice">
                <input
                  type="checkbox"
                  checked={selected.includes(track.part_id)}
                  onchange={(event) => togglePart(track.part_id, event.currentTarget.checked)}
                />
                <span>
                  <strong>{track.name || instrumentLabel(track.canonical_instrument || track.instrument)}</strong>
                  · {instrumentLabel(track.canonical_instrument || track.instrument)}
                  · {tuningLabel(track.tuning)}
                  {#if track.capo > 0}· {t("player.capo", { fret: track.capo })}{/if}
                </span>
              </label>
            {/each}
          </div>
          <div class="row" style="margin-top:0.75rem">
            <button
              class="primary"
              disabled={Boolean(busy) || selected.length === 0}
              onclick={() => void startImport(previewUrl, selected)}
            >
              {t("library.importSelected")}
            </button>
            <button type="button" onclick={() => (picker = null)}>{t("library.cancel")}</button>
          </div>
        </div>
      {/if}
    </div>
  </section>

  {#if error}<p class="error">{error}</p>{/if}
  {#if notice}<p class="hint">{notice}</p>{/if}

  <section class="stack" style="gap:0.65rem">
    <div class="library-toolbar">
      <div class="row" style="align-items:center">
        <h2 style="margin:0">{t("library.heading")}</h2>
        {#if songs.length > 0}
          <span class="badge subtle">{visible.length} / {songs.length}</span>
        {/if}
      </div>

      {#if songs.length > 0}
        <div class="search-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            class="search-input"
            type="search"
            bind:value={query}
            placeholder={t("library.searchPlaceholder")}
            aria-label={t("library.searchPlaceholder")}
          />
        </div>
      {/if}
    </div>

    {#if songs.length === 0}
      <div class="panel">
        <p class="hint" style="margin:0">{t("library.empty")}</p>
      </div>
    {:else}
      <div class="filter-row" role="group" aria-label={t("library.filters")}>
        <button type="button" aria-pressed={filter === "all"} onclick={() => (filter = "all")}>{t("library.filterAll")}</button>
        <button type="button" aria-pressed={filter === "bass"} onclick={() => (filter = "bass")}>{t("library.filterBass")}</button>
        <button type="button" aria-pressed={filter === "electric"} onclick={() => (filter = "electric")}>
          {t("library.filterElectric")}
        </button>
        <button type="button" aria-pressed={filter === "acoustic"} onclick={() => (filter = "acoustic")}>
          {t("library.filterAcoustic")}
        </button>
        <button type="button" aria-pressed={filter === "chords"} onclick={() => (filter = "chords")}>
          {t("library.filterChords")}
        </button>
      </div>

      {#if visible.length === 0}
        <div class="panel">
          <p class="hint" style="margin:0">{t("library.filterEmpty")}</p>
        </div>
      {:else}
        <div class="song-list">
          {#each visible as song (song.id)}
            {@const instFam = song.content_kind === "chords" ? "chords" : instrumentFamily(song.preferred_instrument)}
            <article class="song">
              <div class="song-top">
                <div class="song-icon-tile {instFam}" aria-hidden="true">
                  {#if song.content_kind === "chords"}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="8" y1="13" x2="16" y2="13" />
                      <line x1="8" y1="17" x2="13" y2="17" />
                    </svg>
                  {:else}
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9 18V5l12-2v13" />
                      <circle cx="6" cy="18" r="3" />
                      <circle cx="18" cy="16" r="3" />
                    </svg>
                  {/if}
                </div>

                <div class="song-main">
                  <a
                    class="song-title-link"
                    tabindex="-1"
                    href={hrefFor(`/songs/${song.id}`)}
                    onclick={(event) => followLink(event, `/songs/${song.id}`)}
                  >
                    <h3>{song.title}</h3>
                  </a>
                  {#if song.artist}
                    <div class="song-artist">{song.artist}</div>
                  {/if}
                  <div class="meta">
                    {#if song.content_kind === "chords"}
                      <span class="badge violet">{t("library.chordSheet")}</span>
                    {:else}
                      <span class="badge">{instrumentLabel(song.preferred_instrument)}</span>
                      <span class="badge subtle">{t("library.strings", { count: song.string_count })}</span>
                      <span class="badge subtle">{t("library.measures", { count: song.measure_count })}</span>
                      <span class="badge subtle">{t("library.tempo", { bpm: song.bpm })}</span>
                      <span class="badge {song.has_audio ? 'emerald' : 'subtle'}">
                        {song.has_audio ? t("library.audio") : t("library.noAudio")}
                      </span>
                    {/if}
                  </div>
                </div>
              </div>

              <div class="song-footer">
                <div class="actions">
                  <a
                    class="button primary sm"
                    href={hrefFor(`/songs/${song.id}`)}
                    onclick={(event) => followLink(event, `/songs/${song.id}`)}
                  >
                    {t("library.open")}
                  </a>
                  <a
                    class="button sm"
                    href={hrefFor(`/songs/${song.id}/edit`)}
                    onclick={(event) => followLink(event, `/songs/${song.id}/edit`)}
                  >
                    {t("library.edit")}
                  </a>
                </div>
                <button class="sm ghost danger-btn" onclick={() => void remove(song)}>
                  {t("library.delete")}
                </button>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    {/if}
  </section>
</div>
