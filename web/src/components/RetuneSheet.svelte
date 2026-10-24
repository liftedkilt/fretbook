<script lang="ts">
  import { untrack } from "svelte";

  import Icon from "./Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import TabPreview from "./TabPreview.svelte";
  import { convertTrack, type ConvertOutcome } from "../lib/api";
  import { t, tOr } from "../lib/i18n.svelte";
  import {
    buildConvertBody,
    clamp,
    defaultChoices,
    isNoChange,
    MAX_CAPO,
    MAX_SEMITONES,
    parseTuning,
    presetsFor,
    reportLines,
    RETUNE_GOALS,
    showsCapo,
    showsSemitones,
    showsTuning,
    type RetuneChoices,
    type RetuneGoal,
  } from "../lib/retune";
  import { tuningLabel } from "../lib/tuning";
  import type { InstrumentPreset, TabSong, Track } from "../lib/types";

  let {
    open,
    song,
    track,
    presets,
    onclose,
    onsaved,
  }: {
    open: boolean;
    song: TabSong;
    track: Track;
    presets: InstrumentPreset[];
    onclose: () => void;
    /** The saved song and the track to show: the new one after Add, the same one after Replace. */
    onsaved: (song: TabSong, trackId: string) => void;
  } = $props();

  let choices = $state<RetuneChoices>(untrack(() => defaultChoices("transpose", track, presets)));
  let name = $state("");
  let outcome = $state<ConvertOutcome | null>(null);
  let working = $state(false);
  let saving = $state(false);
  let error = $state("");

  const goalLabels: Record<RetuneGoal, string> = $derived({
    transpose: t("retune.goalTranspose"),
    retune: t("retune.goalRetune"),
    shapes: t("retune.goalShapes"),
    convert: t("retune.goalConvert"),
    bassLine: t("retune.goalBassLine"),
    bassRoots: t("retune.goalBassRoots"),
  });
  const choosable = $derived(presetsFor(choices.goal, track, presets));
  const tuningProblem = $derived.by(() => {
    if (!showsTuning(choices.goal)) return "";
    const parsed = parseTuning(choices.tuning);
    if (!parsed) return t("retune.tuningInvalid");
    if (choices.goal === "shapes" && parsed.length !== track.tuning_midi.length) {
      return t("retune.tuningStrings");
    }
    return "";
  });
  const body = $derived(buildConvertBody(track, choices));
  const unchanged = $derived(body !== null && isNoChange(body));
  const previewScore = $derived(outcome ? { ...song.document, tracks: [outcome.track] } : null);

  function begin(goal: RetuneGoal) {
    choices = defaultChoices(goal, track, presets);
    name = "";
  }

  // Start from the current track each time the sheet opens.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      begin("transpose");
      outcome = null;
      error = "";
    }
    wasOpen = open;
  });

  // Preview after the choices settle; a slower, older answer never overwrites a newer one.
  let ticket = 0;
  $effect(() => {
    const request = open && !unchanged ? body : null;
    const mine = ++ticket;
    if (!request) {
      outcome = null;
      working = false;
      return;
    }
    working = true;
    const timer = setTimeout(() => {
      convertTrack(song.id, request)
        .then((result) => {
          if (mine !== ticket) return;
          outcome = result;
          error = "";
        })
        .catch((err: unknown) => {
          if (mine !== ticket) return;
          outcome = null;
          error = err instanceof Error ? err.message : t("retune.previewFailed");
        })
        .finally(() => {
          if (mine === ticket) working = false;
        });
    }, 250);
    return () => clearTimeout(timer);
  });

  function pickPreset(id: string) {
    const item = presets.find((preset) => preset.id === id);
    choices = {
      ...choices,
      preset: id,
      tuning: item ? tuningLabel(item.tuning_midi) : choices.tuning,
    };
  }

  async function save(mode: "add" | "replace") {
    if (!body || saving) return;
    saving = true;
    error = "";
    try {
      const label = t("retune.labelConverted");
      const trackName =
        name.trim() ||
        (mode === "add" ? t("retune.newTrackName", { name: track.name, label }) : track.name);
      const result = await convertTrack(song.id, {
        ...body,
        mode,
        revision: song.revision,
        name: trackName,
      });
      const saved = result.song as TabSong | null;
      if (!saved) return;
      const index = song.document.tracks.findIndex((item) => item.id === track.id);
      const shown =
        mode === "add" ? saved.document.tracks[index + 1] : saved.document.tracks[index];
      onsaved(saved, (shown ?? saved.document.tracks[0]).id);
    } catch (err) {
      error = err instanceof Error ? err.message : t("retune.previewFailed");
    } finally {
      saving = false;
    }
  }
</script>

<Sheet
  {open}
  title={t("retune.title")}
  subtitle={t("retune.subtitle", { track: track.name, tuning: tuningLabel(track.tuning_midi) })}
  testid="retune-sheet"
  {onclose}
>
  <div class="retune">
    <p class="muted">{t("retune.goalHint")}</p>
    <label class="field">
      <span>{t("retune.goal")}</span>
      <select
        data-testid="retune-goal"
        value={choices.goal}
        onchange={(event) => begin(event.currentTarget.value as RetuneGoal)}
      >
        {#each RETUNE_GOALS as goal (goal)}
          <option value={goal}>{goalLabels[goal]}</option>
        {/each}
      </select>
    </label>

    <div class="form-grid">
      {#if showsSemitones(choices.goal)}
        <label class="field">
          <span>{t("retune.semitones")}</span>
          <input
            data-testid="retune-semitones"
            type="number"
            min={-MAX_SEMITONES}
            max={MAX_SEMITONES}
            value={choices.semitones}
            onchange={(event) => {
              const next = clamp(Number(event.currentTarget.value), -MAX_SEMITONES, MAX_SEMITONES);
              choices = { ...choices, semitones: next };
              event.currentTarget.value = String(next);
            }}
          />
          <small class="muted">{t("retune.semitonesHint")}</small>
        </label>
      {/if}
      {#if showsCapo(choices.goal)}
        <label class="field">
          <span>{t("retune.capo")}</span>
          <input
            data-testid="retune-capo"
            type="number"
            min="0"
            max={MAX_CAPO}
            value={choices.capo}
            onchange={(event) => {
              const next = clamp(Number(event.currentTarget.value), 0, MAX_CAPO);
              choices = { ...choices, capo: next };
              event.currentTarget.value = String(next);
            }}
          />
        </label>
      {/if}
    </div>

    {#if showsTuning(choices.goal)}
      <label class="field">
        <span>{t("retune.instrument")}</span>
        <select
          data-testid="retune-preset"
          value={choices.preset}
          onchange={(event) => pickPreset(event.currentTarget.value)}
        >
          <option value="">{t("retune.instrumentKeep")}</option>
          {#each choosable as item (item.id)}
            <option value={item.id}>{tOr(item.label_key, item.label)}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span>{t("retune.tuning")}</span>
        <input
          data-testid="retune-tuning"
          type="text"
          value={choices.tuning}
          aria-invalid={tuningProblem ? "true" : undefined}
          oninput={(event) =>
            (choices = { ...choices, tuning: event.currentTarget.value, preset: "" })}
        />
        <small class="muted">{t("retune.tuningHint")}</small>
      </label>
      {#if tuningProblem}<p class="alert" role="alert">{tuningProblem}</p>{/if}
    {/if}

    <label class="field">
      <span>{t("retune.name")}</span>
      <input
        data-testid="retune-name"
        type="text"
        maxlength="80"
        placeholder={t("retune.newTrackName", {
          name: track.name,
          label: t("retune.labelConverted"),
        })}
        bind:value={name}
      />
    </label>

    <section class="retune-preview" aria-live="polite" data-testid="retune-preview">
      <h3>{t("retune.preview")}</h3>
      {#if unchanged}
        <p class="muted" data-testid="retune-nothing">{t("retune.nothingToDo")}</p>
      {:else if working}
        <p class="muted" role="status">{t("retune.previewing")}</p>
      {:else if outcome && previewScore}
        <ul class="retune-report" data-testid="retune-report">
          {#each reportLines(outcome.report) as line (line.key)}
            <li>{t(line.key, line.params)}</li>
          {/each}
        </ul>
        {#key outcome}
          <TabPreview score={previewScore} title={song.title} />
        {/key}
      {/if}
      {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
    </section>

    <div class="row">
      <button
        class="primary"
        data-testid="retune-add"
        disabled={!outcome || working || saving || unchanged}
        onclick={() => void save("add")}
      >
        <Icon name="check" size={18} />{saving ? t("retune.saving") : t("retune.add")}
      </button>
      <button
        data-testid="retune-replace"
        disabled={!outcome || working || saving || unchanged}
        onclick={() => void save("replace")}
      >
        {t("retune.replace")}
      </button>
      <button class="ghost" type="button" disabled={saving} onclick={onclose}
        >{t("retune.cancel")}</button
      >
    </div>
    <p class="muted">{t("retune.replaceHint")}</p>
  </div>
</Sheet>

<style>
  .retune {
    display: grid;
    gap: 0.9rem;
  }
  .retune-preview h3 {
    margin: 0 0 0.4rem;
    font-size: 1rem;
  }
  .retune-report {
    margin: 0 0 0.6rem;
    padding-left: 1.2rem;
  }
</style>
