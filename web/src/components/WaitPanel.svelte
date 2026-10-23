<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { HINT_CHOICES, type WaitOptions } from "../lib/waitMode";

  // Wait mode settings. Edits `options` in place and tells the player through `onchange`.
  let {
    options,
    recording,
    onchange,
  }: { options: WaitOptions; recording: boolean; onchange: () => void } = $props();
</script>

<div class="panel-group" data-testid="wait-panel">
  <h3>{t("waitMode.title")}</h3>
  <p class="muted small">{t("waitMode.about")}{recording ? ` ${t("waitMode.noRecording")}` : ""}</p>
  <div class="mix-row">
    <label class="field compact-field">
      <span>{t("waitMode.octave")}</span>
      <select
        data-testid="wait-octave"
        value={options.octave}
        onchange={(event) => {
          options.octave = event.currentTarget.value === "exact" ? "exact" : "any";
          onchange();
        }}
      >
        <option value="any">{t("waitMode.octaveAny")}</option>
        <option value="exact">{t("waitMode.octaveExact")}</option>
      </select>
    </label>
    <label class="field compact-field">
      <span>{t("waitMode.hintAfter")}</span>
      <select
        data-testid="wait-hint-after"
        value={options.hintAfter}
        onchange={(event) => {
          options.hintAfter = Number(event.currentTarget.value);
          onchange();
        }}
      >
        {#each HINT_CHOICES as seconds (seconds)}
          <option value={seconds}>{t("waitMode.seconds", { count: seconds })}</option>
        {/each}
      </select>
    </label>
    <button
      class="button"
      data-testid="wait-backing"
      aria-pressed={options.backing}
      onclick={() => {
        options.backing = !options.backing;
        onchange();
      }}>{t("waitMode.backing")}</button
    >
  </div>
</div>
