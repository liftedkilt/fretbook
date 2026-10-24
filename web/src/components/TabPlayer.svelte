<script lang="ts">
  import * as alphaTab from "@coderline/alphatab";
  import { onMount, untrack } from "svelte";

  import Cover from "./Cover.svelte";
  import { coverSrc } from "../lib/cover";
  import Fretboard from "./Fretboard.svelte";
  import FretboardPanel from "./FretboardPanel.svelte";
  import Highway from "./Highway.svelte";
  import Icon from "./Icon.svelte";
  import LoopPanel from "./LoopPanel.svelte";
  import Menu from "./Menu.svelte";
  import SetlistPicker from "./SetlistPicker.svelte";
  import OfflineToggle from "./OfflineToggle.svelte";
  import FullscreenToggle from "./FullscreenToggle.svelte";
  import PracticePanel from "./PracticePanel.svelte";
  import StemMixer from "./StemMixer.svelte";
  import AutoSyncSheet from "./AutoSyncSheet.svelte";
  import RetuneSheet from "./RetuneSheet.svelte";
  import LessonRunBanner from "./LessonRunBanner.svelte";
  import ScorePanel from "./ScorePanel.svelte";
  import ScoreResults from "./ScoreResults.svelte";
  import ShortcutHelp from "./ShortcutHelp.svelte";
  import ListenPanel from "./ListenPanel.svelte";
  import WaitPanel from "./WaitPanel.svelte";
  import { ApiError, getSong, patchSync, recordPracticeSession, uploadAudio } from "../lib/api";
  import YouTubeAudio from "./YouTubeAudio.svelte";
  import { AudioMedia } from "../lib/alphatab/audioHandler";
  import { separateEffectBands } from "../lib/alphatab/display";
  import { preferredTrack, scoreToAlphaTex } from "../lib/alphatex";
  import { Clicker } from "../lib/clicker";
  import { barTicks } from "../lib/durations";
  import {
    handsFree,
    isTyping,
    pageDelta,
    pedalAction,
    setStage,
    STAGE_SCALE,
  } from "../lib/handsFree.svelte";
  import { t } from "../lib/i18n.svelte";
  import {
    buildFretEvents,
    defaultRoot,
    focusAt,
    fretCount,
    playedBarTicks,
    positionInBar,
  } from "../lib/fretboard";
  import { gemKey, highwayStarts, timeAtBarPosition, type GemState } from "../lib/highway";
  import { instrumentLabel } from "../lib/instruments";
  import {
    describeProblem,
    ListenError,
    startListening,
    type ListenOptions,
    type ListenSession,
  } from "../lib/listen";
  import { pitchClassName } from "../lib/listen/chordTones";
  import { getLocalCalibration } from "../lib/listen/calibration";
  import { getSavedChannel, getSavedDevice } from "../lib/listen/devicePrefs";
  import {
    bleedSuspected,
    buildScoredSteps,
    sectionScores,
    starsFor,
    type NoteGrade,
    type ScoreSummary,
    type SectionScore,
  } from "../lib/listen/scored";
  import { colourScoreGrades } from "../lib/alphatab/gradeColors";
  import { ScoredRun } from "../lib/listen/scoredRun";
  import { buildWaitSteps, stepIndexAt, type WaitStep } from "../lib/listen/wait";
  import { WaitRun } from "../lib/listen/waitRun";
  import { waitFocus } from "../lib/listen/waitFretboard";
  import { followPlayed, playedBars } from "../lib/playback";
  import { parseLessonParam } from "../lib/lessonRun";
  import { IdleWatch, PracticeTimer, WAIT_IDLE_MS } from "../lib/practiceLog";
  import {
    ClickScheduler,
    calcNextSpeed,
    clamp01,
    countInClicks,
    formatSpeedPercent,
    loadPractice,
    nextCountIn,
    preservePitch,
    savePractice,
    trackMix,
    updateLoopHighestSpeed,
    type SavedLoop,
  } from "../lib/practice";
  import {
    loadScores,
    loopKey,
    personalBest,
    recordScore,
    type ScoreRecord,
  } from "../lib/scoreLog";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import { RATES, shortcutFor, stepRate, type ShortcutAction } from "../lib/shortcuts";
  import {
    barSeconds,
    flatSyncPoints,
    measureAt,
    moveAnchor,
    pointAnchors,
    songStarts,
  } from "../lib/sync";
  import { midiToName, tuningLabel } from "../lib/tuning";
  import type { SongDetail, TabSong } from "../lib/types";
  import { openTuner, setNotation, setPlayerView, ui } from "../lib/ui.svelte";

  let { song: initial }: { song: TabSong } = $props();
  let pickerOpen = $state(false);

  // The player owns its copy: taps, BPM edits, and uploads change it in place.
  let song = $state(untrack(() => initial));

  let error = $state("");
  let host = $state<HTMLDivElement | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);
  let audioEl = $state<HTMLAudioElement | null>(null);
  let stemsActive = false;
  let trackId = $state(untrack(() => song.preferred_track_id || preferredTrack(song.document).id));
  let scoreReady = $state(0);
  let retuneOpen = $state(false);
  let autoSyncOpen = $state(false);
  let shiftMs = 0;
  const player: { api: alphaTab.AlphaTabApi | null } = { api: null };
  const clicker = new Clicker();
  // Time spent playing goes to the practice log, one session per stretch (see lib/practiceLog.ts).
  const practiceTimer = new PracticeTimer({
    onSession: (session, keepalive) => void recordPracticeSession(session, keepalive),
  });
  const scheduler = new ClickScheduler();
  // Opened from a lesson (`?lesson=<course>/<lesson>`): scored and wait-mode results go to that lesson.
  const lessonRef = typeof location === "undefined" ? null : parseLessonParam(location.search);
  let lessonBanner = $state<LessonRunBanner>();

  let tapIndex = $state(0);
  let loopA = $state<number | null>(null);
  let loopB = $state<number | null>(null);
  let practice = $state(untrack(() => loadPractice(initial.id)));
  let activeLoopId = $state<string | null>(null);
  let speedTrainerPercent = $state(untrack(() => practice.speedTrainer.startPercent));
  let speedTrainerPass = $state(1);
  let speedTrainerCompleted = $state(false);
  let speedTrainerRunning = $state(false);
  let follow = $state(true);
  let rate = $state(1);
  let currentMeasure = $state(-1);
  // Ticks into the current played bar, for the fretboard.
  let currentPosition = $state(0);
  // Seconds on the playback clock, for the scrolling note highway.
  let currentSeconds = $state(0);
  let clock = $state("0:00.0");
  let playing = $state(false);
  let countingIn = $state(false);
  let helpOpen = $state(false);
  let countInTimer = 0;
  let saveLabel = $state("");
  let saveTimer = 0;
  let pendingSync: (() => Promise<void>) | null = null;

  // Wait mode: the synth plays and stops on each beat of the chosen track until it is played.
  type WaitState = "idle" | "waiting" | "hit" | "done";
  let waitOn = $state(false);
  let waitState = $state<WaitState>("idle");
  let waitHits = $state(0);
  let waitStep = $state<WaitStep | null>(null);
  let waitHint = $state(false);
  // The step just hit, kept for the 400 ms the fretboard shows it green.
  let waitHitStep = $state<WaitStep | null>(null);
  let waitError = $state("");
  let waitGrades = $state<Record<string, GemState>>({});
  let waitRun: WaitRun | null = null;
  let waitFlash = 0;
  // The input chosen in the listen panel, shared by wait mode and the scored play-along.
  const savedDevice = getSavedDevice();
  let listenDevice = $state(savedDevice);
  let listenChannel = $state(getSavedChannel(savedDevice));
  let listenLevel = $state(0);
  let listenSession = $state<ListenSession | null>(null);

  function listenWithInput(options: ListenOptions): Promise<ListenSession> {
    return startListening({
      ...options,
      deviceId: listenDevice || undefined,
      channel: listenChannel,
      onLevel: ({ peak }) => (listenLevel = peak),
    });
  }

  // Scored play-along: the music keeps playing and every note of the chosen track is graded.
  let scoreOn = $state(false);
  let scoreSummary = $state<ScoreSummary | null>(null);
  let scoreGrades = $state<Record<string, GemState>>({});
  let scoreError = $state("");
  let scoreBleed = $state(false);
  let scoreCalibrated = $state(true);
  let scoreResult = $state<{
    summary: ScoreSummary;
    sections: SectionScore[];
    speed: number;
    loop: { from: number; to: number } | null;
    isBest: boolean;
    best: ScoreRecord | null;
  } | null>(null);
  let scoreResultsOpen = $state(false);
  let scoreRun: ScoredRun | null = null;

  const document_ = $derived(song.document);
  const track = $derived(
    document_.tracks.find((item) => item.id === trackId) ?? preferredTrack(document_),
  );
  // Bars are played in the expanded order: repeats, voltas and jumps. Everything the player
  // keeps (position, loop, sync marks) is a played bar index, so `barCount` is the played count.
  const order = $derived(playedBars(document_.bars));
  const barCount = $derived(order.length);
  const audioSrc = $derived(
    song.audio_url ? new URL(song.audio_url, document.baseURI).toString() : "",
  );
  // With audio, the <audio> clock and sync points set the pace, so a BPM edit must not rebuild the score.
  // Without audio, alphaTab's synth plays at the written tempo, so it does.
  const renderBpm = $derived(song.has_audio ? untrack(() => song.document.bpm) : document_.bpm);
  // Every track is loaded so the synth can play and mix them all; only the chosen one is drawn.
  const tex = $derived(scoreToAlphaTex({ ...document_, bpm: renderBpm }, song.title, song.artist));
  const trackIndex = $derived(Math.max(0, document_.tracks.indexOf(track)));
  const waitSteps = $derived(buildWaitSteps(document_, track, { chords: practice.wait.chords }));
  const scoredSteps = $derived(buildScoredSteps(document_, track, song.has_audio));
  const fretEvents = $derived(practice.fretboard.on ? buildFretEvents(document_, track) : []);
  // While wait mode is on, the fretboard shows the note being waited on instead of the playhead.
  const waitMarks = $derived(
    waitOn ? waitFocus(waitState === "hit" ? waitHitStep : waitStep, waitState, waitHint) : null,
  );
  const fretFocus = $derived(focusAt(fretEvents, currentMeasure, currentPosition));

  function staveProfile(notation: boolean): alphaTab.StaveProfile {
    return notation ? alphaTab.StaveProfile.ScoreTab : alphaTab.StaveProfile.Tab;
  }

  function message(err: unknown): string {
    return err instanceof Error ? err.message : t("error.generic");
  }

  function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
  }

  function startsNow(): number[] {
    return barCount > 0 ? songStarts(song.document) : [];
  }

  function seedAnchors(): Record<string, number> {
    const next = { ...song.document.sync.anchors };
    return Object.keys(next).length ? next : pointAnchors(song.document.sync, barCount);
  }

  async function flushSync(): Promise<void> {
    window.clearTimeout(saveTimer);
    const run = pendingSync;
    pendingSync = null;
    if (run) await run();
  }

  function commitAnchors(next: Record<string, number>, bpm = song.document.bpm) {
    song.document.sync.anchors = next;
    song.document.bpm = bpm;
    const songId = song.id;
    saveLabel = t("editor.saving");
    pendingSync = async () => {
      try {
        const saved: SongDetail = await patchSync(songId, { bpm, anchors: next });
        if (song.id === songId) song.revision = saved.revision;
        saveLabel = t("editor.saved");
      } catch (err) {
        error = message(err);
      }
    };
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flushSync(), 250);
  }

  function applySync() {
    const instance = player.api;
    if (!instance?.score || barCount <= 0) return;
    const built = flatSyncPoints(startsNow(), order);
    shiftMs = built.shiftMs;
    instance.score.applyFlatSyncPoints(built.points);
    instance.updateSyncPoints();
  }

  function paintAudioClock() {
    if (!song.has_audio || !audioEl) return;
    const seconds = audioEl.currentTime;
    const output = player.api?.player?.output as
      alphaTab.synth.IExternalMediaSynthOutput | undefined;
    output?.updatePosition(seconds * 1000 + shiftMs);
    const starts = startsNow();
    currentMeasure = measureAt(starts, seconds);
    currentPosition = positionInBar(
      starts,
      currentMeasure,
      seconds,
      playedBarTicks(song.document, currentMeasure),
    );
    if (loopA != null && loopB != null && currentMeasure > loopB && !audioEl.paused) {
      handleLoopTurnaround();
    }
    clock = formatTime(seconds);
    currentSeconds = seconds;
    playing = !audioEl.paused;
  }

  $effect(() => {
    const element = host;
    const scrollElement = scroller;
    const source = tex;
    const useAudio = song.has_audio;
    if (!element || !scrollElement) return;
    const settings = new alphaTab.Settings();
    settings.core.fontDirectory = new URL("font/", document.baseURI).href;
    settings.core.logLevel = alphaTab.LogLevel.Warning;
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = staveProfile(untrack(() => ui.notation));
    separateEffectBands(settings);
    settings.display.scale = untrack(() => (handsFree.stage ? STAGE_SCALE : 1));
    settings.player.playerMode = useAudio
      ? alphaTab.PlayerMode.EnabledExternalMedia
      : alphaTab.PlayerMode.EnabledSynthesizer;
    settings.player.soundFont = new URL("soundfont/sonivox.sf2", document.baseURI).href;
    settings.player.enableCursor = true;
    settings.player.enableElementHighlighting = true;
    settings.player.enableUserInteraction = true;
    settings.player.scrollElement = scrollElement;
    // Negative: the playing system stops a little below the top edge, not above it.
    settings.player.scrollOffsetY = -16;
    settings.player.scrollMode = untrack(() => follow)
      ? alphaTab.ScrollMode.Continuous
      : alphaTab.ScrollMode.Off;
    const instance = new alphaTab.AlphaTabApi(element, settings);
    player.api = instance;
    instance.scoreLoaded.on(() => {
      queueMicrotask(() => {
        scoreReady += 1;
        applyPractice();
      });
    });
    instance.playerReady.on(() => {
      if (!useAudio || !audioEl) return;
      const output = instance.player?.output as
        alphaTab.synth.IExternalMediaSynthOutput | undefined;
      if (output) output.handler = new AudioMedia(audioEl, () => shiftMs);
      audioEl.playbackRate = untrack(() => rate);
      applyPractice();
    });
    // Without audio, alphaTab's own events say where playback is, tempo changes included.
    instance.playedBeatChanged.on((beat) => {
      if (useAudio) return;
      currentMeasure = followPlayed(
        playedBars(untrack(() => song.document.bars)),
        beat.voice.bar.index,
        currentMeasure,
      );
      currentPosition = beat.displayStart;
      const doc = untrack(() => song.document);
      currentSeconds = timeAtBarPosition(
        highwayStarts(doc, false),
        currentMeasure,
        currentPosition,
        playedBarTicks(doc, currentMeasure),
      );
      // The synth has no loop of its own: past the end of the range, go back to its start.
      if (loopA != null && loopB != null && currentMeasure > loopB && playing) {
        handleLoopTurnaround();
        return;
      }
      if (waitRun && beat.voice.bar.staff.track.index === untrack(() => trackIndex)) {
        const index = stepIndexAt(
          untrack(() => waitSteps),
          currentMeasure,
          beat.displayStart,
        );
        if (index >= 0) waitRun.reach(index);
      }
    });
    // A click on the score moves alphaTab's cursor; wait mode follows it to the clicked beat.
    instance.beatMouseDown.on((beat) => {
      if (!waitRun || beat.voice.bar.staff.track.index !== untrack(() => trackIndex)) return;
      followWaitClick(beat.voice.bar.index, beat.displayStart);
    });
    instance.playerFinished.on(() => {
      if (scoreRun?.running) {
        scoreRun.finish();
        return;
      }
      if (loopA != null && loopB != null && loopB >= barCount - 1 && playing) {
        handleLoopTurnaround();
        return;
      }
      if (!waitRun) return;
      // Played through from the first note, not looped: it goes to the practice log and to the lesson.
      if (waitRun.completed && (loopA == null || loopB == null)) {
        practiceTimer.complete();
        void lessonBanner?.report({ kind: "wait" });
      }
      waitState = "done";
      waitStep = null;
      waitRun.seek(0);
    });
    instance.playerPositionChanged.on((event) => {
      if (!useAudio) {
        clock = formatTime(event.currentTime / 1000);
        if (untrack(() => waitState) !== "waiting") currentSeconds = event.currentTime / 1000;
      }
    });
    instance.playerStateChanged.on((event) => {
      if (!useAudio) playing = event.state === alphaTab.synth.PlayerState.Playing;
    });
    instance.tex(source, [untrack(() => trackIndex)]);
    return () => {
      scoreReady = 0;
      player.api = null;
      instance.destroy();
    };
  });

  $effect(() => {
    if (!scoreReady) return;
    void song.document.bpm;
    void song.document.sync.anchors;
    void song.document.sync.points;
    applySync();
  });

  // Switching track redraws the score that is already loaded instead of parsing it again.
  $effect(() => {
    const index = trackIndex;
    if (!scoreReady) return;
    untrack(() => {
      const api = player.api;
      const target = api?.score?.tracks[index];
      if (!api || !target || api.tracks[0]?.index === target.index) return;
      api.renderTracks([target]);
      applySync();
    });
  });

  // Slowing the recording must not change its pitch.
  $effect(() => {
    if (audioEl) preservePitch(audioEl);
  });

  // The metronome click has to be re-planned whenever the clock jumps.
  $effect(() => {
    const element = audioEl;
    if (!element) return;
    const reset = () => scheduler.reset();
    const events = ["seeking", "play", "pause", "ratechange"] as const;
    for (const name of events) element.addEventListener(name, reset);
    return () => {
      for (const name of events) element.removeEventListener(name, reset);
    };
  });

  // Follow scrolls inside the score, so the score itself must sit clear of the
  // floating dock; its scroll-margin-bottom in app.css leaves room for the dock.
  $effect(() => {
    if (!playing || !follow || !scroller || ui.playerView === "highway") return;
    const score = scroller;
    untrack(() => {
      // On a phone the fretboard rides above the dock, so the score must clear it too.
      const dock = (
        document.querySelector("[data-testid=player-fretboard]") ??
        document.querySelector(".dock-bar")
      )?.getBoundingClientRect();
      const box = score.getBoundingClientRect();
      if (box.top >= 0 && (!dock || box.bottom <= dock.top)) return;
      const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
      score.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    });
  });

  // Stuck on one note with no input for a couple of minutes: stop counting until the player moves on.
  let waitIdle = $state(false);
  $effect(() => {
    if (!waitOn || waitState !== "waiting") return;
    void waitStep;
    const watch = new IdleWatch(WAIT_IDLE_MS, () => (waitIdle = true));
    watch.arm();
    return () => {
      watch.disarm();
      waitIdle = false;
    };
  });

  // In wait mode the synth stops on each note, so waiting for the player to play it still counts.
  $effect(() => {
    const loop = loopA != null && loopB != null;
    const named = loop
      ? practice.loops.find((l) => l.id === activeLoopId || (l.a === loopA && l.b === loopB))
      : undefined;
    practiceTimer.update(
      playing || (waitOn && ((waitState === "waiting" && !waitIdle) || waitState === "hit")),
      {
        songId: song.id,
        trackId,
        loopName: named?.name ?? "",
        loopStart: loop ? loopA : null,
        loopEnd: loop ? loopB : null,
        mode: scoreOn ? "scored" : waitOn ? "wait" : "free",
        speed: rate,
        // The latest pass's accuracy, as a percent with one decimal.
        score:
          scoreOn && scoreSummary && scoreSummary.graded > 0
            ? Math.round(scoreSummary.accuracy * 1000) / 10
            : null,
      },
    );
  });

  onMount(() => {
    const leaving = () => practiceTimer.flush(true);
    const hidden = () => {
      if (document.visibilityState === "hidden") leaving();
    };
    window.addEventListener("pagehide", leaving);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", leaving);
      document.removeEventListener("visibilitychange", hidden);
      practiceTimer.flush();
      practiceTimer.dispose();
    };
  });

  onMount(() => {
    if (typeof location !== "undefined") {
      const params = new URLSearchParams(location.search);
      const loopParam = params.get("loop");
      if (loopParam) {
        const found = practice.loops.find(
          (l) => l.id === loopParam || l.name.toLowerCase() === loopParam.toLowerCase(),
        );
        if (found) {
          activateLoop(found);
        }
      }
    }
    const timer = window.setInterval(paintAudioClock, 50);
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      // Space and T in the Auto-sync preview must not tap a bar behind the sheet.
      if (target?.closest('[data-testid="autosync-sheet"]')) return;
      // A focused button already handles Space itself.
      if (target?.tagName === "BUTTON" && event.key === " ") return;
      // A page-turner pedal sends ordinary keys; the ones the user mapped win over the shortcuts.
      const pedal = isTyping(target) ? null : pedalAction(event);
      if (
        pedal === "nextPage" ||
        pedal === "previousPage" ||
        pedal === "toggle" ||
        pedal === "loop"
      ) {
        event.preventDefault();
        if (pedal === "toggle") toggle();
        else if (pedal === "loop") toggleLoop();
        else pageBy(pedal === "nextPage" ? 1 : -1);
        return;
      }
      const action = shortcutFor(event);
      if (!action) return;
      // The help dialog is modal: only its own key works while it is open.
      if (helpOpen && action !== "help") return;
      event.preventDefault();
      perform(action);
    };
    const metronome = window.setInterval(tickMetronome, 25);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(metronome);
      window.clearTimeout(countInTimer);
      clicker.close();
      waitRun?.stop();
      scoreRun?.stop();
      document.removeEventListener("keydown", onKey);
      // Leaving the page must not lose a tap that is still waiting to be saved.
      void flushSync();
    };
  });

  function perform(action: ShortcutAction) {
    switch (action) {
      case "toggle":
        return toggle();
      case "previousBar":
        return step(-1);
      case "nextBar":
        return step(1);
      case "tap":
        return tap();
      case "metronome":
        practice.metronome.on = !practice.metronome.on;
        return practiceChanged();
      case "countIn":
        practice.countIn.bars = nextCountIn(practice.countIn.bars);
        return practiceChanged();
      case "muteTrack":
      case "soloTrack": {
        // Tracks only sound through the synth; a recording plays as one mix.
        if (song.has_audio) return;
        const mix = (practice.mix.tracks[track.id] ??= trackMix(practice, track.id));
        if (action === "muteTrack") mix.mute = !mix.mute;
        else mix.solo = !mix.solo;
        return practiceChanged();
      }
      case "volumeDown":
      case "volumeUp": {
        const key = song.has_audio ? "audio" : "synth";
        const delta = action === "volumeUp" ? 0.05 : -0.05;
        practice.mix[key] = Math.round(clamp01(practice.mix[key] + delta, 1) * 100) / 100;
        return practiceChanged();
      }
      case "slower":
        return setRate(stepRate(rate, -1));
      case "faster":
        return setRate(stepRate(rate, 1));
      case "help":
        helpOpen = !helpOpen;
    }
  }

  /** Pushes the mixer, metronome and volume settings to the synth or the recording, and remembers them. */
  function applyPractice() {
    savePractice(song.id, practice);
    // While stems play, the recording stays silent and the stems carry the volume.
    if (audioEl && !stemsActive) audioEl.volume = practice.mix.audio;
    const api = player.api;
    // A recording plays without the synth, so the synth's own metronome and tracks are silent.
    if (!api?.score || song.has_audio) return;
    api.metronomeVolume = practice.metronome.on ? practice.metronome.volume : 0;
    api.masterVolume = waitOn && practice.wait.silent ? 0 : practice.mix.synth;
    api.score.tracks.forEach((item, index) => {
      const id = document_.tracks[index]?.id;
      if (id === undefined) return;
      const mix = trackMix(practice, id);
      api.changeTrackVolume([item], mix.volume);
      // In wait mode the player plays the chosen track, so it is left out of the backing.
      api.changeTrackMute([item], mix.mute || ((waitOn || scoreOn) && index === trackIndex));
      api.changeTrackSolo([item], mix.solo);
    });
  }

  function practiceChanged() {
    applyPractice();
    if (practice.metronome.on) clicker.unlock();
  }

  /** Seconds one bar lasts on the wall clock, at the current speed. */
  function barLength(index: number): number {
    const starts = song.has_audio ? startsNow() : [];
    const length =
      starts.length > index + 1 ? starts[index + 1] - starts[index] : barSeconds(document_)[index];
    return (length ?? 2) / rate;
  }

  /** Clicks the bars in, then calls `then`. Without a count-in it calls `then` at once. */
  function runCountIn(index: number, then: () => void, overrideBars?: number) {
    const bars = overrideBars ?? practice.countIn.bars;
    if (bars <= 0 || countingIn) return then();
    const bar = Math.min(Math.max(index, 0), Math.max(barCount - 1, 0));
    const signature = document_.bars[bar]?.signature ?? [4, 4];
    const plan = countInClicks(signature, barLength(bar), bars);
    clicker.unlock();
    const volume = Math.max(practice.metronome.volume, 0.3);
    for (const click of plan.clicks) clicker.click(click.time, click.accent, volume);
    countingIn = true;
    countInTimer = window.setTimeout(() => {
      countingIn = false;
      then();
    }, plan.duration * 1000);
  }

  function cancelCountIn() {
    window.clearTimeout(countInTimer);
    countingIn = false;
  }

  function tickMetronome() {
    if (!song.has_audio || !audioEl || audioEl.paused || countingIn || !practice.metronome.on)
      return;
    const starts = startsNow();
    if (starts.length === 0) return;
    for (const click of scheduler.due(
      starts,
      document_.bars,
      audioEl.currentTime,
      audioEl.playbackRate,
      0.12,
    ))
      clicker.click(click.delay, click.accent, practice.metronome.volume);
  }

  function toggle() {
    const api = player.api;
    if (!api) return;
    if (countingIn) return cancelCountIn();
    if (waitRun && waitState === "waiting") return waitRun.skip();

    if (practice.speedTrainer.enabled && !playing) {
      if (!speedTrainerRunning) {
        speedTrainerPercent = practice.speedTrainer.startPercent;
        speedTrainerPass = 1;
        speedTrainerCompleted = false;
        speedTrainerRunning = true;
        setRate(speedTrainerPercent / 100);
      }
      if (loopA != null && (currentMeasure < loopA || (loopB != null && currentMeasure > loopB))) {
        goToBar(loopA);
      }
    }

    const countBars = practice.speedTrainer.enabled
      ? Math.max(1, practice.countIn.bars)
      : practice.countIn.bars;

    if (song.has_audio && audioEl) {
      if (audioEl.paused) runCountIn(currentMeasure, () => api.play(), countBars);
      else api.pause();
      return;
    }
    if (api.playerState === alphaTab.synth.PlayerState.Playing) api.pause();
    else runCountIn(currentMeasure, () => api.play(), countBars);
  }

  function openAutoSync() {
    if (playing) toggle();
    autoSyncOpen = true;
  }

  function acceptAutoSync(anchors: Record<string, number>) {
    commitAnchors(anchors);
    tapIndex = 0;
    autoSyncOpen = false;
  }

  function step(direction: number) {
    goToBar((currentMeasure < 0 ? 0 : currentMeasure) + direction);
  }

  function goToBar(target: number) {
    if (barCount <= 0) return;
    const index = Math.min(barCount - 1, Math.max(0, target));
    tapIndex = index;
    currentPosition = 0;
    if (song.has_audio && audioEl) {
      const targetTime = Math.max(0, startsNow()[index] ?? 0);
      audioEl.currentTime = targetTime;
      currentSeconds = targetTime;
      currentMeasure = index;
      if (scoreRun) scoreRun.begin(scoreRange(index));
    } else if (player.api) {
      const tick = tickOfBar(index);
      player.api.tickPosition = tick;
      currentMeasure = index;
      currentSeconds = Math.max(0, highwayStarts(song.document, false)[index] ?? 0);
      if (scoreRun) scoreRun.begin(scoreRange(index));
      if (waitRun) {
        waitRun.seek(tick);
        waitStep = null;
        if (waitState !== "idle") waitState = "idle";
      }
    }
  }

  /** The player clicked a beat of the score while wait mode is on: wait on it, or play on from it. */
  function followWaitClick(written: number, position: number) {
    if (!waitRun) return;
    const played = followPlayed(order, written, currentMeasure);
    if (played < 0) return;
    currentMeasure = played;
    currentPosition = position;
    waitStep = null;
    if (waitState !== "idle") waitState = "idle";
    waitRun.reposition(tickOfBar(played) + position);
  }

  function tap() {
    if (!song.has_audio || !audioEl || barCount <= 0) return;
    commitAnchors(moveAnchor(seedAnchors(), startsNow(), tapIndex, audioEl.currentTime));
    tapIndex = Math.min(barCount - 1, tapIndex + 1);
  }

  function nudge(delta: number) {
    if (currentMeasure < 0 || currentMeasure >= barCount) return;
    const starts = startsNow();
    commitAnchors(
      moveAnchor(seedAnchors(), starts, currentMeasure, starts[currentMeasure] + delta),
    );
  }

  function clearCurrent() {
    if (currentMeasure < 0) return;
    const next = { ...song.document.sync.anchors };
    delete next[String(currentMeasure)];
    commitAnchors(next);
  }

  function setLoop(which: "a" | "b") {
    if (barCount <= 0) return;
    const bar = Math.min(barCount - 1, Math.max(0, currentMeasure));
    activeLoopId = null;
    if (which === "a") {
      loopA = bar;
      if (loopB == null || loopB < bar) loopB = bar;
    } else {
      loopB = bar;
      if (loopA == null || loopA > bar) loopA = bar;
    }
  }

  /** Pedal: clear the loop, else loop the bar being played (or the first one). */
  function toggleLoop() {
    if (loopA != null && loopB != null) return clearLoop();
    if (barCount <= 0) return;
    const bar = Math.min(barCount - 1, Math.max(0, currentMeasure));
    activeLoopId = null;
    loopA = bar;
    loopB = bar;
  }

  function pageBy(direction: 1 | -1) {
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollBy({
      top: pageDelta(window.innerHeight, direction),
      behavior: calm ? "auto" : "smooth",
    });
  }

  // Stage mode draws the score larger and hides everything around it.
  $effect(() => {
    const api = player.api;
    const scale = handsFree.stage ? STAGE_SCALE : 1;
    if (!api || api.settings.display.scale === scale) return;
    api.settings.display.scale = scale;
    api.updateSettings();
    api.render();
  });

  // Scored grades colour the notation too; redraws are batched because grades arrive note by note.
  let gradeRedraw = 0;
  $effect(() => {
    const grades = scoreGrades;
    const index = trackIndex;
    if (!scoreReady) return;
    untrack(() => {
      const api = player.api;
      const target = api?.score?.tracks[index];
      if (!api || !target) return;
      if (!colourScoreGrades(target, grades, playedBars(song.document.bars))) return;
      window.clearTimeout(gradeRedraw);
      gradeRedraw = window.setTimeout(() => player.api?.render(), 120);
    });
  });
  $effect(() => () => window.clearTimeout(gradeRedraw));

  function clearLoop() {
    loopA = null;
    loopB = null;
    activeLoopId = null;
    speedTrainerRunning = false;
    speedTrainerCompleted = false;
  }

  function activateLoop(loop: SavedLoop) {
    loopA = loop.a;
    loopB = loop.b;
    activeLoopId = loop.id;
    if (practice.speedTrainer.enabled) {
      speedTrainerPercent = practice.speedTrainer.startPercent;
      speedTrainerPass = 1;
      speedTrainerCompleted = false;
      speedTrainerRunning = false;
      setRate(speedTrainerPercent / 100);
    }
    goToBar(loop.a);
  }

  function recordCurrentLoopSpeed(speedRatio: number) {
    if (loopA == null || loopB == null) return;
    const matching = practice.loops.find(
      (l) => l.id === activeLoopId || (l.a === loopA && l.b === loopB),
    );
    if (matching) {
      const res = updateLoopHighestSpeed(practice.loops, matching.id, speedRatio);
      if (res.updated) {
        practice.loops = res.loops;
        savePractice(song.id, practice);
      }
    }
  }

  function handleLoopTurnaround() {
    if (loopA == null || loopB == null) return;
    // A scored pass covers the loop once: grade it and show the results instead of going round again.
    if (scoreRun?.running) {
      scoreRun.finish();
      return;
    }

    if (practice.speedTrainer.enabled) {
      const currentRatio = speedTrainerPercent / 100;
      recordCurrentLoopSpeed(currentRatio);

      if (speedTrainerPass < practice.speedTrainer.passesPerStep) {
        speedTrainerPass += 1;
      } else {
        speedTrainerPass = 1;
        const nextPct = calcNextSpeed(
          speedTrainerPercent,
          practice.speedTrainer.targetPercent,
          practice.speedTrainer.stepPercent,
        );
        speedTrainerCompleted =
          nextPct >= practice.speedTrainer.targetPercent &&
          speedTrainerPercent >= practice.speedTrainer.targetPercent;
        speedTrainerPercent = nextPct;
        setRate(speedTrainerPercent / 100);
        recordCurrentLoopSpeed(speedTrainerPercent / 100);
      }
    }

    const needCountIn =
      practice.speedTrainer.enabled || (practice.countIn.bars > 0 && practice.countIn.beforeLoops);
    const countBars = practice.speedTrainer.enabled
      ? Math.max(1, practice.countIn.bars)
      : practice.countIn.bars;

    const targetBar = loopA;
    scheduler.reset();

    if (song.has_audio && audioEl) {
      const element = audioEl;
      const starts = startsNow();
      const targetTime = Math.max(0, starts[targetBar] ?? 0);
      element.currentTime = targetTime;
      currentSeconds = targetTime;
      currentMeasure = targetBar;

      if (needCountIn && !countingIn) {
        element.pause();
        runCountIn(
          targetBar,
          () => {
            if (playing) void element.play();
          },
          countBars,
        );
      }
    } else {
      goToBar(targetBar);
      if (needCountIn && !countingIn) {
        player.api?.pause();
        runCountIn(
          targetBar,
          () => {
            if (playing && player.api) player.api.play();
          },
          countBars,
        );
      }
    }
  }

  async function startWait() {
    const api = player.api;
    if (!api || song.has_audio || waitRun) return;
    if (scoreRun) stopScore();
    waitError = "";
    waitGrades = {};
    const run = new WaitRun({
      steps: waitSteps,
      listen: listenWithInput,
      match: { anyOctave: practice.wait.anyOctave },
      hintSeconds: practice.wait.hintSeconds,
      onWait: (step) => {
        player.api?.pause();
        window.clearTimeout(waitFlash);
        waitStep = step;
        waitHitStep = null;
        waitHint = false;
        waitState = "waiting";
        currentSeconds = timeAtBarPosition(
          highwayStarts(song.document, false),
          step.bar,
          step.position,
          playedBarTicks(song.document, step.bar),
        );
      },
      onHit: (step) => {
        const wasHit = run.hits > waitHits;
        waitHits = run.hits;
        waitGrades = {
          ...waitGrades,
          [gemKey(step.bar, step.position)]: wasHit ? "hit" : "missed",
        };
        waitHint = false;
        waitHitStep = wasHit ? step : null;
        waitStep = null;
        waitState = "hit";
        window.clearTimeout(waitFlash);
        waitFlash = window.setTimeout(() => {
          if (waitState === "hit") waitState = "idle";
        }, 400);
        player.api?.play();
      },
      onHint: () => (waitHint = true),
    });
    try {
      await run.start();
    } catch (err) {
      waitError = err instanceof ListenError ? describeProblem(err.problem) : message(err);
      return;
    }
    waitRun = run;
    listenSession = run.listening;
    waitOn = true;
    waitHits = 0;
    waitState = "idle";
    waitRun.seek(currentMeasure > 0 ? tickOfBar(currentMeasure) : 0);
    applyPractice();
  }

  function stopWait() {
    window.clearTimeout(waitFlash);
    waitRun?.stop();
    waitRun = null;
    listenSession = null;
    listenLevel = 0;
    waitOn = false;
    waitState = "idle";
    waitStep = null;
    waitHitStep = null;
    waitHint = false;
    waitGrades = {};
    applyPractice();
  }

  // `currentSeconds` is only repainted every 50 ms (and per synth event), which would read every
  // note a little early against a 100 ms hit window: scoring asks the clocks directly.
  let clockStamp = 0;
  $effect(() => {
    void currentSeconds;
    clockStamp = performance.now();
  });

  function songNow(): number {
    if (song.has_audio && audioEl) return audioEl.currentTime;
    return playing
      ? currentSeconds + ((performance.now() - clockStamp) / 1000) * rate
      : currentSeconds;
  }

  /** The part of the song a scored pass covers: the loop, or from `bar` to the end. */
  function scoreRange(bar: number): { from: number; to: number } {
    const starts = highwayStarts(song.document, song.has_audio);
    if (loopA != null && loopB != null) {
      return { from: starts[loopA] ?? 0, to: starts[loopB + 1] ?? starts[starts.length - 1] ?? 0 };
    }
    return { from: starts[Math.max(0, bar)] ?? 0, to: starts[starts.length - 1] ?? 0 };
  }

  async function startScore() {
    if (!player.api || scoreRun) return;
    if (waitRun) stopWait();
    scoreError = "";
    scoreBleed = false;
    scoreGrades = {};
    // Round trip from the calibration for the default device pair, in seconds.
    const latency = getLocalCalibration("default", "default");
    scoreCalibrated = latency !== null;
    const run: ScoredRun = new ScoredRun({
      steps: scoredSteps,
      barCount,
      listen: listenWithInput,
      songTime: songNow,
      rate: () => rate,
      latencySeconds: (latency ?? 0) / 1000,
      onGrades: (changed, grades, summary) => {
        scoreSummary = summary;
        if (changed.length === 0) {
          scoreGrades = {};
          return;
        }
        const next = { ...scoreGrades };
        for (const index of changed) {
          const grade = grades[index] as NoteGrade;
          next[gemKey(scoredSteps[index].bar, scoredSteps[index].position)] = grade;
        }
        scoreGrades = next;
      },
      onAttacks: (attacks, restAttacks) => {
        scoreBleed = song.has_audio && bleedSuspected(restAttacks, attacks);
      },
      onComplete: (summary) => {
        player.api?.pause();
        showScoreResult(summary, run.attacks > 0);
      },
    });
    try {
      await run.start(scoreRange(currentMeasure));
    } catch (err) {
      scoreError = err instanceof ListenError ? describeProblem(err.problem) : message(err);
      return;
    }
    scoreRun = run;
    scoreOn = true;
    applyPractice();
  }

  function showScoreResult(summary: ScoreSummary, played: boolean) {
    const loop = loopA != null && loopB != null ? { from: loopA, to: loopB } : null;
    const speed = Math.round(rate * 100);
    const key = loopKey(loop ? { a: loop.from, b: loop.to } : null);
    let isBest = false;
    let best = personalBest(loadScores(song.id), key, speed);
    // A pass nobody played in (the microphone heard nothing) is shown, but not saved.
    if (played && summary.graded > 0) {
      const saved = recordScore(song.id, {
        at: Date.now(),
        accuracy: summary.accuracy,
        stars: starsFor(summary.accuracy, summary.graded),
        hits: summary.counts.hit,
        total: summary.total,
        extras: summary.extras,
        bestStreak: summary.bestStreak,
        loop: key,
        speed,
      });
      isBest = saved.isBest;
      best = saved.isBest ? saved.previous : best;
    }
    scoreResult = {
      summary,
      sections: sectionScores(document_, summary.bars),
      speed,
      loop,
      isBest,
      best,
    };
    scoreResultsOpen = true;
    if (played && summary.graded > 0) {
      void lessonBanner?.report({
        kind: "scored",
        accuracy: summary.accuracy * 100,
        songBpm: song.document.bpm,
        rate,
        wholeSong: !loop && summary.total >= scoredSteps.length,
      });
    }
  }

  function stopScore() {
    scoreRun?.stop();
    scoreRun = null;
    scoreOn = false;
    scoreSummary = null;
    scoreGrades = {};
    scoreBleed = false;
    scoreResultsOpen = false;
    applyPractice();
  }

  function toggleScore() {
    if (scoreOn) stopScore();
    else void startScore();
  }

  function playScoreAgain() {
    scoreResultsOpen = false;
    goToBar(loopA ?? 0);
  }

  function practiseSection(from: number, to: number) {
    scoreResultsOpen = false;
    activeLoopId = null;
    loopA = from;
    loopB = to;
    goToBar(from);
  }

  function toggleWait() {
    if (waitOn) stopWait();
    else void startWait();
  }

  /** alphaTab's ticks run through the expanded song, so sum the bars as played. */
  function tickOfBar(index: number): number {
    let tick = 0;
    for (let cursor = 0; cursor < index; cursor += 1)
      tick += barTicks(song.document.bars[order[cursor]].signature);
    return tick;
  }

  // Changing track or adding a recording ends wait mode: its steps belong to the old track.
  $effect(() => {
    void trackId;
    void song.has_audio;
    untrack(() => {
      if (waitRun) stopWait();
      if (scoreRun) stopScore();
    });
  });

  function setFollow(checked: boolean) {
    follow = checked;
    const api = player.api;
    if (!api) return;
    api.settings.player.scrollMode = checked
      ? alphaTab.ScrollMode.Continuous
      : alphaTab.ScrollMode.Off;
    api.updateSettings();
  }

  function toggleNotation() {
    setNotation(!ui.notation);
    const api = player.api;
    if (!api) return;
    api.settings.display.staveProfile = staveProfile(ui.notation);
    api.updateSettings();
    api.render();
  }

  function setRate(value: number) {
    rate = value;
    scheduler.reset();
    if (audioEl) audioEl.playbackRate = value;
    if (player.api) player.api.playbackSpeed = value;
  }

  async function onUpload(file: File) {
    try {
      await flushSync();
      song = (await uploadAudio(song.id, file)) as TabSong;
    } catch (err) {
      error = err instanceof ApiError ? err.message : message(err);
    }
  }

  async function onYouTubeAudio() {
    song = (await getSong(song.id)) as TabSong;
  }

  let exporting = $state(false);
  let panelOpen = $state(false);
  // Phones fold the less-used dock buttons into a ⋯ popover (app.css).
  let moreOpen = $state(false);
  const loopStyle = $derived(
    loopA != null && loopB != null && barCount > 1
      ? `left:${(loopA / barCount) * 100}%;width:${((loopB - loopA + 1) / barCount) * 100}%`
      : "",
  );

  function exportUrl(kind: string): string {
    return new URL(`api/songs/${song.id}/export.${kind}`, document.baseURI).toString();
  }

  async function exportPdf() {
    exporting = true;
    error = "";
    const current = track;
    try {
      const { downloadTrackPdf } = await import("../lib/export/pdf");
      await downloadTrackPdf({
        document: song.document,
        trackId: current.id,
        title: song.title,
        artist: song.artist,
        capoLabel: current.capo > 0 ? t("player.capo", { fret: current.capo }) : "",
        notation: ui.notation,
      });
    } catch {
      error = t("player.exportPdfFailed");
    } finally {
      exporting = false;
    }
  }
</script>

<div
  class="song-page player-page"
  class:stage={handsFree.stage}
  class:has-fretboard={practice.fretboard.on}
>
  {#if lessonRef}<LessonRunBanner bind:this={lessonBanner} lesson={lessonRef} />{/if}
  <header class="song-header">
    <a class="back-link" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}
      ><Icon name="back" size={18} />{t("app.back")}</a
    >
    <div class="song-hero">
      <Cover
        id={song.id}
        title={song.title}
        strings={track.tuning_midi.length}
        size="lg"
        src={coverSrc(song.cover_url)}
      />
      <div class="song-hero-text">
        <p class="eyebrow">{instrumentLabel(track.instrument)}</p>
        <h1 class="display song-heading" data-testid="song-heading">{song.title}</h1>
        {#if song.artist}<p class="song-byline">{song.artist}</p>{/if}
        <div class="pills">
          <span class="pill">{tuningLabel(track.tuning_midi)}</span>
          <span class="pill"
            >{track.capo > 0 ? t("player.capo", { fret: track.capo }) : t("player.noCapo")}</span
          >
          <span class="pill">{t("library.tempo", { bpm: song.document.bpm })}</span>
          <span class="pill">{t("library.measures", { count: document_.bars.length })}</span>
          {#if song.source_ref.rhythm_estimated}<span
              class="pill"
              data-testid="rhythm-estimated-pill"
              title={t("asciiTab.rhythmEstimatedHint")}>{t("asciiTab.rhythmEstimated")}</span
            >{/if}
          {#if song.has_audio}<span class="pill pill-accent"
              ><Icon name="waveform" size={14} />{t("library.audio")}</span
            >{/if}
          <button
            type="button"
            class="pill pill-button"
            data-testid="song-retune"
            onclick={() => (retuneOpen = true)}
          >
            <Icon name="sliders" size={14} />{t("retune.open")}
          </button>
        </div>
        {#if practice.loops.length > 0}
          <div
            class="song-saved-loops"
            data-testid="song-saved-loops"
            aria-label={t("speedTrainer.savedLoops")}
          >
            <span class="saved-loops-label"
              ><Icon name="repeat" size={14} />{t("speedTrainer.savedLoops")}:</span
            >
            <div class="saved-loops-pills">
              {#each practice.loops as loop (loop.id)}
                <button
                  type="button"
                  class="pill pill-button"
                  class:pill-accent={loopA === loop.a && loopB === loop.b}
                  data-testid={`song-page-loop-${loop.id}`}
                  onclick={() => activateLoop(loop)}
                  title={t("speedTrainer.jumpToLoop", {
                    name: loop.name,
                    a: loop.a + 1,
                    b: loop.b + 1,
                  })}
                >
                  <span class="loop-name">{loop.name}</span>
                  <span class="loop-range"
                    >{t("player.loopRange", { a: loop.a + 1, b: loop.b + 1 })}</span
                  >
                  {#if loop.highestSpeed != null}
                    <span class="loop-speed" data-testid={`song-page-loop-speed-${loop.id}`}>
                      {formatSpeedPercent(loop.highestSpeed)}
                    </span>
                  {/if}
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      <div class="hero-actions">
        <OfflineToggle kind="song" id={song.id} title={song.title} compact />
        <FullscreenToggle placement="header" />
        <div
          class="segmented"
          role="group"
          aria-label={t("highway.view")}
          data-testid="player-view-switcher"
        >
          <button
            type="button"
            data-testid="player-view-tab"
            aria-pressed={ui.playerView === "tab"}
            onclick={() => setPlayerView("tab")}
          >
            {t("highway.tab")}
          </button>
          <button
            type="button"
            data-testid="player-view-highway"
            aria-pressed={ui.playerView === "highway"}
            onclick={() => setPlayerView("highway")}
          >
            {t("highway.highway")}
          </button>
          <button
            type="button"
            data-testid="player-view-split"
            aria-pressed={ui.playerView === "split"}
            onclick={() => setPlayerView("split")}
          >
            {t("highway.split")}
          </button>
        </div>
        {#if !ui.demoMode}
          <a
            class="button"
            data-testid="song-edit-link"
            href={hrefFor(`/songs/${song.id}/edit`)}
            onclick={(event) => followLink(event, `/songs/${song.id}/edit`)}
          >
            <Icon name="edit" size={18} /><span>{t("player.edit")}</span>
          </a>
        {/if}
        <button
          data-testid="song-tuner"
          onclick={() => openTuner({ tuning: track.tuning_midi, capo: track.capo })}
        >
          <Icon name="tuner" size={18} /><span>{t("tuner.open")}</span>
        </button>
        <Menu label={t("player.export")} icon="download" testid="export-menu">
          {#snippet children(close)}
            {#if !ui.demoMode}
              <button
                class="menu-item"
                data-testid="song-add-to-setlist"
                role="menuitem"
                onclick={() => {
                  close();
                  pickerOpen = true;
                }}
              >
                <Icon name="list" size={18} />
                {t("setlists.addToSetlist")}
              </button>
            {/if}
            <button
              class="menu-item"
              data-testid="export-pdf"
              role="menuitem"
              disabled={exporting}
              onclick={() => {
                close();
                void exportPdf();
              }}
            >
              <Icon name="file" size={18} />
              {exporting
                ? t("player.exportingPdf")
                : song.document.tracks.length > 1
                  ? t("player.exportPdfTrack", { name: track.name })
                  : t("player.exportPdf")}
            </button>
            <a
              class="menu-item"
              data-testid="export-musicxml"
              role="menuitem"
              href={exportUrl("musicxml")}
              onclick={close}><Icon name="layers" size={18} />{t("player.exportMusicXml")}</a
            >
            <a
              class="menu-item"
              data-testid="export-midi"
              role="menuitem"
              href={exportUrl("mid")}
              onclick={close}><Icon name="download" size={18} />{t("player.exportMidi")}</a
            >
            <a
              class="menu-item"
              data-testid="export-json"
              role="menuitem"
              href={exportUrl("json")}
              onclick={close}><Icon name="download" size={18} />{t("player.exportJson")}</a
            >
          {/snippet}
        </Menu>
      </div>
    </div>
    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
  </header>

  {#if song.has_audio}
    <audio data-testid="player-audio" bind:this={audioEl} src={audioSrc} preload="auto"></audio>
  {/if}
  <div class="player-stage" data-testid="player-stage" data-view={ui.playerView}>
    {#if ui.playerView === "highway" || ui.playerView === "split"}
      <div class="highway-wrap" data-testid="player-highway">
        <Highway
          document={document_}
          {track}
          hasAudio={song.has_audio}
          currentTime={currentSeconds}
          {playing}
          {rate}
          {loopA}
          {loopB}
          grades={scoreOn ? scoreGrades : waitOn ? waitGrades : undefined}
          waitingAt={waitOn && waitState === "waiting" && waitStep
            ? { bar: waitStep.bar, position: waitStep.position }
            : null}
          onseek={goToBar}
        />
      </div>
    {/if}
    <!-- Scrolls on its own, so keyboard users need to be able to focus it. -->
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="paper score"
      data-testid="player-score"
      data-hidden={ui.playerView === "highway" ? "true" : undefined}
      data-wait={waitOn ? waitState : undefined}
      bind:this={scroller}
      role="region"
      aria-label={t("player.score")}
      tabindex={ui.playerView === "highway" ? -1 : 0}
    >
      <!-- alphaTab's container sits inside the scroller: when they are the same element,
           follow adds the current scroll offset again and overshoots the bar (issue #118). -->
      <div bind:this={host}></div>
    </div>
  </div>

  {#if practice.fretboard.on || waitOn}
    <div
      class="fretboard-wrap"
      data-testid="player-fretboard"
      role={waitOn ? "group" : undefined}
      aria-label={waitOn ? t("waitMode.fretboard") : undefined}
    >
      <Fretboard
        tuning={track.tuning_midi}
        capo={track.capo}
        frets={fretCount(track)}
        current={waitOn ? (waitMarks?.notes ?? []) : fretFocus.current}
        next={waitOn ? [] : fretFocus.next}
        tone={waitMarks?.tone}
        label={practice.fretboard.label}
        root={practice.fretboard.root ?? defaultRoot(track.tuning_midi)}
        leftHanded={practice.fretboard.leftHanded}
      />
    </div>
  {/if}

  <p class="visually-hidden" role="status" data-testid="player-announcer">
    {countingIn ? t("player.countingIn") : playing ? t("player.playing") : t("player.paused")}
  </p>

  <div class="dock">
    {#if panelOpen}
      <section class="dock-panel" aria-label={t("player.syncPanel")}>
        <p class="panel-hint">
          {#if song.has_audio && Object.keys(song.document.sync.anchors).length === 0 && song.document.sync.points.some((point) => point != null)}
            {t("player.usingPublished")}
          {:else if song.has_audio}
            {t("player.keys")}
          {:else if song.document.sync.points.length || song.document.sync.video_id}
            {t("player.needAudio")}
          {:else}
            {t("player.synth")} {t("player.keys")}
          {/if}
        </p>
        <PracticePanel
          {practice}
          hasAudio={song.has_audio}
          tracks={song.document.tracks}
          onchange={practiceChanged}
        />
        {#if song.has_audio && !ui.demoMode}
          <StemMixer
            songId={song.id}
            {audioEl}
            master={practice.mix.audio}
            onactive={(active) => {
              stemsActive = active;
              if (!active) applyPractice();
            }}
          />
        {/if}
        <FretboardPanel {practice} onchange={practiceChanged} />
        <WaitPanel
          {practice}
          on={waitOn}
          available={!song.has_audio}
          error={waitError}
          onchange={() => {
            applyPractice();
            if (waitOn) {
              // The matcher and hint timer were built with the old options.
              stopWait();
              void startWait();
            }
          }}
          ontoggle={toggleWait}
        />
        {#if !song.has_audio}
          <ListenPanel
            session={listenSession}
            deviceId={listenDevice}
            channel={listenChannel}
            level={listenLevel}
            onDevice={(next) => (listenDevice = next)}
            onChannel={(next) => (listenChannel = next)}
          />
        {/if}
        <ScorePanel
          on={scoreOn}
          summary={scoreSummary}
          bleed={scoreBleed}
          calibrated={scoreCalibrated}
          error={scoreError}
          ontoggle={toggleScore}
        />
        {#if song.has_audio && !ui.demoMode}
          <div class="panel-group">
            <h3>{t("player.syncMarks")}</h3>
            <div class="button-row">
              <button class="accent" data-testid="player-tap" onclick={tap}
                ><Icon name="tap" size={18} />{t("player.tap")}</button
              >
              <button onclick={() => nudge(-0.05)}>{t("player.nudgeBack")}</button>
              <button onclick={() => nudge(0.05)}>{t("player.nudgeForward")}</button>
              <button onclick={clearCurrent}>{t("player.clearAnchor")}</button>
              <button onclick={() => commitAnchors(pointAnchors(song.document.sync, barCount))}
                >{t("player.restore")}</button
              >
              <button
                data-testid="player-autosync"
                title={t("autoSync.buttonHint")}
                onclick={openAutoSync}
                ><Icon name="waveform" size={18} />{t("autoSync.button")}</button
              >
              <button class="danger-text" onclick={() => commitAnchors({})}
                >{t("player.clearAll")}</button
              >
            </div>
            <p class="muted small">
              {t("player.nextTap", { measure: tapIndex + 1 })}{#if saveLabel}&nbsp;· {saveLabel}{/if}
            </p>
          </div>
        {/if}
        <LoopPanel
          {practice}
          {loopA}
          {loopB}
          {activeLoopId}
          {speedTrainerRunning}
          {speedTrainerPercent}
          {speedTrainerPass}
          {speedTrainerCompleted}
          onsetloop={setLoop}
          onclearloop={clearLoop}
          onchange={practiceChanged}
          onjump={activateLoop}
        />
        <div class="panel-group panel-inline">
          <label class="field compact-field">
            <span>{t("player.bpm")}</span>
            <input
              type="number"
              min="1"
              max="399"
              value={song.document.bpm}
              onchange={(event) => {
                const bpm = Number(event.currentTarget.value);
                if (bpm > 0 && bpm < 400) commitAnchors({ ...song.document.sync.anchors }, bpm);
              }}
            />
          </label>
          <label class="button file-button">
            <Icon name="upload" size={18} />{t("player.upload")}
            <input
              class="visually-hidden"
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.webm"
              onchange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void onUpload(file);
              }}
            />
          </label>
        </div>
        <div class="panel-group panel-inline">
          <YouTubeAudio songId={song.id} ondone={onYouTubeAudio} />
        </div>
      </section>
    {/if}

    {#if waitOn}
      <div
        class="wait-status"
        data-testid="wait-status"
        data-state={waitState}
        data-hits={waitHits}
        data-total={waitSteps.length}
        role="status"
      >
        <Icon name="mic" size={16} />
        <span class="wait-note">
          {#if waitState === "waiting" && waitStep}
            {#if waitStep.kind === "dead"}
              {t("wait.playDead")}
            {:else if waitStep.kind === "chord"}
              {t("chordWait.playChord", {
                notes: (waitStep.pcs ?? []).map((pc) => pitchClassName(pc)).join(" "),
              })}
            {:else}
              {t("wait.playNow", { note: midiToName(waitStep.midis[0]) })}
            {/if}
          {:else if waitState === "hit"}
            {t("wait.hit")}
          {:else if waitState === "done"}
            {t("wait.done", { hits: waitHits, total: waitSteps.length })}
          {:else}
            {t("wait.listening")}
          {/if}
        </span>
        {#if waitHint && waitStep}
          <span class="pill pill-accent" data-testid="wait-hint"
            >{t("wait.hint", { string: waitStep.string + 1, fret: waitStep.fret })}</span
          >
        {/if}
        <span class="muted small"
          >{t("wait.progress", { hits: waitHits, total: waitSteps.length })}</span
        >
        {#if waitState === "waiting"}
          <button class="button" data-testid="wait-skip" onclick={() => waitRun?.skip()}
            >{t("wait.skip")}</button
          >
        {/if}
      </div>
    {/if}
    <div class="dock-bar">
      <div class="dock-transport">
        <button
          class="icon-button ghost"
          data-testid="player-prev"
          onclick={() => step(-1)}
          aria-label={t("player.previousBar")}
          title={t("player.previousBar")}
        >
          <Icon name="prev" size={18} />
        </button>
        <button
          class="play-button"
          data-testid="player-play"
          data-playing={playing}
          data-counting={countingIn}
          onclick={toggle}
          aria-label={playing ? t("player.pause") : t("player.play")}
        >
          <Icon name={playing ? "pause" : "play"} size={24} />
        </button>
        <button
          class="icon-button ghost"
          data-testid="player-next"
          onclick={() => step(1)}
          aria-label={t("player.nextBar")}
          title={t("player.nextBar")}
        >
          <Icon name="next" size={18} />
        </button>
      </div>

      <div class="dock-progress">
        <div class="dock-status">
          <span data-testid="player-status" data-measure={currentMeasure}>
            {#if currentMeasure >= 0 && currentMeasure < barCount}
              {t("player.status", { measure: currentMeasure + 1, total: barCount, time: clock })}
            {:else}
              {t("player.statusIdle", { time: clock })}
            {/if}
          </span>
          {#if saveLabel}<span class="muted">{saveLabel}</span>{/if}
        </div>
        <div class="scrubber">
          {#if loopStyle}<span class="scrubber-loop" style={loopStyle}></span>{/if}
          <input
            type="range"
            min="0"
            max={Math.max(0, barCount - 1)}
            step="1"
            value={Math.max(0, currentMeasure)}
            style="--fill:{barCount > 1
              ? (Math.max(0, currentMeasure) / (barCount - 1)) * 100
              : 0}%"
            aria-label={t("player.position")}
            oninput={(event) => goToBar(Number(event.currentTarget.value))}
          />
        </div>
      </div>

      <div class="dock-tools">
        {#if song.document.tracks.length > 1}
          <label class="dock-select">
            <span class="visually-hidden">{t("player.track")}</span>
            <Icon name="layers" size={16} />
            <select bind:value={trackId} aria-label={t("player.track")}>
              {#each song.document.tracks as item (item.id)}
                <option value={item.id}>{item.name}</option>
              {/each}
            </select>
          </label>
        {/if}
        <label class="dock-select">
          <span class="visually-hidden">{t("player.rate")}</span>
          <Icon name="gauge" size={16} />
          <select
            value={rate}
            aria-label={t("player.rate")}
            onchange={(event) => setRate(Number(event.currentTarget.value))}
          >
            {#each RATES as value (value)}
              <option {value}>{value}×</option>
            {/each}
          </select>
        </label>
        <button
          class="icon-button ghost dock-more"
          data-testid="player-more"
          aria-expanded={moreOpen}
          onclick={() => (moreOpen = !moreOpen)}
          aria-label={t("player.more")}
          title={t("player.more")}
        >
          <Icon name="more" size={18} />
        </button>
        <div class="dock-secondary" data-open={moreOpen || undefined}>
          <button
            class="icon-button ghost"
            aria-pressed={ui.notation}
            onclick={toggleNotation}
            aria-label={t("player.notation")}
            title={t("player.notation")}
          >
            <Icon name="chords" size={18} />
          </button>
          <button
            class="icon-button ghost"
            aria-pressed={follow}
            onclick={() => setFollow(!follow)}
            aria-label={t("player.follow")}
            title={t("player.follow")}
          >
            <Icon name="follow" size={18} />
          </button>
          <button
            class="icon-button ghost"
            data-testid="stage-toggle"
            aria-pressed={handsFree.stage}
            onclick={() => setStage(!handsFree.stage)}
            aria-label={t("handsFree.stage")}
            title={t("handsFree.stage")}
          >
            <Icon name="monitor" size={18} />
          </button>
          <button
            class="icon-button ghost"
            data-testid="player-shortcuts"
            onclick={() => (helpOpen = true)}
            aria-label={t("shortcuts.title")}
            title={t("shortcuts.title")}
          >
            <Icon name="info" size={18} />
          </button>
        </div>
        <button
          class="icon-button ghost"
          data-testid="player-panel-toggle"
          aria-expanded={panelOpen}
          onclick={() => (panelOpen = !panelOpen)}
          aria-label={t("player.syncPanel")}
          title={t("player.syncPanel")}
        >
          <Icon name="sliders" size={18} />
        </button>
        <FullscreenToggle placement="dock" />
      </div>
    </div>
  </div>
  <ShortcutHelp open={helpOpen} onclose={() => (helpOpen = false)} />
  <RetuneSheet
    open={retuneOpen}
    {song}
    {track}
    presets={ui.presets}
    onclose={() => (retuneOpen = false)}
    onsaved={(saved, id) => {
      song = saved;
      trackId = id;
      retuneOpen = false;
    }}
  />
  {#if song.has_audio}
    <AutoSyncSheet
      open={autoSyncOpen}
      songId={song.id}
      document={song.document}
      audioUrl={audioSrc}
      existing={Object.keys(song.document.sync.anchors).length}
      onclose={() => (autoSyncOpen = false)}
      onaccept={acceptAutoSync}
    />
  {/if}
  <ScoreResults
    open={scoreResultsOpen}
    summary={scoreResult?.summary ?? null}
    sections={scoreResult?.sections ?? []}
    speed={scoreResult?.speed ?? 100}
    loop={scoreResult?.loop ?? null}
    isBest={scoreResult?.isBest ?? false}
    best={scoreResult?.best ?? null}
    onclose={() => (scoreResultsOpen = false)}
    onagain={playScoreAgain}
    onpractise={practiseSection}
  />
  <SetlistPicker
    song={pickerOpen ? { id: song.id, title: song.title } : null}
    onclose={() => (pickerOpen = false)}
  />
</div>
