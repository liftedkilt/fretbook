<script lang="ts">
  import { getMeta, getSong, updateSong } from "../lib/api";
  import { t, tOr } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import { midiToName } from "../lib/tuning";
  import type { Beat, InstrumentPreset, Measure, Note, SongDetail, Track } from "../lib/types";

  let { id }: { id: string } = $props();

  let song = $state<SongDetail | null>(null);
  let presets = $state<InstrumentPreset[]>([]);
  let error = $state("");
  let status = $state("");
  let trackId = $state("");
  let measureIndex = $state(0);
  let newPreset = $state("guitar-6");

  const track = $derived(song?.document.tracks.find((item) => item.id === trackId) ?? song?.document.tracks[0]);
  const measure = $derived(track?.measures[Math.min(measureIndex, (track?.measures.length ?? 1) - 1)]);

  $effect(() => {
    const songId = id;
    let cancel = false;
    void getSong(songId)
      .then((loaded) => {
        if (cancel) return;
        song = loaded;
        trackId = loaded.preferred_track_id;
      })
      .catch((err: unknown) => {
        if (!cancel) error = err instanceof Error ? err.message : String(err);
      });
    void getMeta()
      .then((meta) => {
        presets = meta.instruments;
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  });

  function voice(current: Measure): Beat[] {
    if (!current.voices[0]) current.voices = [{ beats: [] }];
    return current.voices[0].beats;
  }

  function reflow(current: Measure) {
    let position = 0;
    for (const beat of voice(current)) {
      beat.position = Math.round(position * 10000) / 10000;
      const duration = Number(beat.duration);
      beat.duration = Number.isFinite(duration) && duration > 0 ? duration : 0.25;
      if (!beat.extras?.graceNote) position += beat.duration;
    }
  }

  function noteOn(beat: Beat, stringIndex: number): Note | undefined {
    return beat.notes.find((note) => note.string === stringIndex);
  }

  function setFret(beat: Beat, stringIndex: number, raw: string) {
    const existing = noteOn(beat, stringIndex);
    beat.notes = beat.notes.filter((note) => note.string !== stringIndex);
    const trimmed = raw.trim();
    if (trimmed !== "") {
      const fret = Number(trimmed);
      if (Number.isInteger(fret) && fret >= 0 && fret <= 99) {
        beat.notes = [
          ...beat.notes,
          {
            string: stringIndex,
            fret,
            dead: existing?.dead ?? false,
            tie: existing?.tie ?? false,
            extras: existing?.extras ?? {},
          },
        ].sort((left, right) => left.string - right.string);
      }
    }
    beat.rest = beat.notes.length === 0;
  }

  function toggleFlag(beat: Beat, stringIndex: number, flag: "dead" | "tie") {
    const note = noteOn(beat, stringIndex);
    if (!note) return;
    note[flag] = !note[flag];
    beat.notes = [...beat.notes];
  }

  function setDuration(current: Measure, beat: Beat, raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    beat.duration = value;
    reflow(current);
  }

  function setGrace(current: Measure, beat: Beat, checked: boolean) {
    beat.extras = { ...beat.extras, graceNote: checked ? "onBeat" : undefined };
    if (!checked) delete beat.extras.graceNote;
    reflow(current);
  }

  function addBeat(current: Measure) {
    voice(current).push({ position: 0, duration: 1, notes: [], rest: true, extras: {} });
    reflow(current);
  }

  function deleteBeat(current: Measure, index: number) {
    voice(current).splice(index, 1);
    reflow(current);
  }

  function addMeasure() {
    if (!track) return;
    const signature = track.measures.at(-1)?.signature ?? [4, 4];
    const length = (4 * signature[0]) / signature[1];
    track.measures = [
      ...track.measures,
      {
        signature: [signature[0], signature[1]],
        extras: {},
        voices: [{ beats: [{ position: 0, duration: length, notes: [], rest: true, extras: {} }] }],
      },
    ];
    measureIndex = track.measures.length - 1;
  }

  function deleteMeasure() {
    if (!track || track.measures.length <= 1) return;
    track.measures = track.measures.filter((_, index) => index !== measureIndex);
    measureIndex = Math.max(0, measureIndex - 1);
  }

  function addString() {
    if (!track || track.tuning_midi.length >= 16) return;
    const last = track.tuning_midi.at(-1) ?? 40;
    track.tuning_midi = [...track.tuning_midi, last - 5];
  }

  function removeString() {
    if (!track || track.tuning_midi.length <= 1) return;
    const index = track.tuning_midi.length - 1;
    const used = track.measures.some((item) =>
      item.voices.some((itemVoice) => itemVoice.beats.some((beat) => beat.notes.some((note) => note.string === index))),
    );
    if (used) {
      error = t("editor.stringInUse");
      return;
    }
    error = "";
    track.tuning_midi = track.tuning_midi.slice(0, -1);
  }

  function addTrack() {
    if (!song || !track) return;
    const preset = presets.find((item) => item.id === newPreset) ?? presets[0];
    if (!preset) return;
    const measures = track.measures.map((item) => {
      const length = (4 * item.signature[0]) / item.signature[1];
      return {
        signature: [item.signature[0], item.signature[1]] as [number, number],
        extras: {},
        voices: [{ beats: [{ position: 0, duration: length, notes: [], rest: true, extras: {} }] }],
      };
    });
    const created: Track = {
      id: `trk_${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`,
      name: preset.name,
      instrument: preset.instrument,
      capo: 0,
      tuning_midi: [...preset.tuning_midi],
      preferred: false,
      measures,
    };
    song.document.tracks = [...song.document.tracks, created];
    trackId = created.id;
    measureIndex = 0;
  }

  function setPreferred(current: Track) {
    if (!song) return;
    for (const item of song.document.tracks) item.preferred = item.id === current.id;
    song.document.tracks = [...song.document.tracks];
  }

  async function save() {
    if (!song || !track) return;
    status = t("editor.saving");
    error = "";
    for (const item of song.document.tracks) {
      for (const itemMeasure of item.measures) reflow(itemMeasure);
    }
    song.document.bpm = Number(song.document.bpm) || 120;
    if (song.document.tempos[0]) song.document.tempos[0].bpm = song.document.bpm;
    try {
      const saved = await updateSong(song.id, {
        title: song.title.trim() || "Untitled",
        artist: song.artist.trim(),
        document: JSON.parse(JSON.stringify(song.document)) as SongDetail["document"],
      });
      song = saved;
      status = t("editor.saved");
    } catch (err) {
      status = "";
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if !song || !track || !measure}
  <p class="hint">{t("app.loading")}</p>
{:else}
  {@const current = song}
  <div class="row" style="justify-content:space-between">
    <h2 style="margin:0">{t("editor.heading")}</h2>
    <div class="actions">
      <a class="button" href={hrefFor(`/songs/${current.id}`)} onclick={(event) => followLink(event, `/songs/${current.id}`)}>{t("editor.play")}</a>
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
      <select bind:value={trackId} onchange={() => (measureIndex = 0)}>
        {#each song.document.tracks as item (item.id)}
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
    <button disabled={measureIndex <= 0} onclick={() => (measureIndex -= 1)}>{t("editor.previous")}</button>
    <strong>{t("editor.measure", { number: measureIndex + 1 })} / {track.measures.length}</strong>
    <button disabled={measureIndex >= track.measures.length - 1} onclick={() => (measureIndex += 1)}>{t("editor.next")}</button>
    <label class="field">
      {t("library.signature")}
      <span class="row">
        <input type="number" min="1" max="32" bind:value={measure.signature[0]} />
        <input type="number" min="1" max="32" bind:value={measure.signature[1]} />
      </span>
    </label>
    <button onclick={addMeasure}>{t("editor.addMeasure")}</button>
    <button onclick={deleteMeasure}>{t("editor.deleteMeasure")}</button>
    <button onclick={() => addBeat(measure)}>{t("editor.addBeat")}</button>
  </div>

  <div class="editor-grid">
    {#each measure.voices[0]?.beats ?? [] as beat, beatIndex (beatIndex)}
      <div class="beat">
        <label class="field">
          {t("editor.duration")}
          <input type="number" min="0.01" step="0.25" value={beat.duration} onchange={(event) => setDuration(measure, beat, event.currentTarget.value)} />
        </label>
        <label class="field">
          {t("editor.grace")}
          <input type="checkbox" checked={Boolean(beat.extras?.graceNote)} onchange={(event) => setGrace(measure, beat, event.currentTarget.checked)} />
        </label>
        {#each track.tuning_midi as midi, stringIndex (stringIndex)}
          <label class="field">
            {midiToName(midi)}
            <input
              type="text"
              inputmode="numeric"
              value={noteOn(beat, stringIndex)?.fret ?? ""}
              oninput={(event) => setFret(beat, stringIndex, event.currentTarget.value)}
            />
            {#if noteOn(beat, stringIndex)}
              <span class="row">
                <button type="button" onclick={() => toggleFlag(beat, stringIndex, "dead")}>{t("editor.dead")}</button>
                <button type="button" onclick={() => toggleFlag(beat, stringIndex, "tie")}>{t("editor.tie")}</button>
              </span>
            {/if}
          </label>
        {/each}
        <button onclick={() => deleteBeat(measure, beatIndex)}>{t("editor.deleteBeat")}</button>
      </div>
    {/each}
  </div>
{/if}
