<script lang="ts">
  import ChordSheet from "./ChordSheet.svelte";
  import Icon from "./Icon.svelte";
  import MidiImport from "./MidiImport.svelte";
  import TranscribeImport from "./TranscribeImport.svelte";
  import Sheet from "./Sheet.svelte";
  import TabPreview from "./TabPreview.svelte";
  import UniversalAdd, { type AddInput } from "./UniversalAdd.svelte";
  import { extractDroppedFiles, processBulkImport } from "../lib/bulkImport";
  import {
    ApiError,
    createChordSheet,
    createTab,
    importAsciiTab,
    importAuto,
    importDocument,
    importFile,
    importMidi,
    importTranscribe,
    importUrl,
    inspectMidi,
    previewAsciiTab,
    previewImport,
    waitForJob,
  } from "../lib/api";
  import { asciiTabBody, debounced, DEFAULT_GRID, type Grid } from "../lib/asciiTab";
  import { documentFromGuitarPro } from "../lib/alphatab/importScore";
  import { isAudioFile } from "../lib/audioFile";
  import { isMidiFile, type MidiImportOptions } from "../lib/midiImport";
  import { isGuitarProFile } from "../lib/sniff";
  import { keyed, t, tOr } from "../lib/i18n.svelte";
  import { instrumentLabel } from "../lib/instruments";
  import { rememberLessonSong, withLesson } from "../lib/lessonRun";
  import { navigate } from "../lib/router.svelte";
  import { tuningLabel } from "../lib/tuning";
  import type { MidiInspection } from "../lib/api-types";
  import type {
    AsciiTabPreview,
    DuplicateAction,
    ImportPreview,
    InstrumentPreset,
    Job,
  } from "../lib/types";
  import { closeSheet, defaultFamily, refreshSongs, ui } from "../lib/ui.svelte";

  type Mode = "any" | "link" | "file" | "paste" | "tab" | "chords";

  let mode = $state<Mode>("any");
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
  let midi = $state<{ file: File; info: MidiInspection } | null>(null);
  let audio = $state<File | null>(null);
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
  let duplicates = $state<DuplicateAction>("skip");

  const open = $derived(ui.sheet === "add");
  const chosenPreset = $derived(preset || ui.defaultInstrument);

  const moreWays: { id: Mode; icon: string; label: string; hint: string }[] = $derived([
    { id: "link", icon: "link", label: t("add.link"), hint: t("add.linkHint") },
    { id: "file", icon: "upload", label: t("add.file"), hint: t("add.fileHint") },
    { id: "paste", icon: "file", label: t("asciiTab.mode"), hint: t("asciiTab.modeHint") },
  ]);

  const gridOptions: { value: Grid; label: string }[] = $derived([
    { value: 4, label: t("asciiTab.grid4") },
    { value: 8, label: t("asciiTab.grid8") },
    { value: 16, label: t("asciiTab.grid16") },
    { value: 32, label: t("asciiTab.grid32") },
  ]);

  function choose(next: Mode) {
    mode = next;
    error = "";
    notice = "";
  }

  function message(err: unknown): string {
    if (err instanceof ApiError || err instanceof Error) return err.message;
    return t("error.generic");
  }

  function finish(path: string) {
    const lesson = ui.addForLesson;
    void refreshSongs();
    closeSheet();
    const target = lesson ? withLesson(path, lesson) : path;
    if (lesson && target !== path) {
      rememberLessonSong(ui.me?.user_id, lesson, path.slice("/songs/".length));
    }
    navigate(target);
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
        library: ui.libraryId || undefined,
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
        library: ui.libraryId || undefined,
      });
      sheetTitle = "";
      sheetArtist = "";
      sheetText = "";
      ui.addForLesson = null;
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
    if (job.result?.skipped) return;
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

  async function submitFile(file: File, onDuplicate: DuplicateAction) {
    error = "";
    notice = "";
    busy = t("library.importing");
    try {
      if (/\.(gp|gp3|gp4|gp5|gpx)$/i.test(file.name) || (await isGuitarProFile(file))) {
        const parsed = documentFromGuitarPro(
          new Uint8Array(await file.arrayBuffer()),
          defaultFamily(),
        );
        const saved = await importDocument({
          title: parsed.title,
          artist: parsed.artist,
          source_kind: "guitarpro",
          document: parsed.document,
          on_duplicate: onDuplicate,
        });
        if (onDuplicate === "skip" && ui.songs.some((song) => song.id === saved.id)) {
          notice = t("import.skippedDuplicate", { title: saved.title });
          return;
        }
        finish(`/songs/${saved.id}`);
        return;
      }
      const started = await importFile(file, onDuplicate);
      await runJob(started.job_id);
    } catch (err) {
      error = message(err);
    } finally {
      busy = "";
    }
  }

  /** The Add box: Guitar Pro is read here; everything else is sent for the server to identify. */
  async function submitAny(input: AddInput) {
    if ("files" in input) {
      closeSheet();
      await processBulkImport({
        files: input.files,
        duplicates: input.duplicates ?? duplicates,
        tags: input.tags,
        family: defaultFamily(),
      });
      return;
    }
    if ("file" in input && (await isGuitarProFile(input.file))) {
      await submitFile(input.file, input.duplicates ?? duplicates);
      return;
    }
    if ("file" in input && (await isMidiFile(input.file))) {
      await openMidi(input.file);
      return;
    }
    if ("file" in input && isAudioFile(input.file)) {
      audio = input.file;
      error = "";
      notice = "";
      return;
    }
    // A Songsterr link may have several tracks; the link form asks which ones.
    if ("url" in input && songsterrUrl.test(input.url)) {
      mode = "link";
      url = input.url;
      await submitUrl();
      return;
    }
    error = "";
    notice = "";
    busy = t("library.importing");
    try {
      const started = await importAuto({ ...input, on_duplicate: duplicates });
      await runJob(started.job_id);
    } catch (err) {
      error = message(err);
    } finally {
      busy = "";
    }
  }

  /** A MIDI file has no strings, so the reader picks its parts and instruments before it is imported. */
  async function openMidi(file: File) {
    error = "";
    notice = "";
    busy = t("library.importing");
    try {
      midi = { file, info: await inspectMidi(file) };
    } catch (err) {
      error = message(err);
    } finally {
      busy = "";
    }
  }

  async function startMidi(options: MidiImportOptions) {
    if (!midi) return;
    error = "";
    notice = "";
    busy = t("library.importing");
    try {
      const started = await importMidi(midi.file, options);
      await runJob(started.job_id);
      midi = null;
    } catch (err) {
      error = message(err);
    } finally {
      busy = "";
    }
  }

  async function startTranscribe(options: {
    stem: "mix" | "bass" | "guitar";
    preset: string;
    grid: number;
  }) {
    if (!audio) return;
    error = "";
    notice = "";
    busy = t("transcribe.queued");
    try {
      const started = await importTranscribe(audio, options);
      await runJob(started.job_id);
      audio = null;
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
  <div class="sheet-section">
    {#if mode !== "any"}
      <button
        class="ghost add-back"
        type="button"
        data-testid="add-back"
        onclick={() => choose("any")}
      >
        <Icon name="back" size={18} />{t("add.back")}
      </button>
    {/if}
    {#if mode === "any"}
      {#if audio}
        <TranscribeImport
          file={audio}
          presets={ui.presets}
          defaultPreset={chosenPreset}
          busy={Boolean(busy)}
          onimport={(options) => void startTranscribe(options)}
          oncancel={() => (audio = null)}
        />
      {:else if midi}
        <MidiImport
          info={midi.info}
          presets={ui.presets}
          busy={Boolean(busy)}
          onimport={(options) => void startMidi(options)}
          oncancel={() => (midi = null)}
        />
      {:else}
        <UniversalAdd busy={Boolean(busy)} {duplicates} onadd={(input) => void submitAny(input)} />
        <div class="add-quick">
          <button
            class="add-quick-button"
            type="button"
            data-testid="add-mode-tab"
            onclick={() => choose("tab")}
          >
            <Icon name="tab" size={18} />{t("add.tab")}
          </button>
          <button
            class="add-quick-button"
            type="button"
            data-testid="add-mode-chords"
            onclick={() => choose("chords")}
          >
            <Icon name="chords" size={18} />{t("add.chords")}
          </button>
        </div>
        <details class="add-more" data-testid="add-more">
          <summary data-testid="add-more-toggle">{t("add.more")}</summary>
          <div class="add-more-list">
            {#each moreWays as item (item.id)}
              <button
                class="add-more-item"
                type="button"
                data-testid={`add-mode-${item.id}`}
                onclick={() => choose(item.id)}
              >
                <Icon name={item.icon} size={18} />
                <span><strong>{item.label}</strong><small>{item.hint}</small></span>
              </button>
            {/each}
            <label class="add-more-item">
              <Icon name="listMusic" size={18} />
              <span><strong>{t("add.midi")}</strong><small>{t("add.midiHint")}</small></span>
              <input
                class="visually-hidden"
                data-testid="add-midi-input"
                type="file"
                accept=".mid,.midi"
                disabled={Boolean(busy)}
                onchange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void openMidi(file);
                }}
              />
            </label>
            <label class="add-more-item">
              <Icon name="sparkle" size={18} />
              <span><strong>{t("add.audio")}</strong><small>{t("add.audioHint")}</small></span>
              <input
                class="visually-hidden"
                data-testid="add-audio-input"
                type="file"
                accept="audio/*,.mp3,.wav,.flac,.ogg,.opus,.m4a,.aac"
                disabled={Boolean(busy)}
                onchange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) audio = file;
                }}
              />
            </label>
            <fieldset class="duplicate-bar">
              <legend>{t("bulk.duplicates")}</legend>
              <label class="radio-label">
                <input type="radio" bind:group={duplicates} value="skip" data-testid="dup-skip" />
                <span>{t("bulk.skip")}</span>
              </label>
              <label class="radio-label">
                <input
                  type="radio"
                  bind:group={duplicates}
                  value="keep_both"
                  data-testid="dup-keep"
                />
                <span>{t("bulk.keepBoth")}</span>
              </label>
              <label class="radio-label">
                <input
                  type="radio"
                  bind:group={duplicates}
                  value="replace"
                  data-testid="dup-replace"
                />
                <span>{t("bulk.replace")}</span>
              </label>
            </fieldset>
          </div>
        </details>
      {/if}
    {:else if mode === "link"}
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
        ondrop={async (event) => {
          event.preventDefault();
          dragging = false;
          if (busy || !event.dataTransfer) return;
          const files = await extractDroppedFiles(event.dataTransfer);
          if (files.length === 0) return;
          if (files.length > 1 || files[0].name.toLowerCase().endsWith(".zip")) {
            closeSheet();
            void processBulkImport({ files, family: defaultFamily() });
          } else {
            void submitFile(files[0], duplicates);
          }
        }}
      >
        <span class="dropzone-icon"><Icon name="upload" size={28} /></span>
        <strong>{t("add.dropTitle")}</strong>
        <small class="muted">{t("bulk.dropHint")}</small>
        <span class="button">{t("add.browse")}</span>
        <input
          class="visually-hidden"
          data-testid="add-file-input"
          type="file"
          multiple
          disabled={Boolean(busy)}
          accept=".musicxml,.xml,.json,.gp,.gp3,.gp4,.gp5,.gpx,.ptb,.tg,.mscz,.mscx,.abc,.mid,.midi,.cho,.chordpro,.chopro,.crd,.txt,.tab,.zip,.pdf,.png,.jpg,.jpeg,.tif,.tiff,.bmp,.gif"
          onchange={(event) => {
            const fileList = event.currentTarget.files;
            if (!fileList || fileList.length === 0) return;
            const files = Array.from(fileList);
            event.currentTarget.value = "";
            if (files.length > 1 || files[0].name.toLowerCase().endsWith(".zip")) {
              closeSheet();
              void processBulkImport({ files, family: defaultFamily() });
            } else {
              void submitFile(files[0], duplicates);
            }
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
    {#if notice}<p class="notice" data-testid="add-notice">{notice}</p>{/if}
  </div>
</Sheet>

{#if busy && !open}
  <div class="toast" role="status"><span class="spinner"></span>{busy}</div>
{/if}

<style>
  .add-quick {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--s-2, 0.5rem);
    margin-top: var(--s-3, 0.75rem);
  }

  .add-quick-button {
    justify-content: center;
  }

  .add-back {
    margin-bottom: var(--s-3, 0.75rem);
  }

  .add-more {
    margin-top: var(--s-3, 0.75rem);
  }

  .add-more summary {
    cursor: pointer;
    color: var(--text-2);
    font-weight: 600;
    min-height: 44px;
    display: flex;
    align-items: center;
  }

  .add-more-list {
    display: grid;
    gap: var(--s-2, 0.5rem);
  }

  .add-more-item {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.75rem;
    min-height: 48px;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface-2);
    text-align: left;
    cursor: pointer;
  }

  .add-more-item span {
    display: grid;
    min-width: 0;
  }

  .add-more-item small {
    color: var(--text-2);
  }

  .duplicate-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface-2);
    font-size: 0.875rem;
  }

  .duplicate-bar legend {
    padding: 0 0.25rem;
    color: var(--muted);
    font-weight: 500;
  }

  .radio-label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    cursor: pointer;
  }
</style>
