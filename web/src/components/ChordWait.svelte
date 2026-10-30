<script lang="ts">
  import { untrack } from "svelte";

  import Icon from "./Icon.svelte";
  import ListenPanel from "./ListenPanel.svelte";
  import { parse } from "../lib/chordpro";
  import { t } from "../lib/i18n.svelte";
  import { chordSheetSteps } from "../lib/listen/chordSheetWait";
  import {
    getSavedA4,
    getSavedChannel,
    getSavedDevice,
    getStoredCalibration,
  } from "../lib/listen/devicePrefs";
  import {
    describeProblem,
    ListenError,
    startListening,
    type ListenSession,
  } from "../lib/listen/input";
  import { WaitRun } from "../lib/listen/waitRun";

  // Wait mode for a chord sheet: the chord that is lit is the one to play; the next lights up
  // once it is heard. `onactive` tells the sheet which chord that is.
  let {
    text,
    transpose = 0,
    flats = false,
    capo,
    hideToggle = false,
    onactive,
  }: {
    text: string;
    transpose?: number;
    flats?: boolean;
    /** Replaces the sheet's own `{capo:}` when the reader applied a capo suggestion. */
    capo?: number;
    /** The dock's ⋯ menu drives the run on a phone, through `toggle` and `isOn`. */
    hideToggle?: boolean;
    onactive: (key: string | null) => void;
  } = $props();

  type Phase = "idle" | "waiting" | "done";

  const built = $derived(chordSheetSteps(parse(text), transpose, flats, capo));
  let on = $state(false);
  let phase = $state<Phase>("idle");
  let current = $state(-1);
  let hits = $state(0);
  let error = $state("");
  let run: WaitRun | null = null;
  const savedDevice = getSavedDevice();
  let deviceId = $state(savedDevice);
  let channel = $state(getSavedChannel(savedDevice));
  let level = $state(0);
  let session = $state<ListenSession | null>(null);
  let inputOpen = $state(false);
  const inputId = `chord-wait-input-${Math.random().toString(36).slice(2, 8)}`;

  const chord = $derived(built.steps[current]?.label ?? "");

  async function start() {
    if (run || built.steps.length === 0) return;
    error = "";
    const { steps, keys } = built;
    const next = new WaitRun({
      steps,
      listen: (options) =>
        startListening({
          ...options,
          a4: getSavedA4(),
          deviceId: deviceId || undefined,
          channel,
          onLevel: ({ peak }) => (level = peak),
        }),
      match: { latencySeconds: (getStoredCalibration(deviceId) ?? 0) / 1000 },
      hintSeconds: 0,
      onWait: (_, index) => {
        current = index;
        phase = "waiting";
        onactive(keys[index]);
      },
      onHit: (_, index) => {
        hits = next.hits;
        if (index + 1 < steps.length) {
          next.reach(index + 1);
          return;
        }
        current = -1;
        phase = "done";
        onactive(null);
      },
      onHint: () => undefined,
    });
    try {
      await next.start();
    } catch (err) {
      error = err instanceof ListenError ? describeProblem(err.problem) : String(err);
      return;
    }
    run = next;
    session = next.listening;
    on = true;
    hits = 0;
    next.seek(0);
    next.reach(0);
  }

  function stop() {
    run?.stop();
    run = null;
    session = null;
    level = 0;
    on = false;
    phase = "idle";
    current = -1;
    onactive(null);
  }

  function toggle() {
    if (on) stop();
    else void start();
  }

  export function toggleRun() {
    toggle();
  }

  export function isOn() {
    return on;
  }

  // The steps belong to the sheet as it was when the run began: a transposition or an edit ends it.
  $effect(() => {
    void built;
    untrack(() => {
      if (run) stop();
    });
  });

  $effect(() => () => run?.stop());
</script>

{#if built.steps.length > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="wait no-print"
    data-testid="chord-wait"
    onkeydown={(event) => event.key === "Escape" && (inputOpen = false)}
  >
    <button
      class="toggle"
      class:visually-hidden={hideToggle}
      hidden={hideToggle}
      data-testid="chord-wait-toggle"
      aria-pressed={on}
      title={t("chordWait.about")}
      onclick={toggle}
    >
      <Icon name="hourglass" size={16} /><span class="float-label"
        >{on ? t("chordWait.stop") : t("chordWait.start")}</span
      >
    </button>
    {#if on || error}
      <button
        class="icon-button ghost"
        data-testid="chord-wait-input"
        aria-expanded={inputOpen}
        aria-controls={inputId}
        aria-label={t("chordPage.waitInput")}
        title={t("chordPage.waitInput")}
        onclick={() => (inputOpen = !inputOpen)}><Icon name="mic" size={18} /></button
      >
    {/if}
    {#if inputOpen && (on || error)}
      <div class="popover" id={inputId} role="group" aria-label={t("chordPage.waitInput")}>
        <ListenPanel
          {session}
          {deviceId}
          {channel}
          {level}
          onDevice={(next) => (deviceId = next)}
          onChannel={(next) => (channel = next)}
        />
      </div>
    {/if}
    {#if error}<p class="note alert" role="alert" data-testid="chord-wait-error">
        <Icon name="alert" size={18} />{error}
      </p>{/if}
    {#if on}
      <div
        class="note wait-status"
        data-testid="chord-wait-status"
        data-state={phase}
        data-hits={hits}
        data-total={built.steps.length}
        role="status"
      >
        <Icon name="hourglass" size={16} />
        <span class="wait-note">
          {#if phase === "waiting"}
            {t("chordWait.playNow", { chord })}
          {:else if phase === "done"}
            {t("chordWait.done", { hits, total: built.steps.length })}
          {:else}
            {t("chordWait.listening", { chord })}
          {/if}
        </span>
        <span class="muted small"
          >{t("chordWait.progress", { hits, total: built.steps.length })}</span
        >
        {#if phase === "waiting"}
          <button class="button" data-testid="chord-wait-skip" onclick={() => run?.skip()}
            >{t("chordWait.skip")}</button
          >
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .wait {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  /* The dock is fixed to the bottom (and is the containing block here), so the status and the
     input popover open upward from it. */
  .note {
    position: absolute;
    left: 50%;
    bottom: calc(100% + var(--sp-2));
    z-index: 41;
    width: max-content;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
    max-width: min(32rem, calc(100vw - 24px));
    margin: 0;
    padding: var(--sp-2) var(--sp-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    transform: translateX(-50%);
  }

  .wait-status[data-state="done"] {
    border-color: var(--success);
  }

  .popover {
    position: absolute;
    left: 50%;
    bottom: calc(100% + var(--sp-2));
    z-index: 42;
    width: min(22rem, calc(100vw - 24px));
    padding: var(--sp-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    transform: translateX(-50%);
  }
</style>
