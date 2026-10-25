<script lang="ts">
  import ChordDiagram from "./ChordDiagram.svelte";
  import ChordSetupPicker from "./ChordSetupPicker.svelte";
  import Icon from "./Icon.svelte";
  import ToolPage from "./ui/ToolPage.svelte";
  import { t } from "../lib/i18n.svelte";
  import { loadSetup, saveSetup } from "../lib/chords/choice";
  import { resolveSetup } from "../lib/chords/instruments";
  import { playStrum, strumNotes } from "../lib/chords/strum";
  import { parseChord } from "../lib/chords/theory";
  import { generateVoicings } from "../lib/chords/voicings";

  const ROOTS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const QUALITIES = ["", "m", "7", "maj7", "m7", "sus2", "sus4", "dim", "aug", "6", "9", "add9"];

  const saved = loadSetup();
  let instrumentId = $state(saved.instrument ?? "guitar6");
  let tuningId = $state(saved.tuning ?? "standard");
  let query = $state("C");

  const setup = $derived(resolveSetup(instrumentId, tuningId));
  const name = $derived(query.trim());
  const parsed = $derived(parseChord(name));
  const voicings = $derived(
    parsed
      ? generateVoicings(setup.tuning.strings, name, {
          rootInBass: setup.instrument.rootInBass,
          limit: 12,
        })
      : [],
  );
  const root = $derived(/^[A-G][#b]?/.exec(name)?.[0] ?? "");
  const quality = $derived(name.slice(root.length));

  function changeSetup(instrument: string, tuning: string) {
    const next = resolveSetup(instrument, tuning);
    instrumentId = next.instrument.id;
    tuningId = next.tuning.id;
    saveSetup({ instrument: instrumentId, tuning: tuningId });
  }

  function pickRoot(next: string) {
    query = `${next}${quality}`;
  }

  function pickQuality(next: string) {
    query = `${root || "C"}${next}`;
  }
</script>

<ToolPage
  title={t("chordDiagrams.libraryHeading")}
  subtitle={t("chordDiagrams.librarySubtitle")}
  testid="chord-library-view"
  layout="stacked"
>
  {#snippet stage()}
    {#if !name}
      <p class="muted" data-testid="chord-empty">{t("chordDiagrams.searchHint")}</p>
    {:else if !parsed}
      <p class="alert" role="alert" data-testid="chord-unknown">
        <Icon name="alert" size={18} />{t("chordDiagrams.unknownChord", { chord: name })}
      </p>
    {:else if !voicings.length}
      <p class="muted" data-testid="chord-no-shapes">
        {t("chordDiagrams.noShapes", { chord: name })}
      </p>
    {:else}
      <ul class="chord-strip chord-library-grid" data-testid="chord-voicings">
        {#each voicings as voicing, index (voicing.frets.join("."))}
          <li class="chord-card" data-testid="chord-voicing">
            <p class="chord-card-name">{name}</p>
            <ChordDiagram {voicing} strings={setup.tuning.strings.length} {name} />
            <div class="chord-card-controls">
              <span class="chord-card-count">{index + 1}</span>
              <button
                class="icon-button ghost"
                data-testid="voicing-play"
                aria-label={t("chordDiagrams.play", { chord: name })}
                onclick={() => playStrum(strumNotes(voicing, setup.tuning.strings))}
                ><Icon name="play" size={16} /></button
              >
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/snippet}

  {#snippet settings()}
    <label class="tool-field">
      <span>{t("chordDiagrams.search")}</span>
      <input
        type="text"
        data-testid="chord-search"
        placeholder={t("chordDiagrams.searchPlaceholder")}
        autocomplete="off"
        spellcheck="false"
        bind:value={query}
      />
    </label>
    <ChordSetupPicker instrument={instrumentId} tuning={tuningId} onchange={changeSetup} />
    <div class="chip-row" role="group" aria-label={t("chordDiagrams.root")}>
      {#each ROOTS as item (item)}
        <button
          class="chip"
          aria-pressed={root === item}
          data-testid="chord-root-{item}"
          onclick={() => pickRoot(item)}>{item}</button
        >
      {/each}
    </div>
    <div class="chip-row" role="group" aria-label={t("chordDiagrams.quality")}>
      {#each QUALITIES as item (item)}
        <button
          class="chip"
          aria-pressed={parsed !== null && quality === item}
          data-testid="chord-quality-{item || 'maj'}"
          onclick={() => pickQuality(item)}>{item || t("chordDiagrams.major")}</button
        >
      {/each}
    </div>
  {/snippet}
</ToolPage>
