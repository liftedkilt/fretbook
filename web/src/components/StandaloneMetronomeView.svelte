<script lang="ts">
  import Icon from "./Icon.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
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

  function onSignatureChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement;
    signature = target.value;
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

  function onSubdivisionsChange(event: Event) {
    const target = event.currentTarget as HTMLSelectElement;
    subdivisions = Number(target.value) || 1;
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

<Page width="page">
  <div class="tool-view" data-testid="standalone-metronome-view">
    <PageHeader
      title={t("tools.metronome")}
      titleSize="title"
      eyebrow={t("tools.nav")}
      backHref="/tools"
      backLabel={t("tools.heading")}
      backTestId="tool-back"
    />

    <div class="metronome-visual-container">
      <div
        class="metronome-visual"
        data-testid="metronome-visual"
        aria-label={`Beat ${currentBeat + 1} of ${beatsCount}`}
      >
        {#each Array.from({ length: beatsCount }, (_, i) => i) as i (i)}
          <div
            class="metronome-beat"
            class:metronome-beat-active={isPlaying && currentBeat === i}
            class:metronome-beat-sub={isPlaying && currentBeat === i && currentSub > 0}
            class:metronome-beat-accent={i === 0 && accentBeat1}
            data-testid={`metronome-beat-${i}`}
          >
            <span class="metronome-beat-number">{i + 1}</span>
          </div>
        {/each}
      </div>
    </div>

    <div class="metronome-tempo-box">
      <div class="metronome-bpm-display">
        <span class="metronome-bpm-number" data-testid="metronome-bpm-display">{bpm}</span>
        <span class="metronome-bpm-unit">{t("tools.bpm")}</span>
        <span class="metronome-tempo-name">{tempoName}</span>
      </div>

      <input
        type="range"
        class="metronome-slider"
        data-testid="metronome-bpm-slider"
        min={MIN_BPM}
        max={MAX_BPM}
        step="1"
        value={bpm}
        aria-label={t("tools.bpm")}
        oninput={(event) => setBpm(Number(event.currentTarget.value))}
      />

      <div class="metronome-steppers">
        <button
          class="button ghost stepper-btn"
          data-testid="metronome-bpm-minus-5"
          onclick={() => setBpm(bpm - 5)}
          aria-label="-5 BPM">-5</button
        >
        <button
          class="button ghost stepper-btn"
          data-testid="metronome-bpm-minus-1"
          onclick={() => setBpm(bpm - 1)}
          aria-label="-1 BPM">-1</button
        >
        <input
          type="number"
          class="metronome-number-input"
          data-testid="metronome-bpm-input"
          min={MIN_BPM}
          max={MAX_BPM}
          value={bpm}
          aria-label={t("tools.bpm")}
          oninput={(event) => setBpm(Number(event.currentTarget.value))}
        />
        <button
          class="button ghost stepper-btn"
          data-testid="metronome-bpm-plus-1"
          onclick={() => setBpm(bpm + 1)}
          aria-label="+1 BPM">+1</button
        >
        <button
          class="button ghost stepper-btn"
          data-testid="metronome-bpm-plus-5"
          onclick={() => setBpm(bpm + 5)}
          aria-label="+5 BPM">+5</button
        >
      </div>

      <button
        class="button metronome-tap-btn"
        data-testid="metronome-tap"
        onclick={onTap}
        title={t("tools.tapHint")}
      >
        <Icon name="tap" size={20} />
        <span>{t("tools.tapTempo")}</span>
      </button>
    </div>

    <div class="metronome-controls-grid">
      <label class="tool-field">
        <span>{t("tools.timeSignature")}</span>
        <select
          data-testid="metronome-time-signature"
          value={signature}
          onchange={onSignatureChange}
        >
          {#each TIME_SIGNATURES as sig (sig.id)}
            <option value={sig.id}>{sig.id}</option>
          {/each}
        </select>
      </label>

      <label class="tool-field">
        <span>{t("tools.subdivisions")}</span>
        <select
          data-testid="metronome-subdivisions"
          value={subdivisions}
          onchange={onSubdivisionsChange}
        >
          {#each SUBDIVISIONS as sub (sub.id)}
            <option value={sub.id}>{t(sub.labelKey)}</option>
          {/each}
        </select>
      </label>

      <div class="tool-field tool-field-toggle">
        <span>{t("tools.accentBeat1")}</span>
        <label class="tool-toggle">
          <input
            type="checkbox"
            data-testid="metronome-accent"
            checked={accentBeat1}
            onchange={onAccentChange}
          />
          {t("tools.accentBeat1")}
        </label>
      </div>

      <label class="tool-field">
        <span>{t("tools.volume")}</span>
        <span class="metronome-volume-row">
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
        </span>
      </label>
    </div>

    <div class="metronome-action-row">
      <button
        class="primary hero metronome-toggle-btn"
        data-testid="metronome-toggle"
        onclick={togglePlay}
      >
        <Icon name={isPlaying ? "pause" : "play"} size={22} />
        <span>{isPlaying ? t("tools.stop") : t("tools.start")}</span>
      </button>
    </div>
  </div>
</Page>
