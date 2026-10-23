<script lang="ts">
  import { untrack } from "svelte";

  import Icon from "./Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import { t } from "../lib/i18n.svelte";
  import {
    ListenError,
    describeProblem,
    startListening,
    type ListenSession,
    type PitchEvent,
  } from "../lib/listen";
  import { midiToFrequency } from "../lib/listen/notes";
  import { midiToName } from "../lib/tuning";
  import {
    A4_MAX,
    A4_MIN,
    PRESETS,
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
    withCapo,
    type ReferenceTone,
  } from "../lib/tuner";
  import { closeSheet, ui } from "../lib/ui.svelte";

  const MUTE_KEY = "fretbook.tuner.muted";
  /** Recent needle positions kept for the pitch trace. */
  const TRAIL_LENGTH = 40;

  const open = $derived(ui.sheet === "tuner");
  const request = $derived(ui.tunerRequest);

  // "song" is the tuning handed over by the song page, "chromatic" has no target strings.
  let source = $state("chromatic");
  let withCapoOn = $state(false);
  let a4 = $state(440);
  let running = $state(false);
  let starting = $state(false);
  let problem = $state("");
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

  let session: ListenSession | null = null;
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
      // Private mode: the choice just lasts until the page closes.
    }
  }

  const strings = $derived.by((): number[] | null => {
    if (source === "song" && request) {
      return withCapoOn ? withCapo(request.tuning, request.capo) : request.tuning;
    }
    return PRESETS.find((preset) => preset.id === source)?.midi ?? null;
  });

  // The headstock: the lower half of the strings on the left, the higher half on the right.
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
    problem = "";
    try {
      session = await startListening({ a4, onPitch });
      running = true;
    } catch (error) {
      problem = describeProblem(error instanceof ListenError ? error.problem : "other");
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
    clearReading();
    stopTone();
    await current?.stop().catch(() => undefined);
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

  function changeSource(next: string) {
    source = next;
    withCapoOn = false;
    locked = 0;
    stopTone();
    startOver();
  }

  // The sheet stays mounted while closed: pick the starting source on open, release the microphone on close.
  let wasOpen = false;
  $effect(() => {
    const isOpen = open;
    untrack(() => {
      if (isOpen && !wasOpen) {
        source = request ? "song" : "chromatic";
        withCapoOn = false;
        problem = "";
        locked = 0;
        startOver();
      } else if (!isOpen && wasOpen) {
        void stop();
      }
      wasOpen = isOpen;
    });
  });

  // Strings that sound different (capo on or off) have to be tuned again.
  $effect(() => {
    void withCapoOn;
    untrack(startOver);
  });

  // The reference tone follows the A4 setting while it sounds.
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

<Sheet
  {open}
  title={t("tuner.heading")}
  subtitle={request && source === "song" ? t("tuner.forSong") : ""}
  testid="tuner-sheet"
  onclose={closeSheet}
>
  <div class="tuner">
    <div class="tuner-options">
      <label class="tuner-field">
        <span>{t("tuner.tuning")}</span>
        <select
          data-testid="tuner-source"
          value={source}
          onchange={(event) => changeSource(event.currentTarget.value)}
        >
          {#if request}<option value="song">{t("tuner.songTuning")}</option>{/if}
          <option value="chromatic">{t("tuner.chromatic")}</option>
          {#each PRESETS as preset (preset.id)}
            <option value={preset.id}>{t(preset.labelKey)}</option>
          {/each}
        </select>
      </label>
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

    {#if strings}
      <div class="tuner-headstock" data-testid="tuner-strings">
        {#each [sides.left, sides.right] as column, side (side)}
          <ul class="tuner-column">
            {#each column as index (index)}
              {@const midi = strings[index]}
              <li>
                <button
                  class="tuner-string"
                  class:tuner-string-active={reading?.string === index}
                  class:tuner-string-tuned={tuned.includes(index)}
                  class:tuner-string-locked={!auto && locked === index}
                  data-testid={`tuner-string-${index}`}
                  aria-pressed={tone?.string === index}
                  aria-label={t("tuner.playString", { note: midiToName(midi) })}
                  title={t("tuner.playString", { note: midiToName(midi) })}
                  onclick={() => toggleTone(index)}
                >
                  <span class="tuner-string-no">{index + 1}</span>
                  <span class="tuner-string-name">{midiToName(midi)}</span>
                  <Icon name={tuned.includes(index) ? "check" : "waveform"} size={16} />
                </button>
              </li>
            {/each}
          </ul>
        {/each}
      </div>
      <p class="muted tuner-hint">{t("tuner.toneHint")}</p>
    {/if}

    {#if problem}<p class="alert" role="alert"><Icon name="alert" size={18} />{problem}</p>{/if}

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
          <Icon name="tuner" size={18} />{starting ? t("tuner.starting") : t("tuner.start")}
        </button>
      {/if}
    </div>
  </div>
</Sheet>
