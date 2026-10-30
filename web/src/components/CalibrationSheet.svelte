<script lang="ts">
  import Icon from "./Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import { getCalibration, saveCalibration as apiSaveCalibration } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import {
    CalibrationWizard,
    getLocalCalibration,
    isBluetoothDevice,
    listOutputDevices,
    setLocalCalibration,
    type AudioDevice,
    type CalibrationProgress,
    type CalibrationResult,
  } from "../lib/listen/calibration";
  import { saveDevice, saveOutput } from "../lib/listen/devicePrefs";
  import { listInputDevices, type InputDevice } from "../lib/listen/input";
  import { closeSheet, ui } from "../lib/ui.svelte";

  let outputDevices = $state<AudioDevice[]>([]);
  let inputDevices = $state<InputDevice[]>([]);
  let selectedOutput = $state("default");
  let selectedInput = $state("default");

  let offsetMs = $state(0);
  let jitterMs = $state<number | null>(null);
  let loadedCalibration = $state<{ offset_ms: number; jitter_ms: number | null } | null>(null);

  let isCalibrating = $state(false);
  let progress = $state<CalibrationProgress | null>(null);
  let result = $state<CalibrationResult | null>(null);
  let tapFlash = $state(false);
  let saveMessage = $state("");
  let errorMessage = $state("");

  let wizard: CalibrationWizard | null = null;
  let flashTimeout: ReturnType<typeof setTimeout> | null = null;
  let loadSequence = 0;

  const activeOutputDevice = $derived(
    outputDevices.find((d) => d.deviceId === selectedOutput) ?? {
      deviceId: selectedOutput,
      label: selectedOutput === "default" ? t("calibration.defaultDevice") : selectedOutput,
    },
  );

  const _activeInputDevice = $derived(
    inputDevices.find((d) => d.deviceId === selectedInput) ?? {
      deviceId: selectedInput,
      label: selectedInput === "default" ? t("calibration.defaultDevice") : selectedInput,
    },
  );

  const isBluetooth = $derived(isBluetoothDevice(activeOutputDevice.label));

  async function loadDevices() {
    try {
      const [outputs, inputs] = await Promise.all([listOutputDevices(), listInputDevices()]);
      outputDevices = outputs;
      inputDevices = inputs;
      if (outputs.length > 0 && !outputs.some((d) => d.deviceId === selectedOutput)) {
        selectedOutput = outputs[0].deviceId;
      }
      if (inputs.length > 0 && !inputs.some((d) => d.deviceId === selectedInput)) {
        selectedInput = inputs[0].deviceId;
      }
      await loadCurrentCalibration(selectedOutput, selectedInput);
    } catch {
      // Keep defaults
    }
  }

  async function loadCurrentCalibration(output: string, input: string) {
    const seq = ++loadSequence;
    saveMessage = "";
    errorMessage = "";
    try {
      const saved = await getCalibration(output, input);
      if (seq !== loadSequence || isCalibrating || result) return;
      if (saved) {
        loadedCalibration = { offset_ms: saved.offset_ms, jitter_ms: saved.jitter_ms ?? null };
        offsetMs = saved.offset_ms;
        jitterMs = saved.jitter_ms ?? null;
        return;
      }
    } catch {
      // Fallback to local storage
    }

    if (seq !== loadSequence || isCalibrating || result) return;
    const local = getLocalCalibration(output, input);
    if (local !== null) {
      loadedCalibration = { offset_ms: local, jitter_ms: null };
      offsetMs = local;
      jitterMs = null;
    } else {
      loadedCalibration = null;
      offsetMs = 0;
      jitterMs = null;
    }
  }

  $effect(() => {
    if (ui.sheet === "calibration") {
      void loadDevices();
    } else {
      stopWizard();
    }
  });

  function onOutputChange(deviceId: string) {
    selectedOutput = deviceId;
    void loadCurrentCalibration(selectedOutput, selectedInput);
  }

  function onInputChange(deviceId: string) {
    selectedInput = deviceId;
    void loadCurrentCalibration(selectedOutput, selectedInput);
  }

  function triggerTapFlash() {
    tapFlash = true;
    if (flashTimeout) clearTimeout(flashTimeout);
    flashTimeout = setTimeout(() => {
      tapFlash = false;
    }, 250);
  }

  async function startWizard() {
    errorMessage = "";
    saveMessage = "";
    result = null;
    isCalibrating = true;
    progress = {
      phase: "calibrating",
      clickIndex: 0,
      totalClicks: 12,
      detectedCount: 0,
    };

    wizard = new CalibrationWizard();
    try {
      const res = await wizard.run({
        outputDeviceId: selectedOutput,
        inputDeviceId: selectedInput,
        clickInterval: 0.5,
        clickCount: 10,
        leadInClicks: 2,
        onProgress: (p) => {
          progress = p;
        },
        onDetectedOnset: () => {
          triggerTapFlash();
        },
      });
      result = res;
      offsetMs = res.medianOffsetMs;
      jitterMs = res.jitterMs;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : t("error.generic");
    } finally {
      isCalibrating = false;
      wizard = null;
    }
  }

  function stopWizard() {
    if (wizard) {
      void wizard.cancel();
      wizard = null;
    }
    isCalibrating = false;
    progress = null;
  }

  async function save() {
    saveMessage = "";
    errorMessage = "";
    setLocalCalibration(selectedOutput, selectedInput, offsetMs);
    saveOutput(selectedOutput);
    saveDevice(selectedInput === "default" ? "" : selectedInput);
    try {
      await apiSaveCalibration({
        output_device: selectedOutput,
        input_device: selectedInput,
        offset_ms: offsetMs,
        jitter_ms: jitterMs,
      });
      loadedCalibration = { offset_ms: offsetMs, jitter_ms: jitterMs };
      saveMessage = t("calibration.saved");
    } catch {
      // Local storage saved; show saved message
      loadedCalibration = { offset_ms: offsetMs, jitter_ms: jitterMs };
      saveMessage = t("calibration.saved");
    }
  }

  function handleClose() {
    stopWizard();
    closeSheet();
  }
</script>

<Sheet
  open={ui.sheet === "calibration"}
  title={t("calibration.title")}
  testid="calibration-sheet"
  onclose={handleClose}
>
  <div class="settings-list">
    <section class="setting setting-stacked">
      <p class="muted">{t("calibration.description")}</p>
    </section>

    {#if isBluetooth}
      <div class="notice" role="alert" data-testid="bluetooth-warning">
        <Icon name="bluetooth" size={18} />
        <p>{t("calibration.bluetoothWarning")}</p>
      </div>
    {/if}

    <section class="setting">
      <div class="setting-label">
        <span class="setting-icon"><Icon name="headphones" /></span>
        <div>
          <strong>{t("calibration.outputDevice")}</strong>
        </div>
      </div>
      <select
        data-testid="output-device-select"
        bind:value={selectedOutput}
        disabled={isCalibrating}
        onchange={() => onOutputChange(selectedOutput)}
      >
        {#if outputDevices.length === 0}
          <option value="default">{t("calibration.defaultDevice")}</option>
        {:else}
          {#each outputDevices as device (device.deviceId)}
            <option value={device.deviceId}>{device.label || t("calibration.defaultDevice")}</option
            >
          {/each}
        {/if}
      </select>
    </section>

    <section class="setting">
      <div class="setting-label">
        <span class="setting-icon"><Icon name="mic" /></span>
        <div>
          <strong>{t("calibration.inputDevice")}</strong>
        </div>
      </div>
      <select
        data-testid="input-device-select"
        bind:value={selectedInput}
        disabled={isCalibrating}
        onchange={() => onInputChange(selectedInput)}
      >
        {#if inputDevices.length === 0}
          <option value="default">{t("calibration.defaultDevice")}</option>
        {:else}
          {#each inputDevices as device (device.deviceId)}
            <option value={device.deviceId}>{device.label || t("calibration.defaultDevice")}</option
            >
          {/each}
        {/if}
      </select>
    </section>

    {#if !isCalibrating && !result}
      <section class="setting setting-stacked">
        <div class="setting-label">
          <span class="setting-icon"><Icon name="clock" /></span>
          <div>
            <strong>{t("calibration.manualSlider")}</strong>
            <p class="muted">{t("calibration.manualSliderHint")}</p>
            {#if loadedCalibration}
              <p class="muted" data-testid="current-calibration">
                {t("calibration.currentLatency", { offset: loadedCalibration.offset_ms })}
                {#if loadedCalibration.jitter_ms !== null}
                  · {t("calibration.currentJitter", { jitter: loadedCalibration.jitter_ms })}
                {/if}
              </p>
            {:else}
              <p class="muted" data-testid="current-calibration">
                {t("calibration.notCalibrated")}
              </p>
            {/if}
          </div>
        </div>
        <label class="mix-slider" style="margin-top: 8px;">
          <span>{t("calibration.manualSlider")}</span>
          <input
            type="range"
            min="-100"
            max="600"
            step="0.1"
            data-testid="offset-slider"
            value={offsetMs}
            oninput={(e) => (offsetMs = Number(e.currentTarget.value))}
          />
          <output data-testid="offset-value">{offsetMs} ms</output>
        </label>
        <div class="account-row" style="margin-top: 12px;">
          <button
            type="button"
            class="button button-primary"
            data-testid="save-calibration-button"
            onclick={save}
          >
            <Icon name="save" size={16} />{t("calibration.save")}
          </button>
        </div>
      </section>

      <section class="setting setting-stacked" data-testid="wizard-intro-section">
        <div class="setting-label">
          <span class="setting-icon"><Icon name="sliders" /></span>
          <div>
            <strong>{t("calibration.wizardHeading")}</strong>
            <p class="muted">{t("calibration.wizardIntro")}</p>
          </div>
        </div>
        <div class="account-row" style="margin-top: 12px;">
          <button
            type="button"
            class="button button-primary"
            data-testid="start-calibration-button"
            onclick={startWizard}
          >
            <Icon name="play" size={16} />{t("calibration.start")}
          </button>
        </div>
      </section>
    {/if}

    {#if isCalibrating && progress}
      <section
        class="setting setting-stacked"
        data-testid="calibrating-section"
        style="text-align: center;"
      >
        <div style="padding: 24px 0;">
          <p style="font-size: 1.25rem; font-weight: bold; margin-bottom: 8px;">
            {#if progress.clickIndex <= 2}
              {t("calibration.leadIn")}
            {:else}
              {t("calibration.calibrating", {
                current: progress.clickIndex,
                total: progress.totalClicks,
              })}
            {/if}
          </p>
          <div
            style="display: flex; justify-content: center; align-items: center; gap: 8px; margin: 16px 0;"
          >
            <span
              class="icon"
              style="width: 24px; height: 24px; border-radius: 50%; background: {tapFlash
                ? 'var(--accent)'
                : 'var(--line-strong)'}; transition: background 0.1s ease;"
              aria-hidden="true"
            ></span>
            {#if tapFlash}
              <span class="muted" data-testid="tap-feedback">{t("calibration.tapDetected")}</span>
            {/if}
          </div>
          <button
            type="button"
            class="button"
            data-testid="cancel-calibration-button"
            onclick={stopWizard}
          >
            <Icon name="close" size={16} />{t("calibration.stop")}
          </button>
        </div>
      </section>
    {/if}

    {#if !isCalibrating && result}
      <section class="setting setting-stacked" data-testid="results-section">
        <div class="setting-label">
          <span class="setting-icon"><Icon name="check" /></span>
          <div>
            <strong>{t("calibration.resultsHeading")}</strong>
            {#if result.sampleCount === 0}
              <p class="alert" role="alert">{t("calibration.noTaps")}</p>
            {:else}
              <p data-testid="result-offset">
                {t("calibration.measuredOffset", { offset: result.medianOffsetMs })}
              </p>
              <p class="muted" data-testid="result-jitter">
                {t("calibration.measuredJitter", { jitter: result.jitterMs })} · {t(
                  "calibration.sampleCount",
                  {
                    count: result.sampleCount,
                  },
                )}
              </p>
            {/if}
          </div>
        </div>

        {#if result.highJitter}
          <div
            class="notice"
            role="alert"
            data-testid="high-jitter-warning"
            style="margin-top: 8px;"
          >
            <Icon name="alert" size={18} />
            <p>{t("calibration.highJitterWarning", { jitter: result.jitterMs })}</p>
          </div>
        {/if}

        <label class="mix-slider" style="margin-top: 16px;">
          <span>{t("calibration.manualSlider")}</span>
          <input
            type="range"
            min="-100"
            max="600"
            step="0.1"
            data-testid="result-offset-slider"
            value={offsetMs}
            oninput={(e) => (offsetMs = Number(e.currentTarget.value))}
          />
          <output data-testid="result-offset-value">{offsetMs} ms</output>
        </label>

        <div class="account-row" style="margin-top: 16px; gap: 8px;">
          <button
            type="button"
            class="button button-primary"
            data-testid="save-result-button"
            onclick={save}
          >
            <Icon name="save" size={16} />{t("calibration.save")}
          </button>
          <button type="button" class="button" data-testid="try-again-button" onclick={startWizard}>
            <Icon name="refresh" size={16} />{t("calibration.tryAgain")}
          </button>
        </div>
      </section>
    {/if}

    {#if saveMessage}
      <p class="notice" role="status" data-testid="save-success-notice">{saveMessage}</p>
    {/if}
    {#if errorMessage}
      <p class="alert" role="alert">{errorMessage}</p>
    {/if}
  </div>
</Sheet>
