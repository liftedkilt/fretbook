<script lang="ts">
  import { untrack } from "svelte";
  import Icon from "./Icon.svelte";
  import { t, tOr } from "../lib/i18n.svelte";
  import {
    buildOptions,
    clampCapo,
    DEFAULT_MIDI_GRID,
    initialChoices,
    rangeLabel,
    toggleTrack,
    type MidiGrid,
    type MidiImportOptions,
  } from "../lib/midiImport";
  import type { MidiInspection } from "../lib/api-types";
  import type { InstrumentPreset } from "../lib/types";

  let {
    info,
    presets,
    busy,
    onimport,
    oncancel,
  }: {
    info: MidiInspection;
    presets: InstrumentPreset[];
    busy: boolean;
    onimport: (options: MidiImportOptions) => void;
    oncancel: () => void;
  } = $props();

  // The dialog is remounted for each file, so the first reading of `info` is the one that matters.
  const start = untrack(() => initialChoices(info));
  let selected = $state(start.selected);
  let chosen = $state<Record<string, string>>(start.presets);
  let capo = $state(0);
  let grid = $state<MidiGrid>(DEFAULT_MIDI_GRID);

  const gridOptions: { value: MidiGrid; label: string }[] = $derived([
    { value: 4, label: t("midi.grid4") },
    { value: 8, label: t("midi.grid8") },
    { value: 16, label: t("midi.grid16") },
    { value: 32, label: t("midi.grid32") },
  ]);

  function presetLabel(item: InstrumentPreset): string {
    return tOr(item.label_key, item.label);
  }
</script>

<div class="track-picker" data-testid="midi-import">
  <h3>{t("midi.heading")}</h3>
  <p class="muted">{t("midi.hint", { title: info.title || t("midi.untitled") })}</p>
  {#if info.tracks.length === 0}
    <p class="notice" data-testid="midi-empty">{t("midi.noParts")}</p>
  {/if}
  <div class="choice-list">
    {#each info.tracks as track (track.id)}
      <div class="choice" data-testid={`midi-part-${track.id}`}>
        <input
          type="checkbox"
          aria-label={track.name}
          checked={selected.includes(track.id)}
          onchange={(event) =>
            (selected = toggleTrack(selected, track.id, event.currentTarget.checked))}
        />
        <span class="choice-text">
          <strong>{track.name}</strong>
          <small>
            {t("midi.partSummary", {
              notes: track.notes,
              range: rangeLabel(track),
              channel: track.channel,
            })}
            {#if !track.in_range}· {t("midi.outOfRange")}{/if}
          </small>
        </span>
        <select
          aria-label={t("midi.instrumentFor", { name: track.name })}
          data-testid={`midi-preset-${track.id}`}
          value={chosen[track.id]}
          onchange={(event) => (chosen = { ...chosen, [track.id]: event.currentTarget.value })}
        >
          {#each presets as item (item.id)}
            <option value={item.id}>{presetLabel(item)}</option>
          {/each}
        </select>
      </div>
    {/each}
  </div>
  {#if info.drum_notes > 0}<p class="muted">{t("midi.drumsSkipped")}</p>{/if}
  <div class="form-grid">
    <label class="field">
      <span>{t("midi.grid")}</span>
      <select data-testid="midi-grid" bind:value={grid}>
        {#each gridOptions as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>
    <label class="field">
      <span>{t("midi.capo")}</span>
      <input
        data-testid="midi-capo"
        type="number"
        min="0"
        max="24"
        value={capo}
        onchange={(event) => {
          capo = clampCapo(Number(event.currentTarget.value));
          event.currentTarget.value = String(capo);
        }}
      />
    </label>
  </div>
  <p class="muted">{t("midi.gridHint")}</p>
  <div class="row">
    <button
      class="primary"
      data-testid="midi-submit"
      disabled={busy || selected.length === 0}
      onclick={() => onimport(buildOptions(info, { selected, presets: chosen }, capo, grid))}
    >
      <Icon name="check" size={18} />{t("midi.import")}
    </button>
    <button class="ghost" type="button" disabled={busy} onclick={oncancel}
      >{t("midi.cancel")}</button
    >
  </div>
</div>
