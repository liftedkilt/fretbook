<script lang="ts">
  import Sheet from "./Sheet.svelte";
  import Tuner from "./Tuner.svelte";
  import { t } from "../lib/i18n.svelte";
  import { PRESETS, withCapo } from "../lib/tuner";
  import { closeSheet, ui } from "../lib/ui.svelte";

  const open = $derived(ui.sheet === "tuner");
  const request = $derived(ui.tunerRequest);

  let source = $state("chromatic");
  let withCapoOn = $state(false);

  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      source = request ? "song" : "chromatic";
      withCapoOn = false;
    }
    wasOpen = open;
  });

  const strings = $derived.by((): number[] | null => {
    if (source === "song" && request) {
      return withCapoOn ? withCapo(request.tuning, request.capo) : request.tuning;
    }
    return PRESETS.find((preset) => preset.id === source)?.midi ?? null;
  });
</script>

<Sheet
  {open}
  title={t("tuner.heading")}
  subtitle={request && source === "song" ? t("tuner.forSong") : ""}
  testid="tuner-sheet"
  onclose={closeSheet}
>
  <Tuner {strings} active={open}>
    {#snippet optionsSnippet()}
      <label class="tuner-field">
        <span>{t("tuner.tuning")}</span>
        <select
          data-testid="tuner-source"
          value={source}
          onchange={(event) => {
            source = event.currentTarget.value;
            withCapoOn = false;
          }}
        >
          {#if request}<option value="song">{t("tuner.songTuning")}</option>{/if}
          <option value="chromatic">{t("tuner.chromatic")}</option>
          {#each PRESETS as preset (preset.id)}
            <option value={preset.id}>{t(preset.labelKey)}</option>
          {/each}
        </select>
      </label>
    {/snippet}

    {#snippet togglesSnippet()}
      {#if source === "song" && request && request.capo > 0}
        <label class="tuner-capo">
          <input
            type="checkbox"
            data-testid="tuner-capo"
            checked={withCapoOn}
            onchange={(event) => (withCapoOn = event.currentTarget.checked)}
          />
          {t("tuner.capoOn", { fret: request.capo })}
        </label>
        <p class="muted tuner-hint">{t("tuner.capoHint", { fret: request.capo })}</p>
      {/if}
    {/snippet}
  </Tuner>
</Sheet>
