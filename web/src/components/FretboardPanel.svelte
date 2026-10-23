<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { FRET_LABELS, pitchClassName } from "../lib/fretboard";
  import type { PracticeSettings } from "../lib/practice";

  // Switch and options for the fretboard under the score. `onchange` saves the options.
  let { practice, onchange }: { practice: PracticeSettings; onchange: () => void } = $props();
</script>

<div class="panel-group" data-testid="fretboard-panel">
  <h3>{t("fretboard.title")}</h3>
  <div class="mix-row">
    <label class="check">
      <input
        type="checkbox"
        data-testid="fretboard-on"
        checked={practice.fretboard.on}
        onchange={(event) => {
          practice.fretboard.on = event.currentTarget.checked;
          onchange();
        }}
      />
      {t("fretboard.show")}
    </label>
    <label class="check">
      <input
        type="checkbox"
        data-testid="fretboard-left"
        checked={practice.fretboard.leftHanded}
        onchange={(event) => {
          practice.fretboard.leftHanded = event.currentTarget.checked;
          onchange();
        }}
      />
      {t("fretboard.leftHanded")}
    </label>
    <label class="field compact-field">
      <span>{t("fretboard.labels")}</span>
      <select
        data-testid="fretboard-label"
        value={practice.fretboard.label}
        onchange={(event) => {
          practice.fretboard.label =
            FRET_LABELS.find((item) => item === event.currentTarget.value) ?? "names";
          onchange();
        }}
      >
        {#each FRET_LABELS as item (item)}
          <option value={item}
            >{t(`fretboard.label${item[0].toUpperCase()}${item.slice(1)}`)}</option
          >
        {/each}
      </select>
    </label>
    {#if practice.fretboard.label === "intervals"}
      <label class="field compact-field">
        <span>{t("fretboard.root")}</span>
        <select
          data-testid="fretboard-root"
          value={practice.fretboard.root === null ? "auto" : String(practice.fretboard.root)}
          onchange={(event) => {
            const value = event.currentTarget.value;
            practice.fretboard.root = value === "auto" ? null : Number(value);
            onchange();
          }}
        >
          <option value="auto">{t("fretboard.rootAuto")}</option>
          {#each Array.from({ length: 12 }, (_, index) => index) as pitch (pitch)}
            <option value={String(pitch)}>{pitchClassName(pitch)}</option>
          {/each}
        </select>
      </label>
    {/if}
  </div>
</div>
