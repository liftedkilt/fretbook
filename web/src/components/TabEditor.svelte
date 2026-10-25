<script lang="ts">
  import { untrack } from "svelte";

  import Icon from "./Icon.svelte";
  import EditorHeader from "./EditorHeader.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import OverflowMenu, { type OverflowItem } from "./ui/OverflowMenu.svelte";
  import SegmentedControl from "./ui/SegmentedControl.svelte";
  import { ApiError, getSong, updateSong } from "../lib/api";
  import { contentKey, mergeOnto, type EditBase } from "../lib/offline/merge";
  import { barTicks, EDITOR_DURATIONS } from "../lib/durations";
  import { t, tOr } from "../lib/i18n.svelte";
  import BarRepeats from "./BarRepeats.svelte";
  import { remapSync } from "../lib/sync";
  import { midiToName } from "../lib/tuning";
  import type {
    Bar,
    Beat,
    GraceKind,
    HarmonicKind,
    InstrumentPreset,
    Note,
    ScoreDocument,
    SlideKind,
    SyncMap,
    TabSong,
    Track,
    TrackBar,
  } from "../lib/types";

  const DURATION_ICON: Record<string, string> = {
    whole: "noteWhole",
    dottedHalf: "noteDottedHalf",
    half: "noteHalf",
    dottedQuarter: "noteDottedQuarter",
    quarter: "noteQuarter",
    quarterTriplet: "noteQuarterTriplet",
    dottedEighth: "noteDottedEighth",
    eighth: "noteEighth",
    eighthTriplet: "noteEighthTriplet",
    sixteenth: "noteSixteenth",
    sixteenthTriplet: "noteSixteenthTriplet",
    thirtySecond: "noteThirtySecond",
  };

  let {
    song: initial,
    presets,
    defaultPreset,
  }: { song: TabSong; presets: InstrumentPreset[]; defaultPreset: string } = $props();

  let song = $state<TabSong>(untrack(() => structuredClone($state.snapshot(initial)) as TabSong));
  let error = $state("");
  let conflict = $state(false);
  let status = $state("");
  let trackId = $state(untrack(() => initial.preferred_track_id || initial.document.tracks[0].id));
  let barIndex = $state(0);
  let voiceIndex = $state(0);
  let newPreset = $state(untrack(() => defaultPreset));

  // What the editor loaded: the content to compare against on a conflict, the sync map to re-key, and the bar origins.
  let loadedContent = untrack(() => contentKey(initial.document));
  let loadedBpm = untrack(() => initial.document.bpm);
  let savedTitle = $state(untrack(() => initial.title));
  let savedArtist = $state(untrack(() => initial.artist));
  let baseSync: SyncMap = untrack(
    () => structuredClone($state.snapshot(initial.document.sync)) as SyncMap,
  );
  // The written bars the sync map is keyed against, to re-key marks when bars or repeats change.
  let baseBars: Bar[] = untrack(
    () => structuredClone($state.snapshot(initial.document.bars)) as Bar[],
  );
  let origin = $state<(number | null)[]>(
    untrack(() => initial.document.bars.map((_, index) => index)),
  );

  const document_ = $derived(song.document);
  const track = $derived(
    document_.tracks.find((item) => item.id === trackId) ?? document_.tracks[0],
  );
  const bar = $derived(document_.bars[Math.min(barIndex, document_.bars.length - 1)]);
  const trackBar = $derived(track.bars[Math.min(barIndex, track.bars.length - 1)]);
  const beats = $derived(trackBar.voices[voiceIndex]?.beats ?? []);
  const used = $derived(beats.reduce((total, beat) => total + (beat.grace ? 0 : beat.duration), 0));
  const length = $derived(barTicks(bar.signature));
  const dirty = $derived(
    song.title !== savedTitle ||
      song.artist !== savedArtist ||
      document_.bpm !== loadedBpm ||
      contentKey(document_) !== loadedContent,
  );

  function reflow(list: Beat[]) {
    let position = 0;
    for (const beat of list) {
      beat.position = position;
      if (!beat.grace) position += beat.duration;
    }
  }

  function voiceBeats(target: TrackBar, index: number): Beat[] {
    while (target.voices.length <= index) target.voices.push({ beats: [] });
    return target.voices[index].beats;
  }

  // --- notes --------------------------------------------------------------

  function noteOn(beat: Beat, stringIndex: number): Note | undefined {
    return beat.notes.find((note) => note.string === stringIndex);
  }

  function setFret(beat: Beat, stringIndex: number, raw: string) {
    const existing = noteOn(beat, stringIndex);
    const others = beat.notes.filter((note) => note.string !== stringIndex);
    const trimmed = raw.trim();
    const fret = Number(trimmed);
    if (trimmed !== "" && Number.isInteger(fret) && fret >= 0 && fret <= 99) {
      others.push({ ...(existing ?? { extras: {} }), string: stringIndex, fret });
    }
    beat.notes = others.sort((left, right) => left.string - right.string);
  }

  function toggle(
    note: Note,
    flag: "dead" | "tie" | "ghost" | "hammer" | "vibrato" | "palm_mute" | "let_ring" | "staccato",
  ) {
    note[flag] = !note[flag];
  }

  // --- beats --------------------------------------------------------------

  function durationValue(beat: Beat): string {
    return `${beat.duration}:${beat.tuplet ?? ""}`;
  }

  function setDuration(beat: Beat, raw: string) {
    const [ticks, tuplet] = raw.split(":");
    beat.duration = Number(ticks);
    beat.tuplet = tuplet ? Number(tuplet) : null;
    reflow(beats);
  }

  function setGrace(beat: Beat, value: string) {
    beat.grace = (value || null) as GraceKind | null;
    reflow(beats);
  }

  function durationOptions(beat: Beat) {
    const current = durationValue(beat);
    const options = EDITOR_DURATIONS.map((option) => ({
      value: `${option.ticks}:${option.tuplet ?? ""}`,
      label: t(`durations.${option.key}`),
      icon: DURATION_ICON[option.key],
      testid: `duration-${option.key}`,
    }));
    if (!options.some((option) => option.value === current)) {
      options.push({
        value: current,
        label: t("durations.other", { ticks: beat.duration }),
        icon: "",
        testid: "duration-other",
      });
    }
    return options;
  }

  function durationLabel(beat: Beat): string {
    const current = durationValue(beat);
    return (
      durationOptions(beat).find((option) => option.value === current)?.label ??
      t("durations.other", { ticks: beat.duration })
    );
  }

  function beatMenu(beat: Beat, index: number): OverflowItem[] {
    const grace = beat.grace ?? "";
    return [
      {
        id: "grace-none",
        label: t("editor.graceNone"),
        active: grace === "",
        onclick: () => setGrace(beat, ""),
      },
      {
        id: "grace-on",
        label: t("editor.graceOnBeat"),
        active: grace === "on_beat",
        onclick: () => setGrace(beat, "on_beat"),
      },
      {
        id: "grace-before",
        label: t("editor.graceBeforeBeat"),
        active: grace === "before_beat",
        onclick: () => setGrace(beat, "before_beat"),
      },
      {
        id: "delete",
        label: t("editor.deleteBeat"),
        danger: true,
        testid: "editor-delete-beat",
        onclick: () => deleteBeat(index),
      },
    ];
  }

  function addBeat() {
    const list = voiceBeats(trackBar, voiceIndex);
    const left = Math.max(0, length - used);
    const fit =
      EDITOR_DURATIONS.find((item) => item.tuplet === null && item.ticks <= left) ??
      EDITOR_DURATIONS[4];
    list.push({ position: 0, duration: fit.ticks, notes: [], extras: {} });
    reflow(list);
  }

  function deleteBeat(index: number) {
    beats.splice(index, 1);
    reflow(beats);
  }

  function moveBeat(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= beats.length) return;
    [beats[index], beats[target]] = [beats[target], beats[index]];
    reflow(beats);
  }

  // --- song-level bars ----------------------------------------------------

  function clone<T>(value: T): T {
    return structuredClone($state.snapshot(value)) as T;
  }

  function insertAt(at: number, copy: boolean) {
    const master = copy
      ? clone(bar)
      : { signature: [bar.signature[0], bar.signature[1]] as [number, number], extras: {} };
    document_.bars.splice(at, 0, master);
    for (const item of document_.tracks) {
      const trackBar = copy ? clone(item.bars[barIndex]) : { voices: [{ beats: [] }], extras: {} };
      item.bars.splice(at, 0, trackBar);
    }
    origin.splice(at, 0, null);
    barIndex = at;
  }

  function insertBefore() {
    insertAt(barIndex, false);
  }

  function insertBar() {
    insertAt(barIndex + 1, false);
  }

  function duplicateBar() {
    insertAt(barIndex + 1, true);
  }

  function deleteBar() {
    if (document_.bars.length <= 1) return;
    const at = barIndex;
    document_.bars.splice(at, 1);
    for (const item of document_.tracks) item.bars.splice(at, 1);
    origin.splice(at, 1);
    barIndex = Math.max(0, Math.min(at, document_.bars.length - 1));
  }

  function setSignature(part: 0 | 1, raw: string) {
    const value = Number(raw);
    if (part === 0 && Number.isInteger(value) && value >= 1 && value <= 32)
      bar.signature[0] = value;
    if (part === 1 && [1, 2, 4, 8, 16, 32].includes(value)) bar.signature[1] = value;
  }

  function setTempo(raw: string) {
    const value = Number(raw);
    bar.tempo = raw.trim() && value > 0 && value < 400 ? value : null;
  }

  // --- tracks -------------------------------------------------------------

  function addString() {
    if (track.tuning_midi.length >= 16) return;
    track.tuning_midi.push((track.tuning_midi.at(-1) ?? 45) - 5);
  }

  function removeString() {
    if (track.tuning_midi.length <= 1) return;
    const index = track.tuning_midi.length - 1;
    const inUse = track.bars.some((item) =>
      item.voices.some((voice) =>
        voice.beats.some((beat) => beat.notes.some((note) => note.string === index)),
      ),
    );
    if (inUse) {
      error = t("editor.stringInUse");
      return;
    }
    error = "";
    track.tuning_midi.pop();
  }

  function addTrack() {
    const preset = presets.find((item) => item.id === newPreset) ?? presets[0];
    if (!preset) return;
    const created: Track = {
      id: `trk_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
      name: preset.name,
      instrument: preset.instrument,
      capo: 0,
      tuning_midi: [...preset.tuning_midi],
      preferred: false,
      bars: document_.bars.map(() => ({ voices: [{ beats: [] }], extras: {} })),
    };
    document_.tracks.push(created);
    trackId = created.id;
    voiceIndex = 0;
  }

  function deleteTrack() {
    if (document_.tracks.length <= 1) return;
    if (!confirm(t("editor.confirmDeleteTrack", { name: track.name }))) return;
    const wasPreferred = track.preferred;
    document_.tracks = document_.tracks.filter((item) => item.id !== track.id);
    if (wasPreferred) document_.tracks[0].preferred = true;
    trackId = document_.tracks[0].id;
  }

  function setPreferred(current: Track) {
    for (const item of document_.tracks) item.preferred = item.id === current.id;
  }

  // --- save ---------------------------------------------------------------

  /** The document as edited, with the sync marks re-keyed to the bars as they are now. */
  function edited(): ScoreDocument {
    return {
      ...$state.snapshot(song.document),
      sync: remapSync(baseSync, origin, baseBars, $state.snapshot(song.document.bars) as Bar[]),
    };
  }

  function send(revision: number, document: ScoreDocument, base: EditBase) {
    return updateSong(
      song.id,
      {
        title: song.title.trim() || t("library.untitled"),
        artist: song.artist.trim(),
        revision,
        document,
      },
      base,
    );
  }

  async function save() {
    status = t("editor.saving");
    error = "";
    conflict = false;
    try {
      let saved;
      const base: EditBase = {
        content: loadedContent,
        bpm: loadedBpm,
        origin: $state.snapshot(origin),
      };
      const document = edited();
      try {
        saved = await send(song.revision, document, base);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 409) throw err;
        // Someone changed the song since it was loaded. If only the sync marks or BPM moved
        // (the player in another tab), keep those and save these edits on top.
        const latest = await getSong(song.id);
        const merged = latest.document && mergeOnto(latest.document, document, base);
        if (!merged) {
          conflict = true;
          throw err;
        }
        saved = await send(latest.revision, merged, base);
      }
      song = saved as TabSong;
      savedTitle = song.title;
      savedArtist = song.artist;
      loadedContent = contentKey(saved.document!);
      loadedBpm = saved.document!.bpm;
      baseSync = structuredClone(saved.document!.sync);
      baseBars = structuredClone(saved.document!.bars);
      origin = song.document.bars.map((_, index) => index);
      status = t("editor.saved");
    } catch (err) {
      status = "";
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }

  async function reload() {
    const latest = (await getSong(song.id)) as TabSong;
    song = latest;
    savedTitle = latest.title;
    savedArtist = latest.artist;
    loadedContent = contentKey(latest.document);
    loadedBpm = latest.document.bpm;
    baseSync = structuredClone(latest.document.sync);
    baseBars = structuredClone(latest.document.bars);
    origin = latest.document.bars.map((_, index) => index);
    barIndex = Math.min(barIndex, latest.document.bars.length - 1);
    conflict = false;
    error = "";
  }
</script>

<div class="editor-page">
  <EditorHeader
    songId={song.id}
    title={song.title}
    {dirty}
    {status}
    playHref={`/songs/${song.id}`}
    onsave={() => void save()}
  />

  {#if error}<p class="alert" role="alert" data-testid="editor-error">
      <Icon name="alert" size={18} />{error}
    </p>{/if}
  {#if conflict}
    <div class="alert alert-action" role="alert">
      <span>{t("editor.conflict")}</span>
      <button onclick={() => void reload()}>{t("editor.reload")}</button>
    </div>
  {/if}

  <div class="editor-layout">
    <aside class="editor-side">
      <section class="card">
        <h2 class="card-title">{t("editor.songCard")}</h2>
        <div class="form-grid">
          <label class="field span-2"
            ><span>{t("library.title")}</span><input
              data-testid="editor-song-title"
              bind:value={song.title}
            /></label
          >
          <label class="field span-2"
            ><span>{t("library.artist")}</span><input bind:value={song.artist} /></label
          >
          <label class="field"
            ><span>{t("library.bpm")}</span><input
              type="number"
              min="1"
              max="399"
              bind:value={song.document.bpm}
            /></label
          >
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">{t("editor.trackCard")}</h2>
        {#if document_.tracks.length > 1}
          <div class="track-tabs" role="tablist" aria-label={t("player.track")}>
            {#each document_.tracks as item (item.id)}
              <button
                role="tab"
                aria-selected={item.id === track.id}
                onclick={() => {
                  trackId = item.id;
                  voiceIndex = 0;
                }}
              >
                {item.name}{#if item.preferred}<span class="dot" aria-hidden="true"></span>{/if}
              </button>
            {/each}
          </div>
        {/if}
        <div class="form-grid">
          <label class="field span-2"
            ><span>{t("editor.trackName")}</span><input bind:value={track.name} /></label
          >
          <label class="field"
            ><span>{t("editor.capo")}</span><input
              type="number"
              min="0"
              max="24"
              bind:value={track.capo}
            /></label
          >
          <label class="switch">
            <input type="checkbox" checked={track.preferred} onchange={() => setPreferred(track)} />
            <span class="switch-track" aria-hidden="true"></span>
            <span>{t("editor.preferred")}</span>
          </label>
        </div>
        <div class="tuning">
          <span class="field-label">{t("editor.tuning")}</span>
          <div class="tuning-strings">
            {#each track.tuning_midi as midi, index (index)}<span class="string-chip"
                >{midiToName(midi)}</span
              >{/each}
          </div>
          <div class="button-row">
            <button class="small-button" onclick={addString}
              ><Icon name="plus" size={16} />{t("editor.addString")}</button
            >
            <button class="small-button" onclick={removeString}
              ><Icon name="minus" size={16} />{t("editor.removeString")}</button
            >
          </div>
        </div>
        <div class="add-track">
          <label class="field">
            <span>{t("library.preset")}</span>
            <select bind:value={newPreset}>
              {#each presets as item (item.id)}
                <option value={item.id}>{tOr(item.label_key, item.label)}</option>
              {/each}
            </select>
          </label>
          <button onclick={addTrack}><Icon name="plus" size={16} />{t("editor.addTrack")}</button>
        </div>
        {#if document_.tracks.length > 1}
          <button class="danger-text small-button" onclick={deleteTrack}
            ><Icon name="trash" size={16} />{t("editor.deleteTrack")}</button
          >
        {/if}
      </section>
    </aside>

    <section class="editor-main">
      <div class="card bar-card">
        <div class="bar-pager">
          <div class="bar-nav">
            <IconButton
              label={t("editor.previous")}
              icon="back"
              disabled={barIndex <= 0}
              onclick={() => (barIndex -= 1)}
            />
            <div class="bar-current">
              <strong data-testid="editor-measure" data-bar={barIndex}
                >{t("editor.measure", {
                  number: barIndex + 1,
                  total: document_.bars.length,
                })}</strong
              >
              {#if bar.section}<span class="pill pill-accent">{bar.section}</span>{/if}
            </div>
            <IconButton
              label={t("editor.next")}
              icon="forward"
              disabled={barIndex >= document_.bars.length - 1}
              onclick={() => (barIndex += 1)}
            />
          </div>
          <OverflowMenu
            label={t("editor.barActions")}
            testid="editor-bar-menu"
            items={[
              {
                id: "before",
                label: t("editor.insertBefore"),
                icon: "plus",
                testid: "editor-insert-before",
                onclick: insertBefore,
              },
              {
                id: "after",
                label: t("editor.addMeasure"),
                icon: "plus",
                testid: "editor-add-measure",
                onclick: insertBar,
              },
              {
                id: "duplicate",
                label: t("editor.duplicateBar"),
                icon: "copy",
                testid: "editor-duplicate-bar",
                onclick: duplicateBar,
              },
              {
                id: "delete",
                label: t("editor.deleteMeasure"),
                danger: true,
                testid: "editor-delete-measure",
                disabled: document_.bars.length <= 1,
                onclick: deleteBar,
              },
            ]}
          />
        </div>
        <div class="bar-strip" role="group" aria-label={t("editor.bars")}>
          {#each document_.bars as item, index (index)}
            <button
              class="bar-chip"
              data-testid={`bar-chip-${index}`}
              class:has-section={Boolean(item.section)}
              aria-current={index === barIndex ? "true" : undefined}
              onclick={() => (barIndex = index)}
              title={item.section ?? undefined}
            >
              {index + 1}
            </button>
          {/each}
        </div>
        <div class="bar-grid">
          <div class="field">
            <span>{t("library.signature")}</span>
            <span class="signature">
              <input
                type="number"
                min="1"
                max="32"
                value={bar.signature[0]}
                onchange={(event) => setSignature(0, event.currentTarget.value)}
                aria-label={t("ui.beatsPerBar")}
              />
              <span class="signature-slash">/</span>
              <select
                value={bar.signature[1]}
                onchange={(event) => setSignature(1, event.currentTarget.value)}
                aria-label={t("ui.beatUnit")}
              >
                {#each [1, 2, 4, 8, 16, 32] as value (value)}<option {value}>{value}</option>{/each}
              </select>
            </span>
          </div>
          <label class="field">
            <span>{t("editor.section")}</span>
            <input
              value={bar.section ?? ""}
              onchange={(event) => (bar.section = event.currentTarget.value.trim() || null)}
            />
          </label>
          {#if barIndex > 0}
            <label class="field">
              <span>{t("editor.tempoChange")}</span>
              <input
                type="number"
                min="1"
                max="399"
                placeholder="—"
                value={bar.tempo ?? ""}
                onchange={(event) => setTempo(event.currentTarget.value)}
              />
            </label>
          {/if}
          <BarRepeats {bar} />
        </div>
        <p class="muted small">{t("editor.barsAreShared")}</p>
      </div>

      <div class="beat-toolbar">
        <SegmentedControl
          label={t("editor.voice")}
          value={String(voiceIndex)}
          onchange={(next) => (voiceIndex = Number(next))}
          options={Array.from({ length: Math.max(2, trackBar.voices.length) }, (_, index) => ({
            value: String(index),
            label: `${t("editor.voice")} ${index + 1}`,
          }))}
        />
        <span class="fill-status" class:ok={used === length} class:warn={used !== length}>
          <Icon name={used === length ? "check" : "alert"} size={16} />
          {used === length
            ? t("editor.barFull")
            : used > length
              ? t("editor.barOver")
              : t("editor.barShort")}
        </span>
        <button class="secondary add-beat" data-testid="editor-add-beat" onclick={addBeat}
          ><Icon name="plus" size={18} />{t("editor.addBeat")}</button
        >
      </div>
      <p class="muted small">{t("editor.fretHint")}</p>

      <div class="beat-grid">
        {#each beats as beat, beatIndex (beatIndex)}
          <article class="beat-card" data-testid="beat-card">
            <header class="beat-head">
              <span class="beat-number">{beatIndex + 1}</span>
              <div class="beat-actions">
                <IconButton
                  label={t("editor.moveEarlier")}
                  icon="back"
                  disabled={beatIndex === 0}
                  onclick={() => moveBeat(beatIndex, -1)}
                />
                <IconButton
                  label={t("editor.moveLater")}
                  icon="forward"
                  disabled={beatIndex === beats.length - 1}
                  onclick={() => moveBeat(beatIndex, 1)}
                />
                <OverflowMenu
                  label={t("editor.beatActions")}
                  testid="editor-beat-menu"
                  items={beatMenu(beat, beatIndex)}
                />
              </div>
            </header>
            <div class="duration">
              <SegmentedControl
                icons
                label={t("editor.duration")}
                testid="beat-duration"
                value={durationValue(beat)}
                onchange={(next) => setDuration(beat, next)}
                options={durationOptions(beat)}
              />
              <p class="duration-name">{durationLabel(beat)}</p>
            </div>
            <div class="staff">
              {#each track.tuning_midi as midi, stringIndex (stringIndex)}
                {@const note = noteOn(beat, stringIndex)}
                <div class="staff-row" class:has-note={Boolean(note)}>
                  <label class="staff-string">
                    <span>{midiToName(midi)}</span>
                    <input
                      type="text"
                      data-testid={`fret-input-${stringIndex}`}
                      inputmode="numeric"
                      value={note?.fret ?? ""}
                      oninput={(event) => setFret(beat, stringIndex, event.currentTarget.value)}
                    />
                  </label>
                  {#if note}
                    <details class="techniques">
                      <summary>{t("editor.techniques")}</summary>
                      <div class="tech-grid">
                        {#each ["dead", "tie", "ghost", "hammer", "vibrato", "palm_mute", "let_ring", "staccato"] as const as flag (flag)}
                          <label class="check"
                            ><input
                              type="checkbox"
                              checked={Boolean(note[flag])}
                              onchange={() => toggle(note, flag)}
                            />{t(`tech.${flag}`)}</label
                          >
                        {/each}
                      </div>
                      <label class="field">
                        <span>{t("tech.slide")}</span>
                        <select
                          value={note.slide ?? ""}
                          onchange={(event) =>
                            (note.slide = (event.currentTarget.value || null) as SlideKind | null)}
                        >
                          <option value="">—</option>
                          {#each ["shift", "legato", "in_below", "in_above", "out_up", "out_down"] as kind (kind)}
                            <option value={kind}>{t(`tech.slides.${kind}`)}</option>
                          {/each}
                        </select>
                      </label>
                      <label class="field">
                        <span>{t("tech.harmonic")}</span>
                        <select
                          value={note.harmonic ?? ""}
                          onchange={(event) =>
                            (note.harmonic = (event.currentTarget.value ||
                              null) as HarmonicKind | null)}
                        >
                          <option value="">—</option>
                          {#each ["natural", "artificial", "pinch", "tap", "semi"] as kind (kind)}
                            <option value={kind}>{t(`tech.harmonics.${kind}`)}</option>
                          {/each}
                        </select>
                      </label>
                      <label class="field">
                        <span>{t("tech.bend")}</span>
                        <input
                          type="number"
                          min="0"
                          max="4"
                          step="0.5"
                          value={note.bend ?? ""}
                          onchange={(event) => {
                            const value = Number(event.currentTarget.value);
                            note.bend = value > 0 && value <= 4 ? value : null;
                          }}
                        />
                      </label>
                    </details>
                  {/if}
                </div>
              {/each}
            </div>
          </article>
        {/each}
        <button class="beat-add" onclick={addBeat}
          ><Icon name="plus" size={22} /><span>{t("editor.addBeat")}</span></button
        >
      </div>
    </section>
  </div>
</div>

<style>
  .editor-page {
    gap: var(--sp-5);
  }

  .bar-pager {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .bar-pager .bar-nav {
    flex: 1;
    min-width: 0;
  }

  .bar-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--sp-4);
    align-items: end;
  }

  .beat-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-1);
  }

  .duration {
    display: grid;
    gap: var(--sp-1);
    min-width: 0;
  }

  .duration :global(.control.segmented) {
    width: 100%;
  }

  .duration-name {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
    line-height: 1.45;
  }

  .add-beat {
    margin-left: auto;
  }

  @media (min-width: 768px) {
    .bar-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
