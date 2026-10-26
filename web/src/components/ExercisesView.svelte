<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "./Icon.svelte";
  import SegmentedControl from "./ui/SegmentedControl.svelte";
  import SliderStepper from "./ui/SliderStepper.svelte";
  import ToolPage from "./ui/ToolPage.svelte";
  import TabPreview from "./TabPreview.svelte";
  import { ApiError, importDocument } from "../lib/api";
  import {
    ExerciseError,
    generateExercise,
    type Direction,
    type ExerciseSpec,
    type Generated,
    type Position,
    type Range,
    type Rhythm,
  } from "../lib/exercises/generate";
  import { PRESET_DRILLS, labelText, presetById, type PresetDrill } from "../lib/exercises/presets";
  import { CAGED_SHAPES, NOTE_NAMES, type CagedShape } from "../lib/exercises/theory";
  import { t, tOr } from "../lib/i18n.svelte";
  import { navigate } from "../lib/router.svelte";
  import { ui } from "../lib/ui.svelte";

  type Kind = ExerciseSpec["kind"];
  const SPIDER_PATTERNS = ["1234", "1243", "1324", "1342", "1423", "1432", "4321"];

  let kind = $state<Kind>("scale");
  let instrumentId = $state("");
  let bpm = $state(80);
  let rhythm = $state<Rhythm>("eighth");
  let direction = $state<Direction>("both");
  let range = $state<Range>("position");
  let positionMode = $state<"auto" | "fret" | "caged">("fret");
  let fret = $state(5);
  let shape = $state<CagedShape>("E");
  let root = $state(9);
  let scale = $state("minorPentatonic");
  let chord = $state("Am7");
  let spiderPattern = $state("1234");
  let spiderDirection = $state<"up" | "down">("up");
  let shifts = $state(0);
  let chordList = $state("G C D Em");
  let beatsEach = $state(4);
  let strum = $state("quarters");
  let cycles = $state(2);
  let bassPattern = $state<"rootFifthOctave" | "walking">("rootFifthOctave");
  let activePreset = $state<string | null>(null);
  let saving = $state(false);
  let saveError = $state("");

  const preset = $derived(
    ui.presets.find((item) => item.id === (instrumentId || ui.defaultInstrument)) ?? ui.presets[0],
  );
  const position = $derived<Position>(
    positionMode === "fret"
      ? { type: "fret", fret }
      : positionMode === "caged"
        ? { type: "caged", shape }
        : { type: "auto" },
  );
  const spec = $derived<ExerciseSpec>(
    kind === "scale"
      ? { kind, root, scale, position, range, direction, rhythm }
      : kind === "arpeggio"
        ? { kind, chord: chord.trim(), position, range, direction, rhythm }
        : kind === "spider"
          ? {
              kind,
              startFret: fret,
              pattern: spiderPattern,
              direction: spiderDirection,
              shifts,
              rhythm,
            }
          : kind === "changes"
            ? { kind, chords: names(chordList), beatsEach, strum, cycles }
            : { kind, chords: names(chordList), pattern: bassPattern, cycles },
  );
  const result = $derived.by((): { ok: Generated } | { error: string } => {
    if (!preset) return { error: "" };
    try {
      return {
        ok: generateExercise(
          {
            tuning: preset.tuning_midi,
            instrument: preset.instrument,
            name: preset.name,
            bpm,
          },
          spec,
        ),
      };
    } catch (err) {
      if (err instanceof ExerciseError) return { error: t(err.key, err.params) };
      throw err;
    }
  });
  const title = $derived("ok" in result ? labelText(result.ok.label, t) : "");
  const drills = $derived(
    PRESET_DRILLS.filter((drill) => drill.family === "any" || drill.family === preset?.family),
  );

  function names(text: string): string[] {
    return text.split(/[\s,;|]+/).filter(Boolean);
  }

  function apply(drill: PresetDrill) {
    const next = drill.spec;
    activePreset = drill.id;
    kind = next.kind;
    bpm = drill.bpm;
    if (next.kind === "scale" || next.kind === "arpeggio") {
      positionMode = next.position.type;
      if (next.position.type === "fret") fret = next.position.fret;
      if (next.position.type === "caged") shape = next.position.shape;
      range = next.range;
      direction = next.direction;
      rhythm = next.rhythm;
    }
    if (next.kind === "scale") {
      root = next.root;
      scale = next.scale;
    } else if (next.kind === "arpeggio") {
      chord = next.chord;
    } else if (next.kind === "spider") {
      fret = next.startFret;
      spiderPattern = next.pattern;
      spiderDirection = next.direction;
      shifts = next.shifts;
      rhythm = next.rhythm;
    } else if (next.kind === "changes") {
      chordList = next.chords.join(" ");
      beatsEach = next.beatsEach;
      strum = next.strum;
      cycles = next.cycles;
    } else {
      chordList = next.chords.join(" ");
      bassPattern = next.pattern;
      cycles = next.cycles;
    }
  }

  // A lesson links here with ?preset=<id>. Wait for the instrument list, then switch to an instrument the drill
  // is written for (a guitar drill on a bass would otherwise stay hidden) and load it.
  let pendingDrill = $state<PresetDrill | undefined>(
    presetById(new URLSearchParams(location.search).get("preset") ?? ""),
  );
  $effect(() => {
    const drill = pendingDrill;
    if (!drill || ui.presets.length === 0) return;
    untrack(() => {
      if (drill.family !== "any" && preset?.family !== drill.family) {
        const match = ui.presets.find((item) => item.family === drill.family);
        if (match) instrumentId = match.id;
      }
      apply(drill);
    });
    pendingDrill = undefined;
  });

  function edited() {
    activePreset = null;
  }

  async function save() {
    if (!("ok" in result)) return;
    saving = true;
    saveError = "";
    try {
      const song = await importDocument({
        title,
        artist: "",
        source_kind: "manual",
        document: result.ok.document,
        tags: [t("exercises.tag")],
      });
      navigate(`/songs/${song.id}`);
    } catch (err) {
      saveError = err instanceof ApiError || err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }
</script>

<ToolPage
  title={t("exercises.heading")}
  subtitle={t("exercises.subtitle")}
  testid="exercises-view"
  {stage}
  {settings}
/>

{#snippet stage()}
  {#if "error" in result}
    {#if result.error}
      <p class="alert" role="alert" data-testid="exercise-error">
        <Icon name="alert" size={18} />{result.error}
      </p>
    {/if}
  {:else}
    <section class="exercise-result" aria-labelledby="exercise-title">
      <h2 id="exercise-title" class="display" data-testid="exercise-title">{title}</h2>
      {#if saveError}<p class="alert" role="alert">{saveError}</p>{/if}
      <div class="exercise-actions">
        <button
          class="primary hero start"
          data-testid="exercise-save"
          disabled={saving}
          onclick={() => void save()}
        >
          <Icon name="plus" size={20} /><span>{t("exercises.save")}</span>
        </button>
      </div>
      <TabPreview score={result.ok.document} />
    </section>
  {/if}
{/snippet}

{#snippet settings()}
  <section aria-labelledby="exercise-presets">
    <h2 id="exercise-presets" class="field-label">{t("exercises.presetsHeading")}</h2>
    <div class="chip-row" data-testid="exercise-presets">
      {#each drills as drill (drill.id)}
        <button
          class="chip"
          aria-pressed={activePreset === drill.id}
          data-testid="exercise-preset-{drill.id}"
          title={t(`exercises.presets.${drill.id}.description`)}
          onclick={() => apply(drill)}>{t(`exercises.presets.${drill.id}.title`)}</button
        >
      {/each}
    </div>
  </section>

  <SegmentedControl
    label={t("exercises.kind")}
    value={kind}
    onchange={(next) => {
      kind = next as Kind;
      edited();
    }}
    options={[
      { value: "scale", label: t("exercises.kinds.scale"), testid: "exercise-kind-scale" },
      {
        value: "arpeggio",
        label: t("exercises.kinds.arpeggio"),
        testid: "exercise-kind-arpeggio",
      },
      { value: "spider", label: t("exercises.kinds.spider"), testid: "exercise-kind-spider" },
      { value: "changes", label: t("exercises.kinds.changes"), testid: "exercise-kind-changes" },
      { value: "bass", label: t("exercises.kinds.bass"), testid: "exercise-kind-bass" },
    ]}
  />

  <div class="pickers" oninput={edited} onchange={edited} role="presentation">
    <label class="tool-field">
      <span>{t("tools.instrument")}</span>
      <select
        data-testid="exercise-instrument"
        value={preset?.id}
        onchange={(event) => (instrumentId = event.currentTarget.value)}
      >
        {#each ui.presets as item (item.id)}
          <option value={item.id}>{tOr(item.label_key, item.label)}</option>
        {/each}
      </select>
    </label>
    <div class="tool-field">
      <span>{t("tools.bpm")}</span>
      <SliderStepper
        label={t("tools.bpm")}
        value={bpm}
        min={30}
        max={260}
        testid="exercise-bpm-slider"
        decreaseLabel={t("tools.slower")}
        increaseLabel={t("tools.faster")}
        onchange={(next) => {
          bpm = next;
          edited();
        }}
      />
      <input
        type="number"
        class="bpm-input"
        min="30"
        max="260"
        data-testid="exercise-bpm"
        aria-label={t("tools.bpm")}
        bind:value={bpm}
      />
    </div>

    {#if kind === "scale"}
      <label class="tool-field">
        <span>{t("exercises.key")}</span>
        <select data-testid="exercise-root" bind:value={root}>
          {#each NOTE_NAMES as name, index (name)}
            <option value={index}>{name}</option>
          {/each}
        </select>
      </label>
      <label class="tool-field">
        <span>{t("exercises.scale")}</span>
        <select data-testid="exercise-scale" bind:value={scale}>
          {#each ["major", "dorian", "phrygian", "lydian", "mixolydian", "minor", "locrian", "harmonicMinor", "melodicMinor", "majorPentatonic", "minorPentatonic", "blues", "wholeTone"] as id (id)}
            <option value={id}>{t(`exercises.scales.${id}`)}</option>
          {/each}
        </select>
      </label>
    {:else if kind === "arpeggio"}
      <label class="tool-field tool-field-full">
        <span>{t("exercises.chord")}</span>
        <input type="text" data-testid="exercise-chord" spellcheck="false" bind:value={chord} />
      </label>
    {/if}

    {#if kind === "scale" || kind === "arpeggio"}
      <label class="tool-field">
        <span>{t("exercises.position")}</span>
        <select data-testid="exercise-position" bind:value={positionMode}>
          <option value="auto">{t("exercises.positionAuto")}</option>
          <option value="fret">{t("exercises.positionFret")}</option>
          <option value="caged">{t("exercises.positionCaged")}</option>
        </select>
      </label>
      {#if positionMode === "fret"}
        <div class="tool-field">
          <span>{t("exercises.startFret")}</span>
          <SliderStepper
            label={t("exercises.startFret")}
            value={fret}
            min={0}
            max={18}
            testid="exercise-fret"
            decreaseLabel={t("tools.decrease")}
            increaseLabel={t("tools.increase")}
            onchange={(next) => {
              fret = next;
              edited();
            }}
          />
        </div>
      {:else if positionMode === "caged"}
        <label class="tool-field">
          <span>{t("exercises.shape")}</span>
          <select data-testid="exercise-shape" bind:value={shape}>
            {#each CAGED_SHAPES as item (item)}
              <option value={item}>{t("exercises.shapeName", { shape: item })}</option>
            {/each}
          </select>
        </label>
      {/if}
      <label class="tool-field">
        <span>{t("exercises.range")}</span>
        <select data-testid="exercise-range" bind:value={range}>
          {#each ["position", "octave", "twoOctaves"] as item (item)}
            <option value={item}>{t(`exercises.ranges.${item}`)}</option>
          {/each}
        </select>
      </label>
      <label class="tool-field">
        <span>{t("exercises.direction")}</span>
        <select data-testid="exercise-direction" bind:value={direction}>
          {#each ["up", "down", "both"] as item (item)}
            <option value={item}>{t(`exercises.directions.${item}`)}</option>
          {/each}
        </select>
      </label>
    {:else if kind === "spider"}
      <div class="tool-field">
        <span>{t("exercises.startFret")}</span>
        <SliderStepper
          label={t("exercises.startFret")}
          value={fret}
          min={1}
          max={19}
          testid="exercise-fret"
          decreaseLabel={t("tools.decrease")}
          increaseLabel={t("tools.increase")}
          onchange={(next) => {
            fret = next;
            edited();
          }}
        />
      </div>
      <label class="tool-field">
        <span>{t("exercises.fingers")}</span>
        <select data-testid="exercise-pattern" bind:value={spiderPattern}>
          {#each SPIDER_PATTERNS as item (item)}
            <option value={item}>{item.split("").join("-")}</option>
          {/each}
        </select>
      </label>
      <label class="tool-field">
        <span>{t("exercises.stringsDirection")}</span>
        <select data-testid="exercise-direction" bind:value={spiderDirection}>
          <option value="up">{t("exercises.lowToHigh")}</option>
          <option value="down">{t("exercises.highToLow")}</option>
        </select>
      </label>
      <div class="tool-field">
        <span>{t("exercises.shifts")}</span>
        <SliderStepper
          label={t("exercises.shifts")}
          value={shifts}
          min={0}
          max={8}
          testid="exercise-shifts"
          decreaseLabel={t("tools.decrease")}
          increaseLabel={t("tools.increase")}
          onchange={(next) => {
            shifts = next;
            edited();
          }}
        />
      </div>
    {:else}
      <label class="tool-field tool-field-full">
        <span>{t("exercises.chords")}</span>
        <input
          type="text"
          data-testid="exercise-chords"
          spellcheck="false"
          bind:value={chordList}
        />
        <span class="tool-field-help muted"
          >{t(kind === "changes" ? "exercises.chordsHelp" : "exercises.bassChordsHelp")}</span
        >
      </label>
      {#if kind === "changes"}
        <div class="tool-field">
          <span>{t("exercises.beatsEach")}</span>
          <SliderStepper
            label={t("exercises.beatsEach")}
            value={beatsEach}
            min={1}
            max={16}
            testid="exercise-beats"
            decreaseLabel={t("tools.decrease")}
            increaseLabel={t("tools.increase")}
            onchange={(next) => {
              beatsEach = next;
              edited();
            }}
          />
        </div>
        <label class="tool-field">
          <span>{t("exercises.strum")}</span>
          <select data-testid="exercise-strum" bind:value={strum}>
            {#each ["quarters", "eighths", "folk", "ballad", "pop"] as id (id)}
              <option value={id}>{t(`exercises.strums.${id}`)}</option>
            {/each}
          </select>
        </label>
      {:else}
        <label class="tool-field">
          <span>{t("exercises.bassPattern")}</span>
          <select data-testid="exercise-bass-pattern" bind:value={bassPattern}>
            {#each ["rootFifthOctave", "walking"] as id (id)}
              <option value={id}>{t(`exercises.bassPatterns.${id}`)}</option>
            {/each}
          </select>
        </label>
      {/if}
      <div class="tool-field">
        <span>{t("exercises.cycles")}</span>
        <SliderStepper
          label={t("exercises.cycles")}
          value={cycles}
          min={1}
          max={8}
          testid="exercise-cycles"
          decreaseLabel={t("tools.decrease")}
          increaseLabel={t("tools.increase")}
          onchange={(next) => {
            cycles = next;
            edited();
          }}
        />
      </div>
    {/if}

    {#if kind !== "changes" && kind !== "bass"}
      <label class="tool-field">
        <span>{t("exercises.rhythm")}</span>
        <select data-testid="exercise-rhythm" bind:value={rhythm}>
          {#each ["quarter", "eighth", "triplet", "sixteenth"] as id (id)}
            <option value={id}>{t(`exercises.rhythms.${id}`)}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>
{/snippet}

<style>
  .exercise-result {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    /* A grid item's default min-width is the score's width, which lets the
       preview paint over the settings. */
    min-width: 0;
  }
  .pickers {
    display: grid;
    gap: var(--sp-4);
  }
  .bpm-input {
    width: 6rem;
    text-align: center;
  }
  .start {
    width: 100%;
    justify-content: center;
  }
</style>
