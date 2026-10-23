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
    InTuneTracker,
    PRESETS,
    chromaticMatch,
    clampA4,
    isInTune,
    nearestString,
    needlePosition,
    playReferenceTone,
    withCapo,
    type ReferenceTone,
  } from "../lib/tuner";
  import { closeSheet, ui } from "../lib/ui.svelte";

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
  let tone = $state<{ string: number; handle: ReferenceTone } | null>(null);

  let session: ListenSession | null = null;
  const tracker = new InTuneTracker();

  const strings = $derived.by((): number[] | null => {
    if (source === "song" && request) {
      return withCapoOn ? withCapo(request.tuning, request.capo) : request.tuning;
    }
    return PRESETS.find((preset) => preset.id === source)?.midi ?? null;
  });

  const note = $derived(
    reading ? midiToName(strings ? strings[reading.string] : reading.midi) : "–",
  );
  const needle = $derived(reading ? needlePosition(reading.cents) : 0);
  const tuned = $derived(reading !== null && isInTune(reading.cents));

  function onPitch(event: PitchEvent) {
    if (event.frequency === null) {
      reading = null;
      ticked = tracker.update(null, null);
      return;
    }
    const target = strings ? nearestString(event.frequency, strings, a4) : null;
    if (strings && target) {
      reading = {
        frequency: event.frequency,
        cents: target.cents,
        midi: strings[target.index],
        string: target.index,
      };
      ticked = tracker.update(target.index, target.cents);
      return;
    }
    const match = chromaticMatch(event.frequency, a4);
    if (!match) return;
    reading = { frequency: event.frequency, cents: match.cents, midi: match.midi, string: -1 };
    ticked = tracker.update(match.midi, match.cents);
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

  async function stop() {
    const current = session;
    session = null;
    running = false;
    reading = null;
    ticked = false;
    tracker.reset();
    stopTone();
    await current?.stop().catch(() => undefined);
  }

  function stopTone() {
    tone?.handle.stop();
    tone = null;
  }

  function toggleTone(index: number) {
    const playing = tone?.string === index;
    stopTone();
    if (strings && !playing) {
      tone = { string: index, handle: playReferenceTone(midiToFrequency(strings[index], a4)) };
    }
  }

  function changeSource(next: string) {
    source = next;
    withCapoOn = false;
    stopTone();
    tracker.reset();
    reading = null;
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
      } else if (!isOpen && wasOpen) {
        void stop();
      }
      wasOpen = isOpen;
    });
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

    <div class="tuner-dial" class:tuner-dial-tuned={tuned} data-testid="tuner-dial">
      <p class="tuner-note display" data-testid="tuner-note">{note}</p>
      <div class="tuner-scale" aria-hidden="true">
        <span class="tuner-centre"></span>
        <span
          class="tuner-needle"
          data-testid="tuner-needle"
          data-position={needle.toFixed(2)}
          style:left={`${50 + needle * 50}%`}
          style:opacity={reading ? 1 : 0.25}
        ></span>
      </div>
      <p class="tuner-cents" data-testid="tuner-cents" aria-live="off">
        {#if reading}
          {t("tuner.cents", {
            cents: `${reading.cents > 0 ? "+" : ""}${Math.round(reading.cents)}`,
          })}
          · {reading.frequency.toFixed(1)} Hz
        {:else}
          {running ? t("tuner.listening") : t("tuner.idle")}
        {/if}
      </p>
      <p class="tuner-tick" class:tuner-tick-on={ticked} data-testid="tuner-tick" role="status">
        {#if ticked}<Icon name="check" size={18} />{t("tuner.inTune")}{/if}
      </p>
    </div>

    {#if strings}
      <ul class="tuner-strings" data-testid="tuner-strings">
        {#each strings as midi, index (index)}
          <li>
            <button
              class="tuner-string"
              class:tuner-string-active={reading?.string === index}
              class:tuner-string-tuned={reading?.string === index && ticked}
              data-testid={`tuner-string-${index}`}
              aria-pressed={tone?.string === index}
              aria-label={t("tuner.playString", { note: midiToName(midi) })}
              title={t("tuner.playString", { note: midiToName(midi) })}
              onclick={() => toggleTone(index)}
            >
              <span class="tuner-string-no">{index + 1}</span>
              <span class="tuner-string-name">{midiToName(midi)}</span>
              <span class="tuner-string-wire" style:height={`${1 + (index / strings.length) * 3}px`}
              ></span>
              <Icon name={reading?.string === index && ticked ? "check" : "waveform"} size={16} />
            </button>
          </li>
        {/each}
      </ul>
      <p class="muted tuner-hint">{t("tuner.toneHint")}</p>
    {/if}

    {#if problem}<p class="alert" role="alert"><Icon name="alert" size={18} />{problem}</p>{/if}

    <div class="tuner-actions">
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
