<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import Fretboard from "./Fretboard.svelte";
  import Icon from "./Icon.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import SegmentedControl from "./ui/SegmentedControl.svelte";
  import ListenPanel from "./ListenPanel.svelte";
  import { recordPracticeExercise } from "../lib/api";
  import { getSavedChannel, getSavedDevice } from "../lib/listen/devicePrefs";
  import { ListenError, describeProblem, startListening, type ListenSession } from "../lib/listen";
  import type { ChromaEvent, PitchEvent } from "../lib/listen";
  import { t } from "../lib/i18n.svelte";
  import { localDay } from "../lib/practiceLog";
  import { INSTRUMENTS } from "../lib/tuner";
  import { playChord, playMelodic } from "../lib/trainer/audio";
  import { ChordAnswerMatcher } from "../lib/trainer/chordPlay";
  import {
    CHORD_QUALITIES,
    checkChord,
    checkInterval,
    checkPlayedTarget,
    chordPool,
    intervalPool,
    nextChord,
    nextInterval,
    type ChordQuestion,
    type Direction,
    type EarLevel,
    type IntervalQuestion,
  } from "../lib/trainer/ear";
  import {
    StableNote,
    accuracy,
    answerFrets,
    checkPlayed,
    checkTap,
    meanMs,
    nextQuestion,
    noteName,
    recordAnswer,
    weakStringWeights,
    type FretQuestion,
    type StringStats,
  } from "../lib/trainer/fretboardGame";
  import { TIME_LIMITS, TrainerSession, type FinishedSession } from "../lib/trainer/session";
  import {
    KIND_ABOUT,
    KIND_NAMES,
    loadStore,
    recordBest,
    saveStore,
    tuningKey,
    type TrainerKind,
    type TrainerStore,
  } from "../lib/trainer/store";

  const FRETS = 12;
  const FEEDBACK_MS = 900;
  const KINDS: TrainerKind[] = ["fretboard", "interval", "chord"];

  let kind = $state<TrainerKind>("fretboard");
  let tuningChoice = $state("guitar6:standard");
  let timeLimit = $state<number>(60);
  let level = $state<EarLevel>("easy");
  let answerBy = $state<"buttons" | "play">("buttons");
  let direction = $state<"up" | "down" | "both">("up");
  let accidentals = $state<"sharps" | "flats">("sharps");

  let phase = $state<"setup" | "running" | "done">("setup");
  let session: TrainerSession | null = null;
  let remaining = $state<number | null>(null);
  let answered = $state(0);
  let right = $state(0);
  let streak = $state(0);
  let feedback = $state<"" | "right" | "wrong">("");
  let revealed = $state<{ string: number; fret: number }[]>([]);
  let locked = $state(false);
  let finished = $state<FinishedSession | null>(null);
  let isBest = $state(false);
  let store = $state<TrainerStore>(loadStore());
  let roundStats: StringStats = {};
  let tick: ReturnType<typeof setInterval> | null = null;
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  let fretQuestion = $state<FretQuestion | null>(null);
  let intervalQuestion = $state<IntervalQuestion | null>(null);
  let chordQuestion = $state<ChordQuestion | null>(null);
  let playing = $state(false);

  let listener: ListenSession | null = null;
  const savedDevice = getSavedDevice();
  let micDevice = $state(savedDevice);
  let micChannel = $state(getSavedChannel(savedDevice));
  let micLevel = $state(0);
  let micSession = $state<ListenSession | null>(null);
  let problem = $state("");
  const stable = new StableNote(3);
  const chordMatcher = new ChordAnswerMatcher();

  const tuning = $derived.by((): number[] => {
    const [instrumentId, tuningId] = tuningChoice.split(":");
    const instrument = INSTRUMENTS.find((i) => i.id === instrumentId) ?? INSTRUMENTS[0];
    const found = instrument.tunings.find((entry) => entry.id === tuningId && entry.midi.length);
    return found?.midi ?? INSTRUMENTS[0].tunings[0].midi;
  });
  const tuningOptions = $derived(
    INSTRUMENTS.flatMap((instrument) =>
      instrument.tunings
        .filter((entry) => entry.midi.length)
        .map((entry) => ({
          value: `${instrument.id}:${entry.id}`,
          label: `${t(instrument.labelKey)} · ${t(entry.labelKey)}`,
        })),
    ),
  );
  const stringStats = $derived(store.strings[tuningKey(tuning)] ?? {});
  const bestKey = $derived(
    kind === "fretboard" ? `fretboard:${tuningKey(tuning)}` : `${kind}:${level}`,
  );
  const best = $derived(store.bests[bestKey]);
  const directions = $derived<Direction[]>(direction === "both" ? ["up", "down"] : [direction]);
  const usesMic = $derived(answerBy === "play");

  function clearTimers() {
    if (tick) clearInterval(tick);
    if (feedbackTimer) clearTimeout(feedbackTimer);
    tick = null;
    feedbackTimer = null;
  }

  async function stopListening() {
    const current = listener;
    listener = null;
    micSession = null;
    micLevel = 0;
    stable.reset();
    chordMatcher.listen(null);
    await current?.stop().catch(() => undefined);
  }

  onDestroy(() => {
    clearTimers();
    void stopListening();
  });

  async function start() {
    problem = "";
    if (usesMic) {
      try {
        listener = await startListening({
          deviceId: micDevice || undefined,
          channel: micChannel,
          onPitch,
          onChroma,
          onLevel: ({ peak }) => (micLevel = peak),
        });
        micSession = listener;
        listener.setChroma(kind === "chord");
      } catch (error) {
        problem = describeProblem(error instanceof ListenError ? error.problem : "other");
        return;
      }
    }
    session = new TrainerSession(kind, timeLimit);
    answered = 0;
    right = 0;
    streak = 0;
    feedback = "";
    revealed = [];
    roundStats = {};
    finished = null;
    locked = false;
    phase = "running";
    remaining = session.remaining();
    ask(null);
    tick = setInterval(() => {
      remaining = session?.remaining() ?? null;
      if (session?.over && !locked) void finish();
    }, 200);
  }

  function ask(previous: unknown) {
    revealed = [];
    feedback = "";
    locked = false;
    if (kind === "fretboard") {
      const weights = weakStringWeights(stringStats, tuning.length);
      fretQuestion = nextQuestion(Math.random, tuning.length, {
        previous: previous as FretQuestion | null,
        weights,
      });
    } else if (kind === "interval") {
      intervalQuestion = nextInterval(
        Math.random,
        level,
        directions,
        previous as IntervalQuestion | null,
      );
      void playQuestion();
    } else {
      chordQuestion = nextChord(Math.random, level, previous as ChordQuestion | null);
      void playQuestion();
    }
    session?.startRound();
  }

  async function playQuestion() {
    playing = true;
    stable.reset();
    chordMatcher.listen(null);
    const asked = chordQuestion;
    try {
      if (kind === "interval" && intervalQuestion) {
        await playMelodic([intervalQuestion.root, intervalQuestion.target]);
      } else if (kind === "chord" && chordQuestion) {
        await playChord(chordQuestion.notes);
      }
    } catch {
      // No audio output: the question can still be answered from the buttons.
    } finally {
      playing = false;
      stable.reset();
      // The question's own sound is over: from here a strum is an answer.
      if (kind === "chord" && usesMic && asked && asked === chordQuestion && !locked)
        chordMatcher.listen(asked, chordPool(level));
    }
  }

  function answer(correct: boolean) {
    if (!session || locked || session.over) return;
    locked = true;
    const ms = session.answer(correct);
    answered = session.rounds;
    right = session.correct;
    streak = correct ? streak + 1 : 0;
    feedback = correct ? "right" : "wrong";
    if (kind === "fretboard" && fretQuestion) {
      roundStats = recordAnswer(roundStats, fretQuestion.string, correct, ms);
      if (!correct) {
        revealed = answerFrets(tuning, fretQuestion, FRETS).map((fret) => ({
          string: fretQuestion!.string,
          fret,
        }));
      }
    }
    const previous =
      kind === "fretboard" ? fretQuestion : kind === "interval" ? intervalQuestion : chordQuestion;
    feedbackTimer = setTimeout(
      () => {
        if (phase !== "running") return;
        if (session?.over) void finish();
        else ask(previous);
      },
      correct ? FEEDBACK_MS / 2 : FEEDBACK_MS * 1.6,
    );
  }

  function onTap(note: { string: number; fret: number }) {
    if (phase !== "running" || kind !== "fretboard" || !fretQuestion) return;
    answer(checkTap(tuning, fretQuestion, note));
  }

  function onPitch(event: PitchEvent) {
    if (phase !== "running" || locked || playing) return;
    const midi = stable.push(event.midi);
    if (midi === null) return;
    if (kind === "fretboard" && fretQuestion)
      answer(checkPlayed(tuning, fretQuestion, midi, FRETS));
    else if (kind === "interval" && intervalQuestion)
      answer(checkPlayedTarget(intervalQuestion, midi));
  }

  function onChroma(event: ChromaEvent) {
    if (phase !== "running" || locked || kind !== "chord") return;
    if (playing) {
      chordMatcher.tick(event);
      return;
    }
    const verdict = chordMatcher.push(event);
    if (verdict) answer(verdict === "right");
  }

  function onChoice(id: string) {
    if (kind === "interval" && intervalQuestion) answer(checkInterval(intervalQuestion, id));
    else if (kind === "chord" && chordQuestion) answer(checkChord(chordQuestion, id));
  }

  async function finish() {
    if (!session || phase !== "running") return;
    locked = true;
    clearTimers();
    const result = session.finish();
    session = null;
    await stopListening();
    finished = result;
    phase = "done";
    remaining = null;
    if (result.summary.rounds > 0) {
      let next = store;
      if (kind === "fretboard") {
        const key = tuningKey(tuning);
        const merged: StringStats = { ...(next.strings[key] ?? {}) };
        for (const [string, stat] of Object.entries(roundStats)) {
          const before = merged[string] ?? { asked: 0, correct: 0, totalMs: 0 };
          merged[string] = {
            asked: before.asked + stat.asked,
            correct: before.correct + stat.correct,
            totalMs: before.totalMs + stat.totalMs,
          };
        }
        next = { ...next, strings: { ...next.strings, [key]: merged } };
      }
      const outcome = recordBest(next, bestKey, result.summary.score ?? 0);
      isBest = outcome.isBest;
      store = outcome.store;
      saveStore(store);
      if (result.seconds >= 1) {
        void recordPracticeExercise({
          kind: result.kind,
          day: localDay(new Date(result.startedAt)),
          started_at: new Date(result.startedAt).toISOString(),
          duration_seconds: Math.min(result.seconds, 6 * 3600),
          rounds: result.summary.rounds,
          correct: result.summary.correct,
          score: result.summary.score,
        });
      }
    }
  }

  function again() {
    phase = "setup";
    finished = null;
  }

  function selectKind(next: TrainerKind) {
    if (phase === "running") return;
    kind = next;
    phase = "setup";
  }

  // Changing a setting mid-game would change the question under the player's hands.
  $effect(() => {
    void [kind, tuningChoice, level, answerBy, direction];
    untrack(() => {
      if (phase === "running") void finish();
    });
  });

  const choices = $derived(
    kind === "interval"
      ? intervalPool(level).map((i) => ({ id: i.id, label: t(i.labelKey) }))
      : chordPool(level).map((c) => ({ id: c.id, label: t(c.labelKey) })),
  );
  const lit = $derived(revealed.map((note) => ({ ...note })));
  const stringRows = $derived(
    tuning.map((open, string) => ({
      string,
      name: noteName(open, accidentals),
      accuracy: accuracy(stringStats[string]),
      mean: meanMs(stringStats[string]),
      asked: stringStats[string]?.asked ?? 0,
    })),
  );
  void CHORD_QUALITIES;
</script>

<Page width="page">
  <div class="tool-view trainer" data-testid="trainer-view">
    <PageHeader
      title={t("trainer.title")}
      titleSize="title"
      eyebrow={t("tools.nav")}
      backHref="/tools"
      backLabel={t("tools.heading")}
      backTestId="tool-back"
    />

    <SegmentedControl
      label={t("trainer.games")}
      role="tablist"
      value={kind}
      onchange={(next) => selectKind(next as (typeof KINDS)[number])}
      options={KINDS.map((option) => ({
        value: option,
        label: t(KIND_NAMES[option].labelKey),
        testid: `trainer-tab-${option}`,
        disabled: phase === "running",
      }))}
    />

    {#if phase !== "running"}
      <p class="muted">{t(KIND_ABOUT[kind].labelKey)}</p>
      <div class="standalone-pickers" data-testid="trainer-setup">
        {#if kind === "fretboard"}
          <label class="tool-field">
            <span>{t("tools.tuning")}</span>
            <select data-testid="trainer-tuning" bind:value={tuningChoice}>
              {#each tuningOptions as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
          <label class="tool-field">
            <span>{t("trainer.noteNames")}</span>
            <select data-testid="trainer-accidentals" bind:value={accidentals}>
              <option value="sharps">{t("trainer.sharps")}</option>
              <option value="flats">{t("trainer.flats")}</option>
            </select>
          </label>
        {:else}
          <label class="tool-field">
            <span>{t("trainer.level")}</span>
            <select data-testid="trainer-level" bind:value={level}>
              <option value="easy">{t("trainer.levelEasy")}</option>
              <option value="all">{t("trainer.levelAll")}</option>
            </select>
          </label>
        {/if}
        {#if kind === "interval"}
          <label class="tool-field">
            <span>{t("trainer.direction")}</span>
            <select data-testid="trainer-direction" bind:value={direction}>
              <option value="up">{t("trainer.up")}</option>
              <option value="down">{t("trainer.down")}</option>
              <option value="both">{t("trainer.both")}</option>
            </select>
          </label>
        {/if}
        <label class="tool-field">
          <span>{t("trainer.time")}</span>
          <select data-testid="trainer-time" bind:value={timeLimit}>
            {#each TIME_LIMITS as seconds (seconds)}
              <option value={seconds}
                >{seconds ? t("trainer.seconds", { seconds }) : t("trainer.untimed")}</option
              >
            {/each}
          </select>
        </label>
        <label class="tool-field">
          <span>{t("trainer.answerBy")}</span>
          <select data-testid="trainer-answer-by" bind:value={answerBy}>
            <option value="buttons"
              >{kind === "fretboard" ? t("trainer.byTap") : t("trainer.byButtons")}</option
            >
            <option value="play">{t("trainer.byPlaying")}</option>
          </select>
        </label>
      </div>
      {#if problem}<p class="error" role="alert" data-testid="trainer-problem">{problem}</p>{/if}
      {#if usesMic}<p class="muted small">{t("trainer.micHint")}</p>{/if}
      {#if best !== undefined}
        <p class="muted" data-testid="trainer-best">
          {t("trainer.best", { score: Math.round(best) })}
        </p>
      {/if}
      <button class="button" data-testid="trainer-start" onclick={start}>
        <Icon name="play" size={18} />{t("trainer.start")}
      </button>
    {/if}

    {#if usesMic && phase !== "done"}
      <ListenPanel
        session={micSession}
        deviceId={micDevice}
        channel={micChannel}
        level={micLevel}
        onDevice={(next) => (micDevice = next)}
        onChannel={(next) => (micChannel = next)}
      />
    {/if}

    {#if phase === "running"}
      <div class="hud" data-testid="trainer-hud">
        <span data-testid="trainer-score"
          >{t("trainer.scoreLine", { correct: right, rounds: answered })}</span
        >
        <span data-testid="trainer-streak">{t("trainer.streak", { count: streak })}</span>
        {#if remaining !== null}
          <span data-testid="trainer-remaining"
            >{t("trainer.left", { seconds: Math.ceil(remaining) })}</span
          >
        {/if}
        <button class="button ghost" data-testid="trainer-stop" onclick={() => void finish()}>
          {t("trainer.stop")}
        </button>
      </div>

      {#if kind === "fretboard" && fretQuestion}
        <div class="prompt" data-testid="trainer-prompt" aria-live="polite">
          <strong class="note" data-testid="trainer-note"
            >{noteName(fretQuestion.pitchClass, accidentals)}</strong
          >
          <span
            >{t("trainer.onString", {
              string: fretQuestion.string + 1,
              name: noteName(tuning[fretQuestion.string], accidentals),
            })}</span
          >
        </div>
        <Fretboard
          {tuning}
          frets={FRETS}
          current={lit}
          label="names"
          onselect={usesMic ? undefined : onTap}
        />
      {:else}
        <div class="prompt" data-testid="trainer-prompt" aria-live="polite">
          <button
            class="button secondary"
            data-testid="trainer-replay"
            disabled={playing}
            onclick={() => void playQuestion()}
          >
            <Icon name="play" size={18} />{t("trainer.listen")}
          </button>
          <span class="muted"
            >{usesMic
              ? kind === "chord"
                ? t("trainer.playTheChord")
                : t("trainer.playTheSecond")
              : t("trainer.whichOne")}</span
          >
        </div>
        {#if !usesMic}
          <div class="choices" data-testid="trainer-choices">
            {#each choices as choice (choice.id)}
              <button
                class="button secondary"
                data-testid={`trainer-choice-${choice.id}`}
                disabled={locked}
                onclick={() => onChoice(choice.id)}>{choice.label}</button
              >
            {/each}
          </div>
        {/if}
        {#if feedback === "wrong"}
          <p class="reveal" data-testid="trainer-reveal">
            {t("trainer.itWas", {
              answer:
                kind === "interval" && intervalQuestion
                  ? t(intervalQuestion.interval.labelKey)
                  : chordQuestion
                    ? usesMic
                      ? `${noteName(chordQuestion.root % 12, accidentals)} ${t(chordQuestion.quality.labelKey)}`
                      : t(chordQuestion.quality.labelKey)
                    : "",
            })}
          </p>
        {/if}
      {/if}
      <p class="feedback {feedback}" data-testid="trainer-feedback" aria-live="assertive">
        {feedback === "right" ? t("trainer.right") : feedback === "wrong" ? t("trainer.wrong") : ""}
      </p>
    {/if}

    {#if phase === "done" && finished}
      <div class="card results" data-testid="trainer-results">
        <h2>{t("trainer.results")}</h2>
        {#if finished.summary.rounds === 0}
          <p class="muted">{t("trainer.noRounds")}</p>
        {:else}
          <p class="big" data-testid="trainer-final-score">
            {Math.round(finished.summary.score ?? 0)}%
          </p>
          <p>
            {t("trainer.scoreLine", {
              correct: finished.summary.correct,
              rounds: finished.summary.rounds,
            })}
            · {t("trainer.bestStreak", { count: finished.summary.bestStreak })}
            {#if finished.summary.meanMs !== null}
              · {t("trainer.meanTime", { seconds: (finished.summary.meanMs / 1000).toFixed(1) })}
            {/if}
          </p>
          {#if isBest}<p class="best" data-testid="trainer-new-best">{t("trainer.newBest")}</p>{/if}
          <p class="muted small">{t("trainer.logged")}</p>
        {/if}
        <button class="button" data-testid="trainer-again" onclick={again}
          >{t("trainer.again")}</button
        >
      </div>
    {/if}

    {#if kind === "fretboard" && phase !== "running"}
      <div class="card" data-testid="trainer-strings">
        <h2>{t("trainer.perString")}</h2>
        <table>
          <thead>
            <tr>
              <th>{t("trainer.string")}</th>
              <th>{t("trainer.accuracy")}</th>
              <th>{t("trainer.speed")}</th>
            </tr>
          </thead>
          <tbody>
            {#each stringRows as row (row.string)}
              <tr data-testid={`trainer-string-${row.string}`}>
                <td>{row.string + 1} ({row.name})</td>
                <td>{row.accuracy === null ? "–" : `${Math.round(row.accuracy * 100)}%`}</td>
                <td>{row.mean === null ? "–" : `${(row.mean / 1000).toFixed(1)} s`}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</Page>

<style>
  .trainer {
    max-width: 760px;
  }
  .hud {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    align-items: center;
    font-variant-numeric: tabular-nums;
  }
  .hud button {
    margin-left: auto;
  }
  .prompt {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 1rem;
  }
  .note {
    font-size: 3rem;
    line-height: 1;
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.5rem;
  }
  .choices button {
    min-height: 44px;
  }
  .feedback {
    min-height: 1.5rem;
    margin: 0;
    font-weight: 600;
  }
  .feedback.right {
    color: var(--ok, #2e9e5b);
  }
  .feedback.wrong {
    color: var(--danger, #d64545);
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    padding: 1rem 1.15rem;
  }
  h2 {
    font-size: 0.95rem;
    margin: 0 0 0.6rem;
  }
  .big {
    font-size: 3rem;
    font-weight: 700;
    margin: 0;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    text-align: left;
    padding: 0.3rem 0.4rem;
    border-bottom: 1px solid var(--line);
  }
</style>
