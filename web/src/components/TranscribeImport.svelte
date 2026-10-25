<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "./Icon.svelte";
  import { t, tOr } from "../lib/i18n.svelte";
  import type { InstrumentPreset } from "../lib/types";

  type Stem = "mix" | "bass" | "guitar";
  type Grid = 4 | 8 | 16 | 32;

  let {
    file,
    presets,
    defaultPreset,
    busy,
    onimport,
    oncancel,
  }: {
    file: File;
    presets: InstrumentPreset[];
    defaultPreset: string;
    busy: boolean;
    onimport: (options: { stem: Stem; preset: string; grid: Grid }) => void;
    oncancel: () => void;
  } = $props();

  let stem = $state<Stem>("mix");
  let preset = $state(untrack(() => defaultPreset));
  let grid = $state<Grid>(16);

  const stemOptions: { value: Stem; label: string }[] = $derived([
    { value: "mix", label: t("transcribe.stemMix") },
    { value: "guitar", label: t("transcribe.stemGuitar") },
    { value: "bass", label: t("transcribe.stemBass") },
  ]);

  const gridOptions: { value: Grid; label: string }[] = $derived([
    { value: 4, label: t("asciiTab.grid4") },
    { value: 8, label: t("asciiTab.grid8") },
    { value: 16, label: t("asciiTab.grid16") },
    { value: 32, label: t("asciiTab.grid32") },
  ]);
</script>

<div class="track-picker" data-testid="transcribe-import">
  <h3>{t("transcribe.title")}</h3>
  <p class="muted">{t("transcribe.fileHint", { name: file.name })}</p>
  <div class="form-grid">
    <label class="field">
      <span>{t("transcribe.stem")}</span>
      <select data-testid="transcribe-import-stem" bind:value={stem}>
        {#each stemOptions as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>{t("transcribe.preset")}</span>
      <select data-testid="transcribe-import-preset" bind:value={preset}>
        {#each presets as item (item.id)}
          <option value={item.id}>{tOr(item.label_key, item.label)}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>{t("transcribe.grid")}</span>
      <select data-testid="transcribe-import-grid" bind:value={grid}>
        {#each gridOptions as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>
  </div>
  <div class="row">
    <button
      class="primary"
      data-testid="transcribe-import-submit"
      disabled={busy}
      onclick={() => onimport({ stem, preset, grid })}
    >
      <Icon name="sparkle" size={18} />{t("transcribe.start")}
    </button>
    <button class="ghost" type="button" disabled={busy} onclick={oncancel}
      >{t("transcribe.cancel")}</button
    >
  </div>
</div>
