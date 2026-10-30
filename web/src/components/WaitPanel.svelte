<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { PracticeSettings } from "../lib/practice";

  // Wait mode switch and options. `onchange` saves the options; `ontoggle` opens or closes the microphone.
  let {
    practice,
    on,
    available,
    usesSynth = false,
    error,
    onchange,
    ontoggle,
    hideToggle = false,
  }: {
    practice: PracticeSettings;
    on: boolean;
    available: boolean;
    /** A recording is attached: wait mode plays the synth for the run. */
    usesSynth?: boolean;
    error: string;
    onchange: () => void;
    ontoggle: () => void;
    /** The practice mode card is the switch; keep the options. */
    hideToggle?: boolean;
  } = $props();
</script>

<div class="panel-group" data-testid="wait-panel">
  {#if !hideToggle}<h3>{t("wait.title")}</h3>{/if}
  {#if available}
    <p class="muted small">{t("wait.about")}</p>
    {#if usesSynth}<p class="muted small" data-testid="wait-uses-synth">
        {t("wait.usesSynth")}
      </p>{/if}
    <div class="mix-row">
      {#if !hideToggle}
        <button class="button" data-testid="wait-toggle" aria-pressed={on} onclick={ontoggle}
          ><Icon name="hourglass" size={16} />{on ? t("wait.stop") : t("wait.start")}</button
        >
      {/if}
      <label class="check">
        <input
          type="checkbox"
          data-testid="wait-any-octave"
          checked={practice.wait.anyOctave}
          onchange={(event) => {
            practice.wait.anyOctave = event.currentTarget.checked;
            onchange();
          }}
        />
        {t("wait.anyOctave")}
      </label>
      <label class="check">
        <input
          type="checkbox"
          data-testid="wait-silent"
          checked={practice.wait.silent}
          onchange={(event) => {
            practice.wait.silent = event.currentTarget.checked;
            onchange();
          }}
        />
        {t("wait.silent")}
      </label>
      <label class="check">
        <input
          type="checkbox"
          data-testid="wait-chords"
          checked={practice.wait.chords}
          onchange={(event) => {
            practice.wait.chords = event.currentTarget.checked;
            onchange();
          }}
        />
        {t("chordWait.option")}
      </label>
      <label class="field compact-field">
        <span>{t("wait.hintAfter")}</span>
        <input
          type="number"
          min="1"
          max="30"
          data-testid="wait-hint-seconds"
          value={practice.wait.hintSeconds}
          onchange={(event) => {
            const seconds = Number(event.currentTarget.value);
            if (seconds >= 1 && seconds <= 30) practice.wait.hintSeconds = Math.round(seconds);
            onchange();
          }}
        />
      </label>
    </div>
    {#if error}<p class="alert" role="alert" data-testid="wait-error">
        <Icon name="alert" size={18} />{error}
      </p>{/if}
  {:else}
    <p class="muted small" data-testid="wait-unavailable">{t("wait.needsSynth")}</p>
  {/if}
</div>
