<script lang="ts">
  import * as alphaTab from "@coderline/alphatab";
  import { onMount, untrack } from "svelte";

  import DockSpeed from "./DockSpeed.svelte";
  import DockTextButton from "./DockTextButton.svelte";
  import Fretboard from "./Fretboard.svelte";
  import Highway from "./Highway.svelte";
  import Icon from "./Icon.svelte";
  import PlayerSheet from "./PlayerSheet.svelte";
  import SongHeader from "./SongHeader.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import OverflowMenu from "./ui/OverflowMenu.svelte";
  import SegmentedControl from "./ui/SegmentedControl.svelte";
  import Tooltip from "./ui/Tooltip.svelte";
  import { sectionMarks } from "../lib/playerSheet";
  import SetlistPicker from "./SetlistPicker.svelte";
  import FullscreenToggle from "./FullscreenToggle.svelte";
  import { FULLSCREEN_ATTRIBUTE, fullscreenScale, layoutFocused } from "../lib/fullscreen";
  import AutoSyncSheet from "./AutoSyncSheet.svelte";
  import TranscribeSheet from "./TranscribeSheet.svelte";
  import RetuneSheet from "./RetuneSheet.svelte";
  import LessonRunBanner from "./LessonRunBanner.svelte";
  import ScoreResults from "./ScoreResults.svelte";
  import ShortcutHelp from "./ShortcutHelp.svelte";
  import {
    ApiError,
    getPracticeStats,
    getSong,
    patchSync,
    recordPracticeSession,
    uploadAudio,
  } from "../lib/api";
  import { holdCelebrations, onPracticeLogged, snapshotFromStats } from "../lib/celebrate";
  import { AudioMedia } from "../lib/alphatab/audioHandler";
  import { planFollow, SynthFollower } from "../lib/alphatab/synthFollow";
  import { separateEffectBands } from "../lib/alphatab/display";
  import { preferredTrack, scoreToAlphaTex } from "../lib/alphatex";
  import { Clicker } from "../lib/clicker";
  import { recordingGain, synthGain } from "../lib/practice";
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
  import { IdleWatch, localDay, PracticeTimer, WAIT_IDLE_MS } from "../lib/practiceLog";
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
  import { routePath } from "../lib/router.svelte";
  import { shortcutFor, stepRate, type ShortcutAction } from "../lib/shortcuts";
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

  let {
    song: initial,
    readOnly = false,
    shared = false,
  }: { song: TabSong; readOnly?: boolean; shared?: boolean } = $props();
  let pickerOpen = $state(false);

  // The player owns its copy: taps, BPM edits, and uploads change it in place.
  let song = $state(untrack(() => initial));

  let error = $state("");
  let host = $state<HTMLDivElement | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);
  let audioEl = $state<HTMLAudioElement | null>(null);
  let pausedAudioSeek: { measure: number; position: number; seconds: number } | null = null;
  let stemsActive = false;
  // For tests: whether the synth beside the recording is off, loading, ready or sounding.
  let synthState = $state<"off" | "loading" | "ready" | "playing">("off");
  let trackId = $state(untrack(() => song.preferred_track_id || preferredTrack(song.document).id));
  let scoreReady = $state(0);
  let retuneOpen = $state(false);
  let autoSyncOpen = $state(false);
  let transcribeOpen = $state(false);
  let shiftMs = 0;
  const player: { api: alphaTab.AlphaTabApi | null } = { api: null };
  // With a recording, a second, hidden alphaTab player plays the score's tracks and follows the
  // recording's clock, so the mixer can balance the two (see lib/alphatab/synthFollow.ts).
  const companion: {
    api: alphaTab.AlphaTabApi | null;
    follower: SynthFollower | null;
    ready: boolean;
  } = { api: null, follower: null, ready: false };
  const clicker = new Clicker();
  // Time spent playing goes to the practice log, one session per stretch (see lib/practiceLog.ts).
  const practiceTimer = new PracticeTimer({
    onSession: (session, keepalive) => {
      if (readOnly) return;
      void recordPracticeSession(session, keepalive).then(() => {
        onPracticeLogged(keepalive, routePath() === "/practice", () =>
          getPracticeStats(localDay(new Date())).then(snapshotFromStats),
        );
      });
    },
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
  // Live height of the floating dock (it grows with the wait bar), so the fretboard and score clear it.
  let dockHeight = $state(0);
  // Ticks into the current played bar, for the fretboard.
  let currentPosition = $state(0);
  // Seconds on the playback clock, for the scrolling note highway.
  let currentSeconds = $state(0);
  let clock = $state("0:00.0");
  let playing = $state(false);
  let muted = $state(false);
  let countingIn = $state(false);
  let helpOpen = $state(false);
  let countInTimer = 0;
  let saveLabel = $state("");
  let saveTimer = 0;
  let pendingSync: (() => Promise<void>) | null = null;

  function updatePlayingOutline(
    element: HTMLDivElement,
    instance: alphaTab.AlphaTabApi,
    beat: alphaTab.model.Beat,
  ) {
    if (!beat.notes.length) {
      element.querySelector(".at-playing-outline")?.remove();
      return;
    }
    const bounds = instance.boundsLookup?.findBeat(beat);
    if (!bounds) return;
    const staff = bounds.barBounds.visualBounds;
    let outline = element.querySelector<SVGSVGElement>(".at-playing-outline");
    if (!outline) {
      outline = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      outline.setAttribute("class", "at-playing-outline");
      outline.setAttribute("viewBox", "0 0 40 180");
      outline.setAttribute("preserveAspectRatio", "none");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        "M20 2 C31 2 38 11 38 22 V138 C38 154 31 168 20 178 C9 168 2 154 2 138 V22 C2 11 9 2 20 2 Z",
      );
      outline.appendChild(path);
      element.appendChild(outline);
    }
    outline.style.left = `${bounds.onNotesX - 10}px`;
    outline.style.top = `${staff.y - 14}px`;
    outline.style.width = "20px";
    outline.style.height = `${staff.h + 26}px`;
  }

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
  // The score at its written tempo, for the synth that plays next to a recording.
  const synthTex = $derived(
    song.has_audio ? scoreToAlphaTex(document_, song.title, song.artist) : "",
  );
  const synthWanted = $derived(song.has_audio && synthGain(practice.mix) > 0);
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
    if (readOnly) return;
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
    if (audioEl.paused && pausedAudioSeek) {
      currentMeasure = pausedAudioSeek.measure;
      currentPosition = pausedAudioSeek.position;
      currentSeconds = pausedAudioSeek.seconds;
      clock = formatTime(pausedAudioSeek.seconds);
      playing = false;
      return;
    }
    if (!audioEl.paused) pausedAudioSeek = null;
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
    followWithSynth(seconds, starts);
  }

  /** Keeps the synth that plays next to the recording on the recording's clock. */
  function followWithSynth(seconds: number, starts: number[]) {
    const { follower, ready } = companion;
    if (!follower || !ready || !audioEl) return;
    const written = highwayStarts(song.document, false);
    const bar = Math.max(0, currentMeasure);
    const target = timeAtBarPosition(
      written,
      bar,
      currentPosition,
      playedBarTicks(song.document, bar),
    );
    const plan = planFollow({
      target,
      synthAt: follower.position,
      // Before the first bar (an intro, a count-in) the synth waits.
      playing: !audioEl.paused && !countingIn && seconds >= (starts[0] ?? 0),
      rate: audioEl.playbackRate,
      synthBar: (written[bar + 1] ?? 0) - (written[bar] ?? 0),
      recordingBar: (starts[bar + 1] ?? 0) - (starts[bar] ?? 0),
    });
    follower.apply(plan);
    const next = plan.play ? "playing" : "ready";
    if (synthState !== next) synthState = next;
  }

  $effect(() => {
    const element = host;
    const source = synthTex;
    const index = untrack(() => trackIndex);
    if (!element || !synthWanted || !source) return;
    return untrack(() => mountCompanion(source, index));
  });

  function mountCompanion(source: string, index: number) {
    // The player needs a place in the page, but nothing in it is shown.
    const hidden = document.createElement("div");
    hidden.setAttribute("aria-hidden", "true");
    hidden.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden";
    document.body.appendChild(hidden);
    const settings = new alphaTab.Settings();
    settings.core.fontDirectory = new URL("font/", document.baseURI).href;
    settings.core.logLevel = alphaTab.LogLevel.Warning;
    settings.core.enableLazyLoading = true;
    settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer;
    settings.player.soundFont = new URL("soundfont/sonivox.sf2", document.baseURI).href;
    settings.player.enableCursor = false;
    settings.player.enableElementHighlighting = false;
    settings.player.enableUserInteraction = false;
    const instance = new alphaTab.AlphaTabApi(hidden, settings);
    companion.api = instance;
    companion.ready = false;
    synthState = "loading";
    let scoreLoaded = false;
    let playerReady = false;
    const check = () => {
      if (!scoreLoaded || !playerReady || companion.api !== instance) return;
      companion.follower = new SynthFollower(instance);
      companion.ready = true;
      synthState = "ready";
      applyPractice();
    };
    instance.scoreLoaded.on(() => {
      scoreLoaded = true;
      queueMicrotask(check);
    });
    instance.playerReady.on(() => {
      playerReady = true;
      queueMicrotask(check);
    });
    instance.tex(source, [index]);
    return () => {
      companion.api = null;
      companion.follower = null;
      companion.ready = false;
      synthState = "off";
      instance.destroy();
      hidden.remove();
    };
  }

  $effect(() => {
    const element = host;
    const scrollElement = scroller;
    const source = tex;
    const useAudio = song.has_audio;
    if (!element || !scrollElement) return;
    return untrack(() => mountScorePlayer(element, scrollElement, source, useAudio));
  });

  function mountScorePlayer(
    element: HTMLDivElement,
    scrollElement: HTMLDivElement,
    source: string,
    useAudio: boolean,
  ) {
    const settings = new alphaTab.Settings();
    settings.core.fontDirectory = new URL("font/", document.baseURI).href;
    settings.core.logLevel = alphaTab.LogLevel.Warning;
    settings.core.enableLazyLoading = false;
    settings.display.staveProfile = staveProfile(untrack(() => ui.notation));
    separateEffectBands(settings);
    settings.display.scale = untrack(scoreScale);
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
    let mouseDownBeat: alphaTab.model.Beat | null = null;
    let scoreSelectionDragged = false;
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
      updatePlayingOutline(element, instance, beat);
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
      mouseDownBeat = beat;
      scoreSelectionDragged = false;
      if (waitRun && beat.voice.bar.staff.track.index === untrack(() => trackIndex))
        followWaitClick(beat.voice.bar.index, beat.displayStart);
    });
    instance.beatMouseMove.on((beat) => {
      if (mouseDownBeat && mouseDownBeat !== beat) scoreSelectionDragged = true;
    });
    instance.beatMouseUp.on((beat) => {
      const clickedBeat = mouseDownBeat;
      const dragged = scoreSelectionDragged || Boolean(beat && clickedBeat && beat !== clickedBeat);
      mouseDownBeat = null;
      scoreSelectionDragged = false;
      if (clickedBeat && !dragged) seekToBeat(instance, element, clickedBeat);
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
      element.querySelector(".at-playing-outline")?.remove();
      instance.destroy();
    };
  }

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

  // A toast waits until playback stops and the score sheet is gone, so it never covers the result.
  $effect(() => {
    holdCelebrations(playing || scoreResultsOpen);
    return () => holdCelebrations(false);
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
      if (event.key === "Escape" && handsFree.stage && !helpOpen) {
        event.preventDefault();
        setStage(false);
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
    if (audioEl) {
      if (!stemsActive) audioEl.volume = recordingGain(practice.mix);
      audioEl.muted = muted;
    }
    // A recording is mixed with the synth in the hidden companion player, which has no metronome:
    // the page's own clicks keep time there.
    const api = song.has_audio ? (companion.ready ? companion.api : null) : player.api;
    if (!api?.score) return;
    if (!song.has_audio) {
      api.metronomeVolume = !muted && practice.metronome.on ? practice.metronome.volume : 0;
      api.masterVolume = muted || (waitOn && practice.wait.silent) ? 0 : practice.mix.synth;
    } else {
      api.masterVolume = muted ? 0 : synthGain(practice.mix);
    }
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

  function toggleMute() {
    muted = !muted;
    if (audioEl) audioEl.muted = muted;
    const api = song.has_audio ? (companion.ready ? companion.api : null) : player.api;
    if (api?.score && !song.has_audio) {
      api.metronomeVolume = !muted && practice.metronome.on ? practice.metronome.volume : 0;
      api.masterVolume = muted || (waitOn && practice.wait.silent) ? 0 : practice.mix.synth;
    } else if (api?.score) {
      api.masterVolume = muted ? 0 : synthGain(practice.mix);
    }
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
    if (!muted) {
      clicker.unlock();
      const volume = Math.max(practice.metronome.volume, 0.3);
      for (const click of plan.clicks) clicker.click(click.time, click.accent, volume);
    }
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
    if (
      !song.has_audio ||
      !audioEl ||
      audioEl.paused ||
      countingIn ||
      muted ||
      !practice.metronome.on
    )
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
      if (audioEl.paused) {
        if (pausedAudioSeek) audioEl.currentTime = pausedAudioSeek.seconds;
        runCountIn(currentMeasure, () => api.play(), countBars);
      } else api.pause();
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

  function openTranscribe() {
    if (playing) toggle();
    transcribeOpen = true;
  }

  async function onTranscribeSuccess(newTrackId?: string) {
    try {
      song = (await getSong(song.id)) as TabSong;
      if (newTrackId) {
        trackId = newTrackId;
      }
    } catch (err) {
      error = err instanceof ApiError ? err.message : message(err);
    }
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
      pausedAudioSeek = audioEl.paused
        ? { measure: index, position: 0, seconds: targetTime }
        : null;
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

  function seekToBeat(
    instance: alphaTab.AlphaTabApi,
    element: HTMLDivElement,
    beat: alphaTab.model.Beat,
  ) {
    const doc = song.document;
    const played = followPlayed(order, beat.voice.bar.index, currentMeasure);
    if (played < 0) return;
    const tick = tickOfBar(played) + beat.playbackStart;
    instance.tickPosition = tick;
    tapIndex = played;
    currentMeasure = played;
    currentPosition = beat.displayStart;
    if (song.has_audio && audioEl) {
      const starts = startsNow();
      const barStart = starts[played] ?? 0;
      const barEnd = starts[played + 1] ?? barStart;
      const ticks = playedBarTicks(doc, played);
      const ratio = ticks > 0 ? Math.max(0, Math.min(1, beat.playbackStart / ticks)) : 0;
      const seconds = Math.max(0, barStart + (barEnd - barStart) * ratio);
      audioEl.currentTime = seconds;
      pausedAudioSeek = audioEl.paused
        ? { measure: played, position: beat.displayStart, seconds }
        : null;
      currentSeconds = seconds;
      clock = formatTime(seconds);
    } else {
      currentSeconds = timeAtBarPosition(
        highwayStarts(doc, false),
        played,
        beat.displayStart,
        playedBarTicks(doc, played),
      );
      clock = formatTime(currentSeconds);
    }
    if (scoreRun) scoreRun.begin(scoreRange(played));
    updatePlayingOutline(element, instance, beat);
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
  // On a phone the dock is one row; loop, follow and full screen move into its "⋯" menu.
  const PHONE_QUERY = "(max-width: 767px), (max-height: 500px) and (pointer: coarse)";
  let phone = $state(typeof matchMedia !== "undefined" && matchMedia(PHONE_QUERY).matches);
  $effect(() => {
    if (typeof matchMedia === "undefined") return;
    const query = matchMedia(PHONE_QUERY);
    const update = () => (phone = query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });

  let fullscreenToggle = $state<FullscreenToggle | null>(null);

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

  // Stage mode and full screen draw the score larger so it fills the window.
  let fullscreenWidth = $state(0);
  function scoreScale(): number {
    if (handsFree.stage) return STAGE_SCALE;
    return fullscreenWidth > 0 ? fullscreenScale(fullscreenWidth) : 1;
  }

  // The layout changes with the full screen attribute; measure again once it has settled.
  $effect(() => {
    const sync = () => {
      fullscreenWidth = layoutFocused() ? window.innerWidth : 0;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => window.dispatchEvent(new Event("resize"))),
      );
    };
    // Real full screen and the iPhone focus mode both flip the same attribute.
    const watcher = new MutationObserver(sync);
    watcher.observe(document.documentElement, { attributeFilter: [FULLSCREEN_ATTRIBUTE] });
    const follow = () => {
      if (fullscreenWidth > 0) fullscreenWidth = window.innerWidth;
    };
    window.addEventListener("resize", follow);
    return () => {
      watcher.disconnect();
      window.removeEventListener("resize", follow);
    };
  });

  $effect(() => {
    const api = player.api;
    const scale = scoreScale();
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

  function chooseFree() {
    if (waitOn) stopWait();
    if (scoreOn) stopScore();
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
  // A phone's sheet has two heights; the grabber toggles them.
  let sheetTall = $state(false);
  let sheetSlot = $state<HTMLDivElement | null>(null);
  const marks = $derived(sectionMarks(document_.bars, order));
  const currentSection = $derived.by(() => {
    for (let index = marks.length - 1; index >= 0; index -= 1) {
      if (marks[index].index <= currentMeasure) return marks[index].label;
    }
    return "";
  });
  const loopStyle = $derived(
    loopA != null && loopB != null && barCount > 1
      ? `left:${(loopA / barCount) * 100}%;width:${((loopB - loopA + 1) / barCount) * 100}%`
      : "",
  );

  function closeSheet() {
    panelOpen = false;
    queueMicrotask(() =>
      document.querySelector<HTMLElement>("[data-testid=player-panel-toggle]")?.focus(),
    );
  }

  // The score sits beside the sheet. alphaTab sizes itself from the window, and the
  // sheet fills the gap above the dock instead of running underneath it.
  $effect(() => {
    void panelOpen;
    const slot = sheetSlot;
    const place = () => {
      if (!slot) return;
      if (matchMedia("(max-width: 767px), (max-height: 500px) and (pointer: coarse)").matches) {
        slot.style.removeProperty("--sheet-height");
        return;
      }
      const top = slot.getBoundingClientRect().top;
      const dockTop =
        document.querySelector(".dock-bar")?.getBoundingClientRect().top ?? window.innerHeight;
      const available = dockTop - Math.max(top, 16) - 8;
      if (available > 0) slot.style.setProperty("--sheet-height", `${Math.round(available)}px`);
    };
    const frame = requestAnimationFrame(() => {
      place();
      // alphaTab measures the score column from the window, not this element.
      window.dispatchEvent(new Event("resize"));
    });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place);
    };
  });

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

  // Stage mode also hides the app's top bar (app.css), which sits outside this component.
  $effect(() => {
    if (!handsFree.stage) return;
    document.documentElement.setAttribute("data-stage", "");
    return () => document.documentElement.removeAttribute("data-stage");
  });
</script>

<div
  class="song-page player-page"
  class:stage={handsFree.stage}
  class:has-fretboard={practice.fretboard.on || waitOn}
  style:--dock-live={dockHeight > 0 ? `calc(${dockHeight + 14}px + var(--safe-b))` : undefined}
>
  {#if lessonRef}<LessonRunBanner bind:this={lessonBanner} lesson={lessonRef} />{/if}
  <SongHeader
    {song}
    {readOnly}
    {shared}
    eyebrow={instrumentLabel(track.instrument)}
    strings={track.tuning_midi.length}
    facts={[
      { label: tuningLabel(track.tuning_midi) },
      { label: track.capo > 0 ? t("player.capo", { fret: track.capo }) : t("player.noCapo") },
      { label: t("library.tempo", { bpm: song.document.bpm }) },
    ]}
    factsAfter={[
      { label: t("library.measures", { count: document_.bars.length }) },
      ...(song.source_ref.rhythm_estimated
        ? [
            {
              label: t("asciiTab.rhythmEstimated"),
              testid: "rhythm-estimated-pill",
              title: t("asciiTab.rhythmEstimatedHint"),
            },
          ]
        : []),
      ...(song.has_audio ? [{ label: t("library.audio"), accent: true, icon: "waveform" }] : []),
    ]}
    onretune={() => (retuneOpen = true)}
    ontuner={() => openTuner({ tuning: track.tuning_midi, capo: track.capo })}
    onsetlist={() => (pickerOpen = true)}
    exportItems={[
      {
        id: "pdf",
        label: exporting
          ? t("player.exportingPdf")
          : song.document.tracks.length > 1
            ? t("player.exportPdfTrack", { name: track.name })
            : t("player.exportPdf"),
        icon: "file",
        testid: "export-pdf",
        disabled: exporting,
        onclick: () => void exportPdf(),
      },
      {
        id: "musicxml",
        label: t("player.exportMusicXml"),
        icon: "layers",
        testid: "export-musicxml",
        href: exportUrl("musicxml"),
      },
      {
        id: "midi",
        label: t("player.exportMidi"),
        icon: "download",
        testid: "export-midi",
        href: exportUrl("mid"),
      },
      {
        id: "json",
        label: t("player.exportJson"),
        icon: "download",
        testid: "export-json",
        href: exportUrl("json"),
      },
    ]}
  >
    {#snippet afterFacts()}
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
    {/snippet}
  </SongHeader>
  <div class="view-row" data-testid="player-view-row">
    <SegmentedControl
      label={t("highway.view")}
      value={ui.playerView}
      testid="player-view-switcher"
      onchange={(next) => setPlayerView(next as typeof ui.playerView)}
      options={[
        { value: "tab", label: t("highway.tab"), testid: "player-view-tab" },
        { value: "highway", label: t("highway.highway"), testid: "player-view-highway" },
        { value: "split", label: t("highway.split"), testid: "player-view-split" },
      ]}
    />
    {#if document_.tracks.length > 1}
      <label class="track-select">
        <span>{t("player.track")}</span>
        <select
          data-testid="player-track"
          value={trackId}
          onchange={(event) => (trackId = event.currentTarget.value)}
        >
          {#each document_.tracks as item (item.id)}
            <option value={item.id}>{item.name}</option>
          {/each}
        </select>
      </label>
    {/if}
    <div class="view-chips">
      {#if loopA != null && loopB != null}
        <button
          type="button"
          class="view-chip"
          data-testid="player-loop-chip"
          title={t("player.syncPanel")}
          onclick={() => (panelOpen = true)}
        >
          <Icon name="repeat" size={14} />{t("player.loopRange", { a: loopA + 1, b: loopB + 1 })}
        </button>
      {/if}
      {#if rate !== 1}
        <button
          type="button"
          class="view-chip"
          data-testid="player-speed-chip"
          title={t("player.syncPanel")}
          onclick={() => (panelOpen = true)}
        >
          <Icon name="gauge" size={14} />{formatSpeedPercent(rate)}
        </button>
      {/if}
    </div>
  </div>
  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

  <div class="player-body">
    <div class="player-main">
      {#if song.has_audio}
        <audio data-testid="player-audio" bind:this={audioEl} src={audioSrc} preload="auto"></audio>
      {/if}
      <div
        class="player-stage"
        data-testid="player-stage"
        data-view={ui.playerView}
        data-synth={synthState}
      >
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
    </div>
    {#if panelOpen && !handsFree.stage}
      <div class="player-sheet" class:tall={sheetTall} bind:this={sheetSlot}>
        <button
          type="button"
          class="sheet-grabber"
          data-testid="player-sheet-grabber"
          aria-label={sheetTall ? t("playerSheet.shrink") : t("playerSheet.expand")}
          onclick={() => (sheetTall = !sheetTall)}
        ></button>
        <PlayerSheet
          userId={ui.me?.user_id ?? ""}
          songId={song.id}
          {practice}
          hasAudio={song.has_audio}
          {readOnly}
          demo={ui.demoMode}
          tracks={song.document.tracks}
          audioUrl={audioSrc}
          {audioEl}
          {muted}
          canTranscribe={ui.workerKinds.includes("audio.transcribe")}
          anchorCount={Object.keys(song.document.sync.anchors).length}
          publishedSync={song.document.sync.points.some((point) => point != null)}
          pendingSync={Boolean(song.document.sync.points.length || song.document.sync.video_id)}
          bpm={song.document.bpm}
          {tapIndex}
          {saveLabel}
          {loopA}
          {loopB}
          {activeLoopId}
          {speedTrainerRunning}
          {speedTrainerPercent}
          {speedTrainerPass}
          {speedTrainerCompleted}
          {rate}
          {waitOn}
          waitAvailable={!song.has_audio}
          {waitError}
          {scoreOn}
          {scoreSummary}
          {scoreBleed}
          {scoreCalibrated}
          {scoreError}
          {listenSession}
          {listenDevice}
          {listenChannel}
          {listenLevel}
          notation={ui.notation}
          stage={handsFree.stage}
          onclose={closeSheet}
          onpractice={practiceChanged}
          onfree={chooseFree}
          onwait={toggleWait}
          onscore={toggleScore}
          onwaitoptions={() => {
            applyPractice();
            if (waitOn) {
              stopWait();
              void startWait();
            }
          }}
          onloop={setLoop}
          onclearloop={clearLoop}
          onjump={activateLoop}
          onrate={setRate}
          ontap={tap}
          onnudge={nudge}
          onclearanchor={clearCurrent}
          onrestore={() => commitAnchors(pointAnchors(song.document.sync, barCount))}
          onclearall={() => commitAnchors({})}
          onautosync={openAutoSync}
          ontranscribe={openTranscribe}
          onbpm={(next) => commitAnchors({ ...song.document.sync.anchors }, next)}
          onupload={(file) => void onUpload(file)}
          onyoutube={() => void onYouTubeAudio()}
          onstems={(active) => {
            stemsActive = active;
            if (!active) applyPractice();
          }}
          onnotation={toggleNotation}
          onstage={setStage}
          onlistenDevice={(next) => (listenDevice = next)}
          onlistenChannel={(next) => (listenChannel = next)}
        />
      </div>
    {/if}
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

  <div class="dock" class:sheet-open={panelOpen && !handsFree.stage} bind:offsetHeight={dockHeight}>
    {#if waitOn}
      <div
        class="wait-status"
        data-testid="wait-status"
        data-state={waitState}
        data-hits={waitHits}
        data-total={waitSteps.length}
        role="status"
      >
        <Icon name="hourglass" size={16} />
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
        <IconButton
          class="ghost"
          icon="prev"
          label={t("player.previousBar")}
          testid="player-prev"
          placement="above"
          onclick={() => step(-1)}
        />
        <Tooltip text={playing ? t("player.pause") : t("player.play")} placement="above">
          {#snippet children(describedBy)}
            <button
              class="play-button"
              data-testid="player-play"
              data-playing={playing}
              data-counting={countingIn}
              onclick={toggle}
              aria-label={playing ? t("player.pause") : t("player.play")}
              aria-describedby={describedBy || undefined}
            >
              <Icon name={playing ? "pause" : "play"} size={24} />
            </button>
          {/snippet}
        </Tooltip>
        <IconButton
          class="ghost"
          icon="next"
          label={t("player.nextBar")}
          testid="player-next"
          placement="above"
          onclick={() => step(1)}
        />
        <IconButton
          class="ghost"
          icon={muted ? "volumeX" : "volume2"}
          label={t(muted ? "player.unmutePlayback" : "player.mutePlayback")}
          testid="player-mute"
          pressed={muted}
          placement="above"
          onclick={toggleMute}
        />
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
          {#if currentSection}
            <span class="dock-section" title={currentSection}>{currentSection}</span>
          {/if}
          {#if saveLabel}<span class="muted">{saveLabel}</span>{/if}
        </div>
        <div class="scrubber">
          {#if loopStyle}<span class="scrubber-loop" style={loopStyle}></span>{/if}
          {#each marks as mark (mark.index)}
            <span
              class="scrubber-mark"
              style="left:{(mark.index / Math.max(barCount, 1)) * 100}%"
              aria-hidden="true"
            ></span>
          {/each}
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
        {#if handsFree.stage}
          <DockTextButton
            icon="minimize"
            label={t("handsFree.exitStage")}
            testid="stage-exit"
            onclick={() => setStage(false)}
          />
        {/if}
        <DockSpeed {rate} onchange={setRate} />
        {#if !phone}
          <DockTextButton
            icon="repeat"
            label={t("player.loop")}
            testid="player-loop-toggle"
            pressed={loopA != null && loopB != null}
            onclick={toggleLoop}
          />
        {/if}
        <DockTextButton
          icon="target"
          label={t("playerSheet.practice")}
          testid="player-panel-toggle"
          pressed={waitOn || scoreOn}
          expanded={panelOpen}
          controls={panelOpen ? "player-sheet" : undefined}
          onclick={() => (panelOpen = !panelOpen)}
        />
        {#if !phone}
          <IconButton
            class="ghost"
            placement="above"
            icon="crosshair"
            label={t("player.follow")}
            pressed={follow}
            onclick={() => setFollow(!follow)}
          />
        {/if}
        <FullscreenToggle bind:this={fullscreenToggle} />
        <OverflowMenu
          label={t("player.more")}
          testid="player-more"
          placement="above"
          items={[
            ...(phone
              ? [
                  {
                    id: "loop",
                    label: t("player.loop"),
                    icon: "repeat",
                    active: loopA != null && loopB != null,
                    testid: "player-loop-toggle",
                    onclick: toggleLoop,
                  },
                  {
                    id: "follow",
                    label: t("player.follow"),
                    icon: "crosshair",
                    active: follow,
                    testid: "player-follow-toggle",
                    onclick: () => setFollow(!follow),
                  },
                  {
                    id: "fullscreen",
                    label: fullscreenToggle?.isOn() ? t("fullscreen.exit") : t("fullscreen.enter"),
                    icon: fullscreenToggle?.isOn() ? "minimize" : "maximize",
                    testid: "player-fullscreen-menu",
                    onclick: () => void fullscreenToggle?.toggle(),
                  },
                ]
              : []),
            {
              id: "shortcuts",
              label: t("shortcuts.title"),
              icon: "keyboard",
              testid: "player-shortcuts",
              onclick: () => (helpOpen = true),
            },
          ]}
        />
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
    <TranscribeSheet
      open={transcribeOpen}
      songId={song.id}
      onclose={() => (transcribeOpen = false)}
      onsuccess={onTranscribeSuccess}
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

<style>
  .player-body {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-4);
  }

  .player-main {
    flex: 1 1 auto;
    min-width: 0;
  }

  .player-sheet {
    position: sticky;
    top: var(--sp-4);
    flex: 0 0 calc(var(--sp-8) * 6);
    width: calc(var(--sp-8) * 6);
    align-self: flex-start;
    height: var(--sheet-height, calc(100dvh - var(--dock-space) - var(--sp-7)));
    max-height: var(--sheet-height, calc(100dvh - var(--dock-space) - var(--sp-7)));
    z-index: 30;
  }

  .dock-tools {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .sheet-grabber {
    display: none;
  }

  .scrubber-mark {
    position: absolute;
    top: 0;
    z-index: 1;
    width: 1px;
    height: var(--sp-2);
    background: var(--text-3);
    transform: translateX(-50%);
    pointer-events: none;
  }

  @media (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    .player-body {
      display: block;
    }

    .dock-tools {
      justify-content: space-between;
    }

    /* A bottom sheet: full width, attached to the edge, with the dock hidden behind it. */
    .dock-tools {
      flex-wrap: nowrap;
    }

    .player-sheet {
      position: fixed;
      top: auto;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 45;
      display: flex;
      flex-direction: column;
      width: auto;
      height: auto;
      max-height: min(55dvh, 100dvh - var(--sp-7));
      padding-bottom: var(--safe-b);
      overflow: hidden;
      border-radius: var(--r-lg) var(--r-lg) 0 0;
      background: var(--glass-solid);
      border-top: 1px solid var(--glass-line);
      box-shadow: var(--shadow-lg);
    }

    .player-sheet.tall {
      max-height: calc(100dvh - var(--sp-8));
    }

    .player-sheet > :global(:not(.sheet-grabber)) {
      min-height: 0;
      overflow-y: auto;
    }

    .sheet-grabber {
      display: block;
      flex: none;
      width: 100%;
      height: 24px;
      min-height: 24px;
      padding: 0;
      border: 0;
      background: transparent;
    }

    .sheet-grabber::before {
      content: "";
      display: block;
      width: 40px;
      height: 4px;
      margin: 0 auto;
      border-radius: 2px;
      background: var(--line-strong);
    }
  }

  /* The Details section after the score leaves room for the dock, so no gap sits above it. */
  .player-page {
    padding-bottom: 0;
  }

  /* The view switch sits directly above the score, with chips for the loop and speed in use. */
  .view-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
    margin-bottom: var(--sp-3);
  }

  .track-select {
    display: flex;
    flex: 0 1 24rem;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
    max-width: 100%;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }

  .track-select select {
    flex: 1;
    min-width: 0;
    width: 0;
  }

  /* The active loop and speed, pushed to the right, each opening the practice panel. */
  .view-chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
    margin-left: auto;
  }

  .view-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    min-height: 36px;
    padding: 0 var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: var(--fs-sm);
    line-height: 1.45;
    white-space: nowrap;
  }

  :global(:root[data-fullscreen]) .view-row,
  .player-page.stage .view-row {
    display: none;
  }

  /* Saved loops stay in the practice panel on a phone: they would push the music down. */
  @media (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    .song-saved-loops {
      display: none;
    }
  }
</style>
