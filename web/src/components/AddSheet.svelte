<script lang="ts">
  import ChordSheet from "./ChordSheet.svelte";
  import Icon from "./Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import TabPreview from "./TabPreview.svelte";
  import {
    ApiError,
    createChordSheet,
    createTab,
    importAsciiTab,
    importDocument,
    importFile,
    importUrl,
    previewAsciiTab,
    previewImport,
    waitForJob,
  } from "../lib/api";
  import { asciiTabBody, debounced, DEFAULT_GRID, type Grid } from "../lib/asciiTab";
  import { documentFromGuitarPro } from "../lib/alphatab/importScore";
  import { keyed, t, tOr } from "../lib/i18n.svelte";
  import { instrumentLabel } from "../lib/instruments";
  import { navigate } from "../lib/router.svelte";
  import { tuningLabel } from "../lib/tuning";
  import type { AsciiTabPreview, ImportPreview, InstrumentPreset, Job } from "../lib/types";
  import { closeSheet, defaultFamily, refreshSongs, ui } from "../lib/ui.svelte";

  type Mode = "link" | "file" | "paste" | "tab" | "chords";

  let mode = $state<Mode>("link");
  let error = $state("");
  let notice = $state("");
  let busy = $state("");
  let title = $state("");
  let artist = $state("");
  let preset = $state("");
  let bpm = $state(120);
  let measures = $state(4);
  let numerator = $state(4);
  let denominator = $state(4);
  let url = $state("");
  let videoId = $state("");
  let sheetTitle = $state("");
  let sheetArtist = $state("");
  let sheetText = $state("");
  let picker = $state<ImportPreview | null>(null);
  let previewUrl = $state("");
  let selected = $state<number[]>([]);
  let dragging = $state(false);
  let pasteText = $state("");
  let pasteTitle = $state("");
  let pasteArtist = $state("");
  let pasteGrid = $state<Grid>(DEFAULT_GRID);
  let pasteBpm = $state<number | null>(null);
  let pasteNumerator = $state(4);
  let pasteDenominator = $state(4);
  let pastePreview = $state<AsciiTabPreview | null>(null);
  let pasteBusy = $state(false);
  let pasteError = $state("");

  const open = $derived(ui.sheet === "add");
  const chosenPreset = $derived(preset || ui.defaultInstrument);

  const modes: { id: Mode; icon: string; label: string; hint: string }[] = $derived([
    { id: "link", icon: "link", label: t("add.link"), hint: t("add.linkHint") },
    { id: "file", icon: "upload", label: t("add.file"), hint: t("add.fileHint") },
    { id: "paste", icon: "file", label: t("asciiTab.mode"), hint: t("asciiTab.modeHint") },
    { id: "tab", icon: "tab", label: t("add.tab"), hint: t("add.tabHint") },
    { id: "chords", icon: "chords", label: t("add.chords"), hint: t("add.chordsHint") },
  ]);

  const gridOptions: { value: Grid; label: string }[] = $derived([
    { value: 4, label: t("asciiTab.grid4") },
    { value: 8, label: t("asciiTab.grid8") },
    { value: 16, label: t("asciiTab.grid16") },
    { value: 32, label: t("asciiTab.grid32") },
  ]);

  function message(err: unknown): string {
    if (err instanceof ApiError || err instanceof Error) return err.message;
    return t("error.generic");
  }

  function finish(path: string) {
    void refreshSongs();
    closeSheet();
    navigate(path);
  }

  async function create() {
    error = "";
    try {
      const song = await createTab({
        title: title.trim() || t("library.untitled"),
        artist: artist.trim(),
        preset: chosenPreset,
        bpm,
        measures,
        signature: [numerator, denominator],
      });
      title = "";
      artist = "";
      finish(`/songs/${song.id}/edit`);
    } catch (err) {
      error = message(err);
    }
  }

  async function createSheet() {
    error = "";
    try {
      const song = await createChordSheet({
        title: sheetTitle.trim(),
        artist: sheetArtist.trim(),
        chordpro: sheetText,
      });
      sheetTitle = "";
      sheetArtist = "";
      sheetText = "";
      finish(`/songs/${song.id}`);
    } catch (err) {
      error = message(err);
    }
  }

  const pasteBody = $derived(
    asciiTabBody({
      text: pasteText,
      title: pasteTitle,
      artist: pasteArtist,
      grid: pasteGrid,
      bpm: pasteBpm,
      numerator: pasteNumerator,
      denominator: pasteDenominator,
    }),
  );

  // Convert the pasted text a moment after typing stops, so the preview follows the box.
  $effect(() => {
    const body = mode === "paste" && open ? pasteBody : null;
    if (!body) {
      pastePreview = null;
      pasteError = "";
      pasteBusy = false;
      return;
    }
    const controller = new AbortController();
    const delayed = debounced(async () => {
      pasteBusy = true;
      try {
        const converted = await previewAsciiTab(body, controller.signal);
        pastePreview = converted;
        pasteError = "";
      } catch (err) {
        if (controller.signal.aborted) return;
        pastePreview = null;
        pasteError = message(err);
      } finally {
        if (!controller.signal.aborted) pasteBusy = false;
      }
    }, 400);
    delayed.call();
    return () => {
      delayed.cancel();
      controller.abort();
    };
  });

  async function createFromPaste() {
    const body = pasteBody;
    if (!body) return;
    error = "";
    busy = t("library.importing");
    try {
      const song = await importAsciiTab(body);
      pasteText = "";
      pasteTitle = "";
      pasteArtist = "";
      finish(`/songs/${song.id}`);
    } catch (err) {
      error = message(err);
    } finally {
      busy = "";
    }
  }

  function pasteWarnings(converted: AsciiTabPreview): string {
    return converted.warnings
      .filter((item) => item.key !== "import.rhythmEstimated")
      .map((item) => keyed(item))
      .join(" ");
  }

  function progress(job: Job) {
    busy = tOr(job.progress_key, job.progress || t("library.importing"));
  }

  async function runJob(jobId: string) {
    const job = await waitForJob(jobId, progress);
    if (job.status === "error") {
      throw new Error(
        keyed({ key: job.error_key, message: job.error ?? "", params: job.error_params }),
      );
    }
    const warnings = job.result?.warnings ?? [];
    if (warnings.length)
      notice = t("library.warnings", { warnings: warnings.map((item) => keyed(item)).join(" ") });
    if (job.result?.song_id) {
      url = "";
      videoId = "";
      finish(`/songs/${job.result.song_id}`);
    }
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
    const family = defaultFamily();
    const matching = preview.tracks.filter(
      (track) => (track.is_bass ? "bass" : "guitar") === family,
    );
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
        const parsed = documentFromGuitarPro(
          new Uint8Array(await file.arrayBuffer()),
          defaultFamily(),
        );
        const saved = await importDocument({
          title: parsed.title,
          artist: parsed.artist,
          source_kind: "guitarpro",
          document: parsed.document,
        });
        finish(`/songs/${saved.id}`);
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

  function presetLabel(item: InstrumentPreset): string {
    return tOr(item.label_key, item.label);
  }
</script>

<Sheet
  {open}
  title={t("add.heading")}
  subtitle={t("add.subtitle")}
  testid="add-sheet"
  onclose={closeSheet}
>
  <div class="mode-grid" role="tablist" aria-label={t("add.heading")}>
    {#each modes as item (item.id)}
      <button
        class="mode-card"
        data-testid={`add-mode-${item.id}`}
        role="tab"
        aria-selected={mode === item.id}
        onclick={() => {
          mode = item.id;
          error = "";
        }}
      >
        <span class="mode-icon"><Icon name={item.icon} /></span>
        <span class="mode-text">
          <strong>{item.label}</strong>
          <small>{item.hint}</small>
        </span>
      </button>
    {/each}
  </div>

  <div class="sheet-section">
    {#if mode === "link"}
      <form
        class="form-grid"
        onsubmit={(event) => {
          event.preventDefault();
          void submitUrl();
        }}
      >
        <label class="field span-2">
          <span>{t("library.url")}</span>
          <span class="input-icon">
            <Icon name="link" size={18} />
            <input
              data-testid="add-url"
              bind:value={url}
              placeholder={t("library.urlHint")}
              inputmode="url"
              autocomplete="off"
            />
          </span>
        </label>
        <label class="field">
          <span>{t("library.videoId")}</span>
          <input bind:value={videoId} maxlength="11" autocomplete="off" />
        </label>
        <div class="field field-action">
          <button class="primary" type="submit" disabled={Boolean(busy) || !url.trim()}>
            <Icon name="download" size={18} />{t("library.importUrl")}
          </button>
        </div>
      </form>
      {#if picker}
        <div class="track-picker">
          <h3>{t("library.pickTracks")}</h3>
          <p class="muted">
            {t("library.pickTracksHint", { title: picker.title || picker.artist })}
          </p>
          <div class="choice-list">
            {#each picker.tracks as track (track.part_id)}
              <label class="choice">
                <input
                  type="checkbox"
                  checked={selected.includes(track.part_id)}
                  onchange={(event) => togglePart(track.part_id, event.currentTarget.checked)}
                />
                <span class="choice-text">
                  <strong
                    >{track.name ||
                      instrumentLabel(track.canonical_instrument || track.instrument)}</strong
                  >
                  <small>
                    {instrumentLabel(track.canonical_instrument || track.instrument)}
                    · {tuningLabel(track.tuning)}
                    {#if track.capo > 0}· {t("player.capo", { fret: track.capo })}{/if}
                  </small>
                </span>
              </label>
            {/each}
          </div>
          <div class="row">
            <button
              class="primary"
              disabled={Boolean(busy) || selected.length === 0}
              onclick={() => void startImport(previewUrl, selected)}
            >
              {t("library.importSelected")}
            </button>
            <button class="ghost" type="button" onclick={() => (picker = null)}
              >{t("library.cancel")}</button
            >
          </div>
        </div>
      {/if}
    {:else if mode === "file"}
      <label
        class="dropzone"
        class:dragging
        ondragover={(event) => {
          event.preventDefault();
          dragging = true;
        }}
        ondragleave={() => (dragging = false)}
        ondrop={(event) => {
          event.preventDefault();
          dragging = false;
          const file = event.dataTransfer?.files?.[0];
          if (file && !busy) void submitFile(file);
        }}
      >
        <span class="dropzone-icon"><Icon name="upload" size={28} /></span>
        <strong>{t("add.dropTitle")}</strong>
        <small class="muted">{t("library.file")}</small>
        <span class="button">{t("add.browse")}</span>
        <input
          class="visually-hidden"
          data-testid="add-file-input"
          type="file"
          disabled={Boolean(busy)}
          accept=".musicxml,.xml,.json,.gp,.gp3,.gp4,.gp5,.gpx,.cho,.chordpro,.chopro,.crd,.txt,.tab"
          onchange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void submitFile(file);
          }}
        />
      </label>
    {:else if mode === "paste"}
      <form
        class="form-grid"
        onsubmit={(event) => {
          event.preventDefault();
          void createFromPaste();
        }}
      >
        <label class="field">
          <span>{t("library.title")}</span>
          <input
            data-testid="paste-title"
            bind:value={pasteTitle}
            placeholder={pastePreview?.title || t("library.untitled")}
          />
        </label>
        <label class="field">
          <span>{t("library.artist")}</span>
          <input bind:value={pasteArtist} placeholder={pastePreview?.artist ?? ""} />
        </label>
        <label class="field span-2">
          <span>{t("asciiTab.paste")}</span>
          <textarea
            data-testid="paste-text"
            bind:value={pasteText}
            rows="9"
            spellcheck="false"
            placeholder={t("asciiTab.pasteHint")}></textarea>
        </label>
        <label class="field">
          <span>{t("asciiTab.grid")}</span>
          <select data-testid="paste-grid" bind:value={pasteGrid}>
            {#each gridOptions as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>{t("asciiTab.bpm")}</span>
          <input
            data-testid="paste-bpm"
            type="number"
            min="1"
            max="399"
            placeholder={t("asciiTab.bpmAuto")}
            bind:value={pasteBpm}
          />
        </label>
        <div class="field span-2">
          <span>{t("library.signature")}</span>
          <span class="signature">
            <input
              type="number"
              min="1"
              max="32"
              bind:value={pasteNumerator}
              aria-label={t("ui.beatsPerBar")}
            />
            <span class="signature-slash">/</span>
            <select bind:value={pasteDenominator} aria-label={t("ui.beatUnit")}>
              {#each [1, 2, 4, 8, 16, 32] as value (value)}<option {value}>{value}</option>{/each}
            </select>
          </span>
        </div>
        <div class="span-2 paste-preview" data-testid="paste-preview" aria-live="polite">
          <h3>{t("asciiTab.preview")}</h3>
          {#if pasteError}
            <p class="alert" role="alert" data-testid="paste-error">
              <Icon name="alert" size={18} />{pasteError}
            </p>
          {:else if pasteBusy && !pastePreview}
            <p class="muted"><span class="spinner"></span>{t("asciiTab.previewLoading")}</p>
          {:else if !pastePreview}
            <p class="muted">{t("asciiTab.previewEmpty")}</p>
          {:else if pastePreview.content_kind === "chords"}
            <p class="notice" data-testid="paste-chords-note">{t("asciiTab.chordsDetected")}</p>
            <ChordSheet text={pastePreview.chordpro ?? ""} />
          {:else if pastePreview.document}
            <p class="notice" data-testid="rhythm-estimated">
              <strong>{t("asciiTab.rhythmEstimated")}.</strong>
              {t("asciiTab.rhythmEstimatedHint")}
              {pasteWarnings(pastePreview)}
            </p>
            <TabPreview
              score={pastePreview.document}
              title={pasteTitle.trim() || pastePreview.title}
            />
          {/if}
        </div>
        <div class="span-2 form-actions">
          <button
            class="primary"
            type="submit"
            data-testid="paste-submit"
            disabled={Boolean(busy) || !pasteBody}
            ><Icon name="check" size={18} />{t("asciiTab.create")}</button
          >
        </div>
      </form>
    {:else if mode === "tab"}
      <form
        class="form-grid"
        onsubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label class="field span-2"
          ><span>{t("library.title")}</span><input
            data-testid="add-tab-title"
            bind:value={title}
            placeholder={t("library.untitled")}
          /></label
        >
        <label class="field span-2"
          ><span>{t("library.artist")}</span><input bind:value={artist} /></label
        >
        <label class="field span-2">
          <span>{t("library.preset")}</span>
          <select value={chosenPreset} onchange={(event) => (preset = event.currentTarget.value)}>
            {#each ui.presets as item (item.id)}
              <option value={item.id}>{presetLabel(item)}</option>
            {/each}
          </select>
        </label>
        <label class="field"
          ><span>{t("library.bpm")}</span><input
            type="number"
            min="1"
            max="399"
            bind:value={bpm}
          /></label
        >
        <label class="field"
          ><span>{t("library.measureCount")}</span><input
            type="number"
            min="1"
            max="500"
            bind:value={measures}
          /></label
        >
        <div class="field span-2">
          <span>{t("library.signature")}</span>
          <span class="signature">
            <input
              type="number"
              min="1"
              max="32"
              bind:value={numerator}
              aria-label={t("ui.beatsPerBar")}
            />
            <span class="signature-slash">/</span>
            <select bind:value={denominator} aria-label={t("ui.beatUnit")}>
              {#each [1, 2, 4, 8, 16, 32] as value (value)}<option {value}>{value}</option>{/each}
            </select>
          </span>
        </div>
        <div class="span-2 form-actions">
          <button class="primary" type="submit" data-testid="add-tab-submit"
            ><Icon name="sparkle" size={18} />{t("library.create")}</button
          >
        </div>
      </form>
    {:else}
      <form
        class="form-grid"
        onsubmit={(event) => {
          event.preventDefault();
          void createSheet();
        }}
      >
        <label class="field"
          ><span>{t("library.title")}</span><input
            data-testid="add-sheet-title"
            bind:value={sheetTitle}
          /></label
        >
        <label class="field"
          ><span>{t("library.artist")}</span><input bind:value={sheetArtist} /></label
        >
        <label class="field span-2">
          <span>{t("chords.paste")}</span>
          <textarea
            data-testid="add-sheet-text"
            bind:value={sheetText}
            rows="9"
            spellcheck="false"
            placeholder={t("chords.pasteHint")}></textarea>
        </label>
        <div class="span-2 form-actions">
          <button
            class="primary"
            type="submit"
            data-testid="add-sheet-submit"
            disabled={!sheetText.trim()}><Icon name="check" size={18} />{t("chords.create")}</button
          >
        </div>
      </form>
    {/if}

    {#if busy}
      <div class="progress-note" role="status"><span class="spinner"></span>{busy}</div>
    {/if}
    {#if error}<p class="alert" role="alert" data-testid="add-error">
        <Icon name="alert" size={18} />{error}
      </p>{/if}
    {#if notice}<p class="notice">{notice}</p>{/if}
  </div>
</Sheet>

{#if busy && !open}
  <div class="toast" role="status"><span class="spinner"></span>{busy}</div>
{/if}
