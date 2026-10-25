<script lang="ts">
  import Icon from "./Icon.svelte";
  import SegmentedControl from "./ui/SegmentedControl.svelte";
  import SliderStepper from "./ui/SliderStepper.svelte";
  import ToolPage from "./ui/ToolPage.svelte";
  import { Clicker } from "../lib/clicker";
  import { t } from "../lib/i18n.svelte";
  import {
    DEFAULT_BPM,
    MAX_BPM,
    MIN_BPM,
    MetronomeEngine,
    SUBDIVISIONS,
    TIME_SIGNATURES,
    TapTempoTracker,
    clampBpm,
    loadMetronomeConfig,
    saveMetronomeConfig,
    tempoMarking,
    type MetronomeConfig,
  } from "../lib/metronome";

  const config = loadMetronomeConfig();
  let bpm = $state(config.bpm || DEFAULT_BPM);
  let signature = $state(config.signature || "4/4");
  let accentBeat1 = $state(config.accentBeat1 !== false);
  let subdivisions = $state(config.subdivisions || 1);
  let volume = $state(typeof config.volume === "number" ? config.volume : 0.7);

  let isPlaying = $state(false);
  let currentBeat = $state(0);
  let currentSub = $state(0);

  const clicker = new Clicker();
  const tapTracker = new TapTempoTracker();

  let engine: MetronomeEngine | null = null;

  const currentSig = $derived(
    TIME_SIGNATURES.find((s) => s.id === signature) ?? TIME_SIGNATURES[2],
  );
  const beatsCount = $derived(currentSig.beats);
  const tempoName = $derived(tempoMarking(bpm));

  function currentConfig(): MetronomeConfig {
    return {
      bpm,
      signature,
      accentBeat1,
      subdivisions,
      volume,
    };
  }

  function persist() {
    saveMetronomeConfig(currentConfig());
  }

  function ensureEngine(): MetronomeEngine {
    if (!engine) {
      engine = new MetronomeEngine(clicker, currentConfig(), (beat, sub) => {
        currentBeat = beat;
        currentSub = sub;
      });
    }
    return engine;
  }

  function togglePlay() {
    const inst = ensureEngine();
    if (isPlaying) {
      inst.stop();
      isPlaying = false;
      currentBeat = 0;
      currentSub = 0;
    } else {
      inst.updateConfig(currentConfig());
      inst.start();
      isPlaying = true;
    }
  }

  function setBpm(next: number) {
    bpm = clampBpm(next);
    persist();
    engine?.updateConfig({ bpm });
  }

  function onTap() {
    const calculated = tapTracker.tap();
    if (calculated !== null) {
      setBpm(calculated);
    }
  }

  function onSignatureChange(next: string) {
    signature = next;
    currentBeat = 0;
    persist();
    engine?.updateConfig({ signature });
  }

  function onAccentChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    accentBeat1 = target.checked;
    persist();
    engine?.updateConfig({ accentBeat1 });
  }

  function onSubdivisionsChange(next: string) {
    subdivisions = Number(next) || 1;
    currentSub = 0;
    persist();
    engine?.updateConfig({ subdivisions });
  }

  function onVolumeChange(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    volume = Number(target.value);
    persist();
    engine?.updateConfig({ volume });
  }

  $effect(() => () => {
    engine?.stop();
    clicker.close();
  });
</script>

<ToolPage title={t("tools.metronome")} testid="standalone-metronome-view">
  {#snippet stage()}
    <div
      class="beats"
      data-testid="metronome-visual"
      role="img"
      aria-label={t("tools.beat", { current: currentBeat + 1, total: beatsCount })}
    >
      {#each Array.from({ length: beatsCount }, (_, i) => i) as i (i)}
        <div
          class="beat"
          class:active={isPlaying && currentBeat === i}
          class:sub={isPlaying && currentBeat === i && currentSub > 0}
          class:accent={i === 0 && accentBeat1}
          data-testid={`metronome-beat-${i}`}
        >
          <span>{i + 1}</span>
        </div>
      {/each}
    </div>

    <div class="readout">
      <span class="bpm display" data-testid="metronome-bpm-display">{bpm}</span>
      <span class="unit">{t("tools.bpm")} · {tempoName}</span>
    </div>

    <button class="primary hero start" data-testid="metronome-toggle" onclick={togglePlay}>
      <Icon name={isPlaying ? "pause" : "play"} size={22} />
      <span>{isPlaying ? t("tools.stop") : t("tools.start")}</span>
    </button>
  {/snippet}

  {#snippet settings()}
    <div class="field">
      <span class="label">{t("tools.tempo")}</span>
      <SliderStepper
        label={t("tools.bpm")}
        value={bpm}
        min={MIN_BPM}
        max={MAX_BPM}
        testid="metronome-bpm-slider"
        decreaseLabel={t("tools.slower")}
        increaseLabel={t("tools.faster")}
        decreaseTestId="metronome-bpm-minus-1"
        increaseTestId="metronome-bpm-plus-1"
        onchange={(next) => setBpm(next)}
      />
      <div class="tempo-row">
        <input
          type="number"
          class="bpm-input"
          data-testid="metronome-bpm-input"
          min={MIN_BPM}
          max={MAX_BPM}
          value={bpm}
          aria-label={t("tools.bpm")}
          oninput={(event) => setBpm(Number(event.currentTarget.value))}
        />
        <button
          class="button"
          data-testid="metronome-tap"
          onclick={onTap}
          title={t("tools.tapHint")}
        >
          <Icon name="tap" size={20} />
          <span>{t("tools.tapTempo")}</span>
        </button>
      </div>
    </div>

    <div class="field">
      <span class="label">{t("tools.timeSignature")}</span>
      <SegmentedControl
        label={t("tools.timeSignature")}
        value={signature}
        testid="metronome-time-signature"
        options={TIME_SIGNATURES.map((sig) => ({
          value: sig.id,
          label: sig.id,
          testid: `metronome-time-signature-${sig.id.replace("/", "-")}`,
        }))}
        onchange={onSignatureChange}
      />
    </div>

    <div class="field">
      <span class="label">{t("tools.subdivisions")}</span>
      <SegmentedControl
        label={t("tools.subdivisions")}
        value={String(subdivisions)}
        testid="metronome-subdivisions"
        options={SUBDIVISIONS.map((sub) => ({
          value: String(sub.id),
          label: t(sub.labelKey),
          testid: `metronome-subdivisions-${sub.id}`,
        }))}
        onchange={onSubdivisionsChange}
      />
    </div>

    <label class="switch">
      <input
        type="checkbox"
        data-testid="metronome-accent"
        checked={accentBeat1}
        onchange={onAccentChange}
      />
      <span class="switch-track" aria-hidden="true"></span>
      {t("tools.accentBeat1")}
    </label>

    <div class="field">
      <span class="label">{t("tools.volume")}</span>
      <div class="volume">
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          data-testid="metronome-volume"
          aria-label={t("tools.volume")}
          oninput={onVolumeChange}
        />
        <output data-testid="metronome-volume-value">{Math.round(volume * 100)}%</output>
      </div>
    </div>
  {/snippet}
</ToolPage>

<style>
  .beats {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--sp-3);
  }

  .beat {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border: 2px solid var(--line-strong);
    border-radius: 50%;
    background: var(--surface-2);
    color: var(--text-2);
    font-weight: 700;
    transition:
      transform 80ms var(--ease),
      background-color 80ms var(--ease),
      border-color 80ms var(--ease);
  }

  .beat.accent {
    border-color: var(--accent);
  }

  .beat.active {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
    transform: scale(1.18);
  }

  .beat.sub {
    opacity: 0.85;
    transform: scale(1.08);
  }

  .readout {
    display: grid;
    justify-items: center;
    gap: var(--sp-1);
  }

  .bpm {
    font-size: var(--fs-hero-num);
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .unit {
    color: var(--text-2);
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .start {
    width: 100%;
    justify-content: center;
  }

  .field {
    display: grid;
    gap: var(--sp-2);
    min-width: 0;
  }

  .label {
    color: var(--text-2);
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .tempo-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }

  .bpm-input {
    width: 6rem;
    text-align: center;
  }

  .volume {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }

  .volume input {
    flex: 1;
    min-height: 44px;
  }

  .volume output {
    min-width: 3rem;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  @media (prefers-reduced-motion: reduce) {
    .beat {
      transition: none;
    }
  }
</style>
