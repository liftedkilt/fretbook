<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import {
    defaultTrackMix,
    trackMix,
    type CountInBars,
    type PracticeSettings,
    type TrackMix,
  } from "../lib/practice";

  // Metronome, count-in and mixer. Edits `practice` in place and tells the player through `onchange`.
  let {
    practice,
    hasAudio,
    tracks,
    onchange,
  }: {
    practice: PracticeSettings;
    hasAudio: boolean;
    tracks: { id: string; name: string }[];
    onchange: () => void;
  } = $props();

  function balanceText(balance: number): string {
    if (balance === 0) return t("practice.balanceRecording");
    if (balance === 1) return t("practice.balanceSynth");
    return `${percent(1 - balance)} / ${percent(balance)}`;
  }

  const countOptions: CountInBars[] = [0, 1, 2];

  // Rendering must not write state, so a track nobody touched is only created when it is edited.
  function edit(id: string, change: (mix: TrackMix) => void) {
    change((practice.mix.tracks[id] ??= defaultTrackMix()));
    onchange();
  }

  function percent(value: number): string {
    return `${Math.round(value * 100)}%`;
  }
</script>

<div class="panel-group" data-testid="practice-panel">
  <h3>{t("practice.metronome")}</h3>
  <div class="mix-row">
    <button
      class="button"
      data-testid="metronome-toggle"
      aria-pressed={practice.metronome.on}
      onclick={() => {
        practice.metronome.on = !practice.metronome.on;
        onchange();
      }}><Icon name="gauge" size={16} />{t("practice.metronome")}</button
    >
    <label class="mix-slider">
      <span>{t("practice.volume")}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={practice.metronome.volume}
        aria-label={t("practice.metronomeVolume")}
        data-testid="metronome-volume"
        oninput={(event) => {
          practice.metronome.volume = Number(event.currentTarget.value);
          onchange();
        }}
      />
      <output>{percent(practice.metronome.volume)}</output>
    </label>
  </div>
</div>

<div class="panel-group">
  <h3>{t("practice.countIn")}</h3>
  <div class="mix-row">
    <div class="segmented" role="radiogroup" aria-label={t("practice.countIn")}>
      {#each countOptions as bars (bars)}
        <button
          data-testid={`count-in-${bars}`}
          role="radio"
          aria-checked={practice.countIn.bars === bars}
          onclick={() => {
            practice.countIn.bars = bars;
            onchange();
          }}
          >{bars === 0
            ? t("practice.countInOff")
            : t("practice.countInBars", { count: bars })}</button
        >
      {/each}
    </div>
    {#if hasAudio}
      <label class="check">
        <input
          type="checkbox"
          data-testid="count-in-loops"
          checked={practice.countIn.beforeLoops}
          onchange={(event) => {
            practice.countIn.beforeLoops = event.currentTarget.checked;
            onchange();
          }}
        />
        {t("practice.countInLoops")}
      </label>
    {/if}
  </div>
</div>

<div class="panel-group">
  <h3>{t("practice.mixer")}</h3>
  <label class="mix-slider">
    <span>{hasAudio ? t("practice.recording") : t("practice.synth")}</span>
    <input
      type="range"
      min="0"
      max="1"
      step="0.05"
      value={hasAudio ? practice.mix.audio : practice.mix.synth}
      aria-label={hasAudio ? t("practice.recording") : t("practice.synth")}
      data-testid="mix-master"
      oninput={(event) => {
        const value = Number(event.currentTarget.value);
        if (hasAudio) practice.mix.audio = value;
        else practice.mix.synth = value;
        onchange();
      }}
    />
    <output>{percent(hasAudio ? practice.mix.audio : practice.mix.synth)}</output>
  </label>
  {#if hasAudio}
    <label class="mix-slider">
      <span>{t("practice.balance")}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={practice.mix.balance}
        aria-label={t("practice.balanceLabel")}
        aria-valuetext={balanceText(practice.mix.balance)}
        data-testid="mix-balance"
        oninput={(event) => {
          practice.mix.balance = Number(event.currentTarget.value);
          onchange();
        }}
      />
      <output>{balanceText(practice.mix.balance)}</output>
    </label>
    {#if practice.mix.balance === 0}
      <p class="muted small">{t("practice.synthOff")}</p>
    {/if}
  {/if}
  {#each tracks as item (item.id)}
    {@const mix = trackMix(practice, item.id)}
    <div class="mix-row" data-testid={`mix-track-${item.id}`}>
      <span class="mix-name">{item.name}</span>
      <button
        class="button"
        aria-pressed={mix.mute}
        aria-label={t("practice.muteTrack", { name: item.name })}
        data-testid={`mute-${item.id}`}
        onclick={() => {
          edit(item.id, (target) => (target.mute = !target.mute));
        }}>{t("practice.mute")}</button
      >
      <button
        class="button"
        aria-pressed={mix.solo}
        aria-label={t("practice.soloTrack", { name: item.name })}
        data-testid={`solo-${item.id}`}
        onclick={() => {
          edit(item.id, (target) => (target.solo = !target.solo));
        }}>{t("practice.solo")}</button
      >
      <input
        class="mix-track-volume"
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={mix.volume}
        aria-label={t("practice.trackVolume", { name: item.name })}
        oninput={(event) => {
          const value = Number(event.currentTarget.value);
          edit(item.id, (target) => (target.volume = value));
        }}
      />
    </div>
  {/each}
</div>
