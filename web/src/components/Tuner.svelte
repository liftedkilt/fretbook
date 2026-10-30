<script lang="ts">
  import type { Snippet } from "svelte";
  import { untrack } from "svelte";

  import Icon from "./Icon.svelte";
  import ListenPanel from "./ListenPanel.svelte";
  import { t } from "../lib/i18n.svelte";
  import {
    ListenError,
    startListening,
    type ListenProblem,
    type ListenSession,
    type PitchEvent,
  } from "../lib/listen";
  import { getSavedChannel, getSavedDevice } from "../lib/listen/devicePrefs";
  import { midiToFrequency } from "../lib/listen/notes";
  import { midiToName } from "../lib/tuning";
  import {
    A4_MAX,
    A4_MIN,
    PitchSmoother,
    TuneTracker,
    centsFromString,
    chromaticMatch,
    clampA4,
    displayCents,
    nearestString,
    needlePosition,
    playReferenceTone,
    playSuccessChime,
    type ReferenceTone,
  } from "../lib/tuner";

  const MUTE_KEY = "fretbook.tuner.muted";
  const TRAIL_LENGTH = 40;

  let {
    strings = null,
    active = true,
    optionsSnippet,
    togglesSnippet,
    page,
  }: {
    strings: number[] | null;
    active?: boolean;
    optionsSnippet?: Snippet;
    togglesSnippet?: Snippet;
    /** Lays the two parts out itself (the tool page): Start sits under the dial, strings in a row. */
    page?: Snippet<[Snippet, Snippet]>;
  } = $props();

  let a4 = $state(440);
  let running = $state(false);
  let starting = $state(false);
  let problem = $state<ListenProblem | null>(null);
  const savedDevice = getSavedDevice();
  let deviceId = $state(savedDevice);
  let channel = $state(getSavedChannel(savedDevice));
  let level = $state(0);
  let reading = $state<{ frequency: number; cents: number; midi: number; string: number } | null>(
    null,
  );
  let ticked = $state(false);
  let tuned = $state<number[]>([]);
  let trail = $state<number[]>([]);
  let auto = $state(true);
  let locked = $state(0);
  let muted = $state(readMuted());
  let tone = $state<{ string: number; handle: ReferenceTone } | null>(null);

  let session = $state<ListenSession | null>(null);
  const tracker = new TuneTracker();
  const smoother = new PitchSmoother();

  function readMuted(): boolean {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  }

  function setMuted(value: boolean) {
    muted = value;
    try {
      localStorage.setItem(MUTE_KEY, value ? "1" : "0");
    } catch {
      // Private mode
    }
  }

  // The headstock: lower half of strings on left, higher half on right.
  const sides = $derived.by(() => {
    const count = strings?.length ?? 0;
    const split = Math.floor(count / 2);
    const left = Array.from({ length: count - split }, (_, i) => split + i);
    const right = Array.from({ length: split }, (_, i) => split - 1 - i);
    return { left, right };
  });

  const shown = $derived(reading ? displayCents(Math.round(reading.cents * 10) / 10) : 0);
  const signed = $derived(`${shown > 0 ? "+" : ""}${Math.round(shown)}`);
  const note = $derived(
    reading ? midiToName(strings ? strings[reading.string] : reading.midi) : "–",
  );
  const needle = $derived(reading ? needlePosition(shown) : 0);
  const trace = $derived(
    trail.map((position, i) => `${50 + position * 50},${(i / (TRAIL_LENGTH - 1)) * 100}`).join(" "),
  );
  const allTuned = $derived(strings !== null && tuned.length >= strings.length);
  const hint = $derived(
    !reading
      ? ""
      : ticked
        ? t("tuner.inTune")
        : shown === 0 || Math.abs(shown) <= 3
          ? t("tuner.holdSteady")
          : shown < 0
            ? t("tuner.tuneUp")
            : t("tuner.tuneDown"),
  );

  function onPitch(event: PitchEvent) {
    const frequency = smoother.push(event.time, event.frequency);
    if (frequency === null) {
      reading = null;
      ticked = tracker.update(event.time, null, null).confirmed;
      return;
    }
    let next: { cents: number; midi: number; string: number } | null = null;
    if (strings) {
      const index = auto ? nearestString(frequency, strings, a4)?.index : locked;
      const cents = index === undefined ? null : centsFromString(frequency, strings, index, a4);
      if (index !== undefined && cents !== null)
        next = { cents, midi: strings[index], string: index };
    } else {
      const match = chromaticMatch(frequency, a4);
      if (match) next = { ...match, string: -1 };
    }
    if (!next) return;
    reading = { frequency, ...next };
    const update = tracker.update(
      event.time,
      strings ? next.string : next.midi,
      next.cents,
      !!strings,
    );
    ticked = update.confirmed;
    trail = [...trail, needlePosition(displayCents(next.cents))].slice(-TRAIL_LENGTH);
    if (strings) tuned = [...tracker.tuned];
    if (update.newlyTuned && !muted) playSuccessChime();
  }

  async function start() {
    if (running || starting) return;
    starting = true;
    problem = null;
    try {
      // The locked string changes the cents display only. The detector is not given that
      // pitch as a target; see docs/design/tuner-and-wait-pitch.md.
      session = await startListening({
        a4,
        deviceId: deviceId || undefined,
        channel,
        onPitch,
        onLevel: ({ peak }) => (level = peak),
      });
      running = true;
    } catch (error) {
      problem = error instanceof ListenError ? error.problem : "other";
    } finally {
      starting = false;
    }
  }

  function clearReading() {
    reading = null;
    ticked = false;
    trail = [];
    tracker.reset(false);
    smoother.reset();
  }

  async function stop() {
    const current = session;
    session = null;
    running = false;
    level = 0;
    clearReading();
    stopTone();
    await current?.stop().catch(() => undefined);
  }

  async function changeDevice(next: string) {
    deviceId = next;
    if (!running) return;
    await stop();
    await start();
  }

  function startOver() {
    tracker.reset();
    tuned = [];
    clearReading();
  }

  function stopTone() {
    tone?.handle.stop();
    tone = null;
  }

  function toggleTone(index: number) {
    const playing = tone?.string === index;
    stopTone();
    if (!auto) locked = index;
    if (strings && !playing) {
      tone = { string: index, handle: playReferenceTone(midiToFrequency(strings[index], a4)) };
    }
  }

  // React to target strings changing
  $effect(() => {
    void strings;
    untrack(() => {
      locked = 0;
      stopTone();
      startOver();
    });
  });

  // Stop if deactivated
  $effect(() => {
    if (!active) {
      untrack(() => {
        void stop();
      });
    }
  });

  // Keep reference tone in sync with A4
  $effect(() => {
    const reference = a4;
    untrack(() => {
      if (tone && strings) {
        const index = tone.string;
        tone.handle.stop();
        tone = {
          string: index,
          handle: playReferenceTone(midiToFrequency(strings[index], reference)),
        };
      }
    });
  });

  $effect(() => () => void stop());
</script>

{#snippet settingsPart()}
  <div class="tuner-options">
    {#if optionsSnippet}
      {@render optionsSnippet()}
    {/if}
    <label class="tuner-field">
      <span>{t("tuner.a4")}</span>
      <span class="tuner-a4">
        <input
          type="range"
          data-testid="tuner-a4"
          min={A4_MIN}
          max={A4_MAX}
          step="1"
          value={a4}
          aria-label={t("tuner.a4")}
          oninput={(event) => (a4 = clampA4(Number(event.currentTarget.value)))}
        />
        <output data-testid="tuner-a4-value">{a4} Hz</output>
      </span>
    </label>
  </div>

  <div class="tuner-toggles">
    {#if strings}
      <label class="tuner-toggle">
        <input
          type="checkbox"
          data-testid="tuner-auto"
          checked={auto}
          onchange={(event) => (auto = event.currentTarget.checked)}
        />
        {t("tuner.auto")}
      </label>
    {/if}
    <label class="tuner-toggle">
      <input
        type="checkbox"
        data-testid="tuner-mute"
        checked={muted}
        onchange={(event) => setMuted(event.currentTarget.checked)}
      />
      {t("tuner.mute")}
    </label>
  </div>

  {#if togglesSnippet}
    {@render togglesSnippet()}
  {/if}
{/snippet}

{#snippet actionsPart()}
  <div class="tuner-actions">
    {#if strings}
      <button data-testid="tuner-restart" onclick={startOver}>{t("tuner.startOver")}</button>
    {/if}
    {#if running}
      <button data-testid="tuner-stop" onclick={() => void stop()}>{t("tuner.stop")}</button>
    {:else}
      <button
        class="primary"
        data-testid="tuner-start"
        disabled={starting}
        onclick={() => void start()}
      >
        <Icon name="tuningFork" size={18} />{starting ? t("tuner.starting") : t("tuner.start")}
      </button>
    {/if}
  </div>
{/snippet}

{#snippet stringButton(index: number)}
  {@const midi = strings![index]}
  <button
    class="tuner-string"
    class:tuner-string-active={reading?.string === index}
    class:tuner-string-tuned={tuned.includes(index)}
    class:tuner-string-locked={!auto && locked === index}
    data-testid={`tuner-string-${index}`}
    aria-pressed={tone?.string === index}
    aria-label={t("tuner.playString", { string: index + 1, note: midiToName(midi) })}
    title={t("tuner.playString", { string: index + 1, note: midiToName(midi) })}
    onclick={() => toggleTone(index)}
  >
    <span class="tuner-string-no">{index + 1}</span>
    <span class="tuner-string-name">{midiToName(midi)}</span>
    <Icon name={tuned.includes(index) ? "check" : "waveform"} size={16} />
  </button>
{/snippet}

{#snippet stringsPart()}
  {#if strings}
    {#if page}
      <!-- One row, low string to high. -->
      <ul class="tuner-row" style:--strings={strings.length} data-testid="tuner-strings">
        {#each [...strings.keys()].reverse() as index (index)}
          <li>{@render stringButton(index)}</li>
        {/each}
      </ul>
    {:else}
      <div class="tuner-headstock" data-testid="tuner-strings">
        {#each [sides.left, sides.right] as column, side (side)}
          <ul class="tuner-column">
            {#each column as index (index)}
              <li>{@render stringButton(index)}</li>
            {/each}
          </ul>
        {/each}
      </div>
    {/if}
    <p class="muted tuner-hint">{t("tuner.toneHint")}</p>
  {/if}
{/snippet}

{#snippet stagePart()}
  <div
    class="tuner-dial"
    class:tuner-dial-tuned={ticked}
    data-testid="tuner-dial"
    data-state={reading ? (ticked ? "tuned" : "reading") : "idle"}
  >
    <div class="tuner-trace" aria-hidden="true">
      <span class="tuner-flat">♭</span>
      <span class="tuner-sharp">♯</span>
      <span class="tuner-centre"></span>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points={trace} />
      </svg>
      <span
        class="tuner-needle"
        data-testid="tuner-needle"
        data-position={needle.toFixed(2)}
        style:left={`${50 + needle * 50}%`}
        style:opacity={reading ? 1 : 0.35}
      >
        <span class="tuner-note display" data-testid="tuner-note">{note}</span>
      </span>
    </div>
    <p class="tuner-cents" data-testid="tuner-cents" aria-live="off">
      {#if reading}
        <span class="tuner-bubble" title={t("tuner.cents", { cents: signed })}>{signed}</span>
        · {reading.frequency.toFixed(1)} Hz
      {:else}
        {running ? t("tuner.listening") : t("tuner.idle")}
      {/if}
    </p>
    <p class="tuner-hint-now" data-testid="tuner-direction">{hint}</p>
    <p class="tuner-tick" class:tuner-tick-on={ticked} data-testid="tuner-tick" role="status">
      {#if allTuned}
        <Icon name="check" size={18} /><span data-testid="tuner-all-tuned"
          >{t("tuner.allTuned")}</span
        >
      {:else if ticked}
        <Icon name="check" size={18} />{t("tuner.inTune")}
      {/if}
    </p>
  </div>

  {#if page}
    {@render actionsPart()}
  {/if}
  {@render stringsPart()}
  <ListenPanel
    {session}
    {deviceId}
    {channel}
    {level}
    {problem}
    onDevice={(next) => void changeDevice(next)}
    onChannel={(next) => (channel = next)}
  />

  {#if !page}
    {@render actionsPart()}
  {/if}
{/snippet}

{#if page}
  {@render page(stagePart, settingsPart)}
{:else}
  <div class="tuner">
    {@render settingsPart()}
    {@render stagePart()}
  </div>
{/if}
