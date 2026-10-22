<script lang="ts">
  import { untrack } from "svelte";

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
  let baseSync: SyncMap = untrack(() => structuredClone($state.snapshot(initial.document.sync)) as SyncMap);
  let origin = $state<(number | null)[]>(untrack(() => initial.document.bars.map((_, index) => index)));

  const document_ = $derived(song.document);
  const track = $derived(document_.tracks.find((item) => item.id === trackId) ?? document_.tracks[0]);
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

  function toggle(note: Note, flag: "dead" | "tie" | "ghost" | "hammer" | "vibrato" | "palm_mute" | "let_ring" | "staccato") {
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
    const fit = EDITOR_DURATIONS.find((item) => item.tuplet === null && item.ticks <= left) ?? EDITOR_DURATIONS[4];
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
    for (const item of document_.tracks) item.bars.splice(at, 0, { voices: [{ beats: [] }], extras: {} });
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
    if (part === 0 && Number.isInteger(value) && value >= 1 && value <= 32) bar.signature[0] = value;
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
      item.voices.some((voice) => voice.beats.some((beat) => beat.notes.some((note) => note.string === index))),
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
    const document: ScoreDocument = { ...$state.snapshot(song.document), bpm, sync: remapSync(sync, origin) };
    return updateSong(song.id, { title: song.title.trim() || t("library.untitled"), artist: song.artist.trim(), revision, document });
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

{#if error}<p class="error">{error}</p>{/if}
{#if conflict}
  <p class="error">{t("editor.conflict")} <button onclick={() => void reload()}>{t("editor.reload")}</button></p>
{/if}

<div class="row" style="justify-content:space-between">
  <h2 style="margin:0">{t("editor.heading")}</h2>
  <div class="actions">
    <a class="button" href={hrefFor(`/songs/${song.id}`)} onclick={(event) => followLink(event, `/songs/${song.id}`)}>{t("editor.play")}</a>
    <button class="primary" onclick={() => void save()}>{t("editor.save")}</button>
    {#if status}<span class="hint">{status}</span>{/if}
  </div>
</div>

<div class="row" style="margin:0.8rem 0">
  <label class="field">{t("library.title")}<input bind:value={song.title} /></label>
  <label class="field">{t("library.artist")}<input bind:value={song.artist} /></label>
  <label class="field">{t("library.bpm")}<input type="number" min="1" max="399" bind:value={song.document.bpm} /></label>
  <label class="field">
    {t("player.track")}
    <select bind:value={trackId} onchange={() => (voiceIndex = 0)}>
      {#each document_.tracks as item (item.id)}
        <option value={item.id}>{item.name}</option>
      {/each}
    </select>
  </label>
</div>

<section class="panel stack">
  <div class="row">
    <label class="field">{t("editor.trackName")}<input bind:value={track.name} /></label>
    <label class="field">{t("editor.capo")}<input type="number" min="0" max="24" bind:value={track.capo} /></label>
    <label class="field" style="align-items:center">
      <span>{t("editor.preferred")}</span>
      <input type="checkbox" checked={track.preferred} onchange={() => setPreferred(track)} />
    </label>
    <span class="hint">{track.tuning_midi.map((midi) => midiToName(midi)).join(" ")}</span>
    <button onclick={addString}>{t("editor.addString")}</button>
    <button onclick={removeString}>{t("editor.removeString")}</button>
    {#if document_.tracks.length > 1}<button onclick={deleteTrack}>{t("editor.deleteTrack")}</button>{/if}
  </div>
  <div class="row">
    <label class="field">
      {t("library.preset")}
      <select bind:value={newPreset}>
        {#each presets as item (item.id)}
          <option value={item.id}>{tOr(item.label_key, item.label)}</option>
        {/each}
      </select>
    </label>
    <button onclick={addTrack}>{t("editor.addTrack")}</button>
  </div>
  <p class="hint">{t("editor.fretHint")}</p>
</section>

<div class="row" style="margin:0.8rem 0">
  <button disabled={barIndex <= 0} onclick={() => (barIndex -= 1)}>{t("editor.previous")}</button>
  <strong>{t("editor.measure", { number: barIndex + 1, total: document_.bars.length })}</strong>
  <button disabled={barIndex >= document_.bars.length - 1} onclick={() => (barIndex += 1)}>{t("editor.next")}</button>
  <label class="field">
    {t("library.signature")}
    <span class="row">
      <input type="number" min="1" max="32" value={bar.signature[0]} onchange={(event) => setSignature(0, event.currentTarget.value)} />
      <select value={bar.signature[1]} onchange={(event) => setSignature(1, event.currentTarget.value)}>
        {#each [1, 2, 4, 8, 16, 32] as value (value)}<option {value}>{value}</option>{/each}
      </select>
    </span>
  </label>
  {#if barIndex > 0}
    <label class="field">
      {t("editor.tempoChange")}
      <input type="number" min="1" max="399" placeholder="—" value={bar.tempo ?? ""} onchange={(event) => setTempo(event.currentTarget.value)} />
    </label>
  {/if}
  <label class="field">
    {t("editor.section")}
    <input value={bar.section ?? ""} onchange={(event) => (bar.section = event.currentTarget.value.trim() || null)} />
  </label>
  <button onclick={insertBar}>{t("editor.addMeasure")}</button>
  <button onclick={deleteBar} disabled={document_.bars.length <= 1}>{t("editor.deleteMeasure")}</button>
</div>
<p class="hint">{t("editor.barsAreShared")}</p>

<div class="row" style="margin:0.8rem 0">
  <label class="field">
    {t("editor.voice")}
    <select bind:value={voiceIndex}>
      {#each Array.from({ length: Math.max(2, trackBar.voices.length) }, (_, index) => index) as index (index)}
        <option value={index}>{index + 1}</option>
      {/each}
    </select>
  </label>
  <button onclick={addBeat}>{t("editor.addBeat")}</button>
  <span class={used === length ? "hint" : "error"} style="margin:0">
    {used === length ? t("editor.barFull") : used > length ? t("editor.barOver") : t("editor.barShort")}
  </span>
</div>

<div class="editor-grid">
  {#each beats as beat, beatIndex (beatIndex)}
    <div class="beat">
      <label class="field">
        {t("editor.duration")}
        <select value={durationValue(beat)} onchange={(event) => setDuration(beat, event.currentTarget.value)}>
          {#each EDITOR_DURATIONS as option (option.key)}
            <option value={`${option.ticks}:${option.tuplet ?? ""}`}>{t(`durations.${option.key}`)}</option>
          {/each}
          {#if !EDITOR_DURATIONS.some((option) => `${option.ticks}:${option.tuplet ?? ""}` === durationValue(beat))}
            <option value={durationValue(beat)}>{t("durations.other", { ticks: beat.duration })}</option>
          {/if}
        </select>
      </label>
      <label class="field">
        {t("editor.grace")}
        <select value={beat.grace ?? ""} onchange={(event) => setGrace(beat, event.currentTarget.value)}>
          <option value="">—</option>
          <option value="on_beat">{t("editor.graceOnBeat")}</option>
          <option value="before_beat">{t("editor.graceBeforeBeat")}</option>
        </select>
      </label>
      {#each track.tuning_midi as midi, stringIndex (stringIndex)}
        {@const note = noteOn(beat, stringIndex)}
        <div class="field">
          <label>
            {midiToName(midi)}
            <input
              type="text"
              inputmode="numeric"
              value={note?.fret ?? ""}
              oninput={(event) => setFret(beat, stringIndex, event.currentTarget.value)}
            />
          </label>
          {#if note}
            <details class="techniques">
              <summary>{t("editor.techniques")}</summary>
              {#each ["dead", "tie", "ghost", "hammer", "vibrato", "palm_mute", "let_ring", "staccato"] as const as flag (flag)}
                <label class="check"><input type="checkbox" checked={Boolean(note[flag])} onchange={() => toggle(note, flag)} />{t(`tech.${flag}`)}</label>
              {/each}
              <label class="field">
                {t("tech.slide")}
                <select value={note.slide ?? ""} onchange={(event) => (note.slide = (event.currentTarget.value || null) as SlideKind | null)}>
                  <option value="">—</option>
                  {#each ["shift", "legato", "in_below", "in_above", "out_up", "out_down"] as kind (kind)}
                    <option value={kind}>{t(`tech.slides.${kind}`)}</option>
                  {/each}
                </select>
              </label>
              <label class="field">
                {t("tech.harmonic")}
                <select value={note.harmonic ?? ""} onchange={(event) => (note.harmonic = (event.currentTarget.value || null) as HarmonicKind | null)}>
                  <option value="">—</option>
                  {#each ["natural", "artificial", "pinch", "tap", "semi"] as kind (kind)}
                    <option value={kind}>{t(`tech.harmonics.${kind}`)}</option>
                  {/each}
                </select>
              </label>
              <label class="field">
                {t("tech.bend")}
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
      <div class="row">
        <button onclick={() => moveBeat(beatIndex, -1)} disabled={beatIndex === 0} aria-label={t("editor.moveEarlier")}>←</button>
        <button onclick={() => moveBeat(beatIndex, 1)} disabled={beatIndex === beats.length - 1} aria-label={t("editor.moveLater")}>→</button>
        <button onclick={() => deleteBeat(beatIndex)}>{t("editor.deleteBeat")}</button>
      </div>
    </div>
  {/each}
</div>
