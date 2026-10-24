<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import { describeProblem, type ListenProblem } from "../lib/listen";
  import { getSavedChannel, saveChannel, saveDevice } from "../lib/listen/devicePrefs";
  import {
    listInputDevices,
    meterPosition,
    type InputDevice,
    type ListenSession,
  } from "../lib/listen/input";

  let {
    session = null,
    deviceId = "",
    channel = 0,
    level = 0,
    problem = null,
    onDevice,
    onChannel,
  }: {
    /** The running session; its channel count builds the channel picker. */
    session?: ListenSession | null;
    deviceId?: string;
    channel?: number;
    /** Latest peak (linear, 0 to 1) from `onLevel`. */
    level?: number;
    problem?: ListenProblem | null;
    onDevice?: (deviceId: string) => void;
    onChannel?: (channel: number) => void;
  } = $props();

  let devices = $state<InputDevice[]>([]);

  const position = $derived(meterPosition(level));
  const channels = $derived(Array.from({ length: session?.channelCount ?? 0 }, (_, i) => i));

  async function refresh() {
    try {
      devices = await listInputDevices();
    } catch {
      devices = [];
    }
  }

  // Device labels only appear once microphone access has been granted, so look again after a start.
  $effect(() => {
    void session;
    void refresh();
  });

  $effect(() => {
    const media = navigator.mediaDevices;
    media?.addEventListener?.("devicechange", refresh);
    return () => media?.removeEventListener?.("devicechange", refresh);
  });

  // A remembered channel the device no longer has falls back to the first one.
  $effect(() => {
    if (session && channel >= session.channelCount) onChannel?.(0);
  });

  function pickDevice(next: string) {
    saveDevice(next);
    onDevice?.(next);
    onChannel?.(getSavedChannel(next));
  }

  function pickChannel(next: number) {
    saveChannel(deviceId, next);
    session?.setChannel(next);
    onChannel?.(next);
  }
</script>

<div class="listen-panel" data-testid="listen-panel">
  <label class="tuner-field">
    <span>{t("listen.input")}</span>
    <select
      data-testid="listen-device"
      value={deviceId}
      onchange={(event) => pickDevice(event.currentTarget.value)}
    >
      <option value="">{t("listen.defaultDevice")}</option>
      {#each devices.filter((device) => device.deviceId && device.deviceId !== "default") as device, i (device.deviceId)}
        <option value={device.deviceId}
          >{device.label || t("listen.unnamedDevice", { n: i + 1 })}</option
        >
      {/each}
    </select>
  </label>
  {#if channels.length > 1}
    <label class="tuner-field">
      <span>{t("listen.channelPicker")}</span>
      <select
        data-testid="listen-channel"
        value={String(channel)}
        onchange={(event) => pickChannel(Number(event.currentTarget.value))}
      >
        {#each channels as index (index)}
          <option value={String(index)}>{t("listen.channel", { n: index + 1 })}</option>
        {/each}
      </select>
    </label>
  {/if}
  <div
    class="listen-meter"
    data-testid="listen-meter"
    role="meter"
    aria-label={t("listen.level")}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(position * 100)}
  >
    <span class="listen-meter-fill" style:width={`${position * 100}%`}></span>
  </div>
  {#if problem}
    <p class="alert" role="alert"><Icon name="alert" size={18} />{describeProblem(problem)}</p>
  {/if}
</div>
