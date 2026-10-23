<script lang="ts">
  import { untrack } from "svelte";

  import Icon from "./Icon.svelte";
  import { ApiError, getSong, updateSong } from "../lib/api";
  import { barTicks, EDITOR_DURATIONS } from "../lib/durations";
  import { t, tOr } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import { remapSync } from "../lib/sync";
  import { midiToName } from "../lib/tuning";
  import type {
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
  let baseSync: SyncMap = untrack(
    () => structuredClone($state.snapshot(initial.document.sync)) as SyncMap,
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

  function contentKey(document: ScoreDocument): string {
    return JSON.stringify({ bars: document.bars, tracks: document.tracks });
  }

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

  function insertBar() {
    const at = barIndex + 1;
    document_.bars.splice(at, 0, { signature: [bar.signature[0], bar.signature[1]], extras: {} });
    for (const item of document_.tracks)
      item.bars.splice(at, 0, { voices: [{ beats: [] }], extras: {} });
    origin.splice(at, 0, null);
    barIndex = at;
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

  async function send(revision: number, sync: SyncMap, bpm: number) {
    const document: ScoreDocument = {
      ...$state.snapshot(song.document),
      bpm,
      sync: remapSync(sync, origin),
    };
    return updateSong(song.id, {
      title: song.title.trim() || t("library.untitled"),
      artist: song.artist.trim(),
      revision,
      document,
    });
  }

  async function save() {
    status = t("editor.saving");
    error = "";
    conflict = false;
    try {
      let saved;
      try {
        saved = await send(song.revision, baseSync, song.document.bpm);
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 409) throw err;
        // Someone changed the song since it was loaded. If only the sync marks or BPM moved
        // (the player in another tab), keep those and save these edits on top.
        const latest = await getSong(song.id);
        if (!latest.document || contentKey(latest.document) !== loadedContent) {
          conflict = true;
          throw err;
        }
        const bpm = song.document.bpm === loadedBpm ? latest.document.bpm : song.document.bpm;
        saved = await send(latest.revision, latest.document.sync, bpm);
      }
      song = saved as TabSong;
      loadedContent = contentKey(saved.document!);
      loadedBpm = saved.document!.bpm;
      baseSync = structuredClone(saved.document!.sync);
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
    loadedContent = contentKey(latest.document);
    loadedBpm = latest.document.bpm;
    baseSync = structuredClone(latest.document.sync);
    origin = latest.document.bars.map((_, index) => index);
    barIndex = Math.min(barIndex, latest.document.bars.length - 1);
    conflict = false;
    error = "";
  }
</script>

<div class="editor-page">
  <header class="editor-bar">
    <a
      class="back-link"
      href={hrefFor(`/songs/${song.id}`)}
      onclick={(event) => followLink(event, `/songs/${song.id}`)}
    >
      <Icon name="play" size={14} />{t("editor.play")}
    </a>
    <h1 class="editor-title" data-testid="editor-title">{song.title || t("editor.heading")}</h1>
    <div class="editor-actions">
      {#if status}<span class="save-status" role="status" data-testid="editor-status"
          ><Icon name="check" size={16} />{status}</span
        >{/if}
      <button class="primary" data-testid="editor-save" onclick={() => void save()}
        ><Icon name="save" size={18} />{t("editor.save")}</button
      >
    </div>
  </header>

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
        <div class="bar-nav">
          <button
            class="icon-button"
            disabled={barIndex <= 0}
            onclick={() => (barIndex -= 1)}
            aria-label={t("editor.previous")}
            title={t("editor.previous")}
          >
            <Icon name="back" />
          </button>
          <div class="bar-current">
            <strong data-testid="editor-measure" data-bar={barIndex}
              >{t("editor.measure", { number: barIndex + 1, total: document_.bars.length })}</strong
            >
            {#if bar.section}<span class="pill pill-accent">{bar.section}</span>{/if}
          </div>
          <button
            class="icon-button"
            disabled={barIndex >= document_.bars.length - 1}
            onclick={() => (barIndex += 1)}
            aria-label={t("editor.next")}
            title={t("editor.next")}
          >
            <Icon name="forward" />
          </button>
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
        <div class="bar-settings">
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
          <label class="field">
            <span>{t("editor.section")}</span>
            <input
              value={bar.section ?? ""}
              onchange={(event) => (bar.section = event.currentTarget.value.trim() || null)}
            />
          </label>
          <div class="button-row bar-buttons">
            <button class="small-button" data-testid="editor-add-measure" onclick={insertBar}
              ><Icon name="plus" size={16} />{t("editor.addMeasure")}</button
            >
            <button
              class="small-button danger-text"
              onclick={deleteBar}
              disabled={document_.bars.length <= 1}
              ><Icon name="trash" size={16} />{t("editor.deleteMeasure")}</button
            >
          </div>
        </div>
        <p class="muted small">{t("editor.barsAreShared")}</p>
      </div>

      <div class="beat-toolbar">
        <div class="segmented" role="radiogroup" aria-label={t("editor.voice")}>
          {#each Array.from({ length: Math.max(2, trackBar.voices.length) }, (_, index) => index) as index (index)}
            <button
              role="radio"
              aria-checked={voiceIndex === index}
              onclick={() => (voiceIndex = index)}>{t("editor.voice")} {index + 1}</button
            >
          {/each}
        </div>
        <span class="fill-status" class:ok={used === length} class:warn={used !== length}>
          <Icon name={used === length ? "check" : "alert"} size={16} />
          {used === length
            ? t("editor.barFull")
            : used > length
              ? t("editor.barOver")
              : t("editor.barShort")}
        </span>
        <button class="primary" data-testid="editor-add-beat" onclick={addBeat}
          ><Icon name="plus" size={18} />{t("editor.addBeat")}</button
        >
      </div>
      <p class="muted small">{t("editor.fretHint")}</p>

      <div class="beat-grid">
        {#each beats as beat, beatIndex (beatIndex)}
          <article class="beat-card" data-testid="beat-card">
            <header class="beat-head">
              <span class="beat-number">{beatIndex + 1}</span>
              <div class="beat-tools">
                <button
                  class="icon-button ghost"
                  onclick={() => moveBeat(beatIndex, -1)}
                  disabled={beatIndex === 0}
                  aria-label={t("editor.moveEarlier")}
                  title={t("editor.moveEarlier")}
                >
                  <Icon name="back" size={16} />
                </button>
                <button
                  class="icon-button ghost"
                  onclick={() => moveBeat(beatIndex, 1)}
                  disabled={beatIndex === beats.length - 1}
                  aria-label={t("editor.moveLater")}
                  title={t("editor.moveLater")}
                >
                  <Icon name="forward" size={16} />
                </button>
                <button
                  class="icon-button ghost danger-text"
                  onclick={() => deleteBeat(beatIndex)}
                  aria-label={t("editor.deleteBeat")}
                  title={t("editor.deleteBeat")}
                >
                  <Icon name="trash" size={16} />
                </button>
              </div>
            </header>
            <div class="beat-fields">
              <label class="field">
                <span>{t("editor.duration")}</span>
                <select
                  value={durationValue(beat)}
                  onchange={(event) => setDuration(beat, event.currentTarget.value)}
                >
                  {#each EDITOR_DURATIONS as option (option.key)}
                    <option value={`${option.ticks}:${option.tuplet ?? ""}`}
                      >{t(`durations.${option.key}`)}</option
                    >
                  {/each}
                  {#if !EDITOR_DURATIONS.some((option) => `${option.ticks}:${option.tuplet ?? ""}` === durationValue(beat))}
                    <option value={durationValue(beat)}
                      >{t("durations.other", { ticks: beat.duration })}</option
                    >
                  {/if}
                </select>
              </label>
              <label class="field">
                <span>{t("editor.grace")}</span>
                <select
                  value={beat.grace ?? ""}
                  onchange={(event) => setGrace(beat, event.currentTarget.value)}
                >
                  <option value="">—</option>
                  <option value="on_beat">{t("editor.graceOnBeat")}</option>
                  <option value="before_beat">{t("editor.graceBeforeBeat")}</option>
                </select>
              </label>
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
