<script lang="ts">
  import * as alphaTab from "@coderline/alphatab";
  import { onMount, untrack } from "svelte";

  import { ApiError, patchSync, uploadAudio } from "../lib/api";
  import { AudioMedia } from "../lib/alphatab/audioHandler";
  import { preferredTrack, trackToAlphaTex } from "../lib/alphatex";
  import { barTicks } from "../lib/durations";
  import { t } from "../lib/i18n.svelte";
  import { instrumentLabel } from "../lib/instruments";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import { flatSyncPoints, measureAt, pointAnchors, songStarts } from "../lib/sync";
  import { tuningLabel } from "../lib/tuning";
  import type { SongDetail, TabSong } from "../lib/types";

  let { song: initial }: { song: TabSong } = $props();

  // The player owns its copy: taps, BPM edits, and uploads change it in place.
  let song = $state(untrack(() => initial));

  let error = $state("");
  let host = $state<HTMLDivElement | null>(null);
  let audioEl = $state<HTMLAudioElement | null>(null);
  let trackId = $state(untrack(() => song.preferred_track_id || preferredTrack(song.document).id));
  let scoreReady = $state(0);
  let shiftMs = 0;
  const player: { api: alphaTab.AlphaTabApi | null } = { api: null };

  let tapIndex = $state(0);
  let loopA = $state<number | null>(null);
  let loopB = $state<number | null>(null);
  let follow = $state(true);
  let rate = $state(1);
  let currentMeasure = $state(-1);
  let clock = $state("0:00.0");
  let playing = $state(false);
  let saveLabel = $state("");
  let saveTimer = 0;
  let pendingSync: (() => Promise<void>) | null = null;

  const document_ = $derived(song.document);
  const track = $derived(document_.tracks.find((item) => item.id === trackId) ?? preferredTrack(document_));
  const barCount = $derived(document_.bars.length);
  const audioSrc = $derived(song.audio_url ? new URL(song.audio_url, document.baseURI).toString() : "");
  // With audio, the <audio> clock and sync points set the pace, so a BPM edit must not rebuild the score.
  // Without audio, alphaTab's synth plays at the written tempo, so it does.
  const renderBpm = $derived(song.has_audio ? untrack(() => song.document.bpm) : document_.bpm);
  const tex = $derived(trackToAlphaTex({ ...document_, bpm: renderBpm }, trackId, song.title, song.artist));

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
    const built = flatSyncPoints(startsNow());
    shiftMs = built.shiftMs;
    instance.score.applyFlatSyncPoints(built.points);
    instance.updateSyncPoints();
  }

  function paintAudioClock() {
    if (!song.has_audio || !audioEl) return;
    const seconds = audioEl.currentTime;
    const output = player.api?.player?.output as alphaTab.synth.IExternalMediaSynthOutput | undefined;
    output?.updatePosition(seconds * 1000 + shiftMs);
    const starts = startsNow();
    currentMeasure = measureAt(starts, seconds);
    if (loopA != null && loopB != null && currentMeasure > loopB && !audioEl.paused) {
      audioEl.currentTime = Math.max(0, starts[loopA] ?? 0);
    }
    clock = formatTime(seconds);
    playing = !audioEl.paused;
  }

  $effect(() => {
    const element = host;
    const source = tex;
    const useAudio = song.has_audio;
    if (!element) return;
    const settings = new alphaTab.Settings();
    settings.core.fontDirectory = new URL("font/", document.baseURI).href;
    settings.core.logLevel = alphaTab.LogLevel.Warning;
    settings.display.staveProfile = alphaTab.StaveProfile.ScoreTab;
    settings.player.playerMode = useAudio ? alphaTab.PlayerMode.EnabledExternalMedia : alphaTab.PlayerMode.EnabledSynthesizer;
    settings.player.soundFont = new URL("soundfont/sonivox.sf2", document.baseURI).href;
    settings.player.enableCursor = true;
    settings.player.enableElementHighlighting = true;
    settings.player.enableUserInteraction = true;
    settings.player.scrollElement = element;
    settings.player.scrollOffsetY = 16;
    settings.player.scrollMode = untrack(() => follow) ? alphaTab.ScrollMode.Continuous : alphaTab.ScrollMode.Off;
    const instance = new alphaTab.AlphaTabApi(element, settings);
    player.api = instance;
    instance.scoreLoaded.on(() => {
      queueMicrotask(() => {
        scoreReady += 1;
      });
    });
    instance.playerReady.on(() => {
      if (!useAudio || !audioEl) return;
      const output = instance.player?.output as alphaTab.synth.IExternalMediaSynthOutput | undefined;
      if (output) output.handler = new AudioMedia(audioEl, () => shiftMs);
      audioEl.playbackRate = untrack(() => rate);
    });
    // Without audio, alphaTab's own events say where playback is, tempo changes included.
    instance.playedBeatChanged.on((beat) => {
      if (!useAudio) currentMeasure = beat.voice.bar.index;
    });
    instance.playerPositionChanged.on((event) => {
      if (!useAudio) clock = formatTime(event.currentTime / 1000);
    });
    instance.playerStateChanged.on((event) => {
      if (!useAudio) playing = event.state === alphaTab.synth.PlayerState.Playing;
    });
    instance.tex(source);
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

  onMount(() => {
    const timer = window.setInterval(paintAudioClock, 50);
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      // A focused button already handles Space itself.
      if (target?.tagName === "BUTTON" && event.key === " ") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        tap();
      } else if (event.key === " ") {
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("keydown", onKey);
      // Leaving the page must not lose a tap that is still waiting to be saved.
      void flushSync();
    };
  });

  function toggle() {
    const api = player.api;
    if (!api) return;
    if (song.has_audio && audioEl) {
      if (audioEl.paused) api.play();
      else api.pause();
      return;
    }
    if (api.playerState === alphaTab.synth.PlayerState.Playing) api.pause();
    else api.play();
  }

  function step(direction: number) {
    const index = Math.min(barCount - 1, Math.max(0, (currentMeasure < 0 ? 0 : currentMeasure) + direction));
    tapIndex = index;
    if (song.has_audio && audioEl) {
      audioEl.currentTime = Math.max(0, startsNow()[index] ?? 0);
    } else if (player.api) {
      let tick = 0;
      for (let cursor = 0; cursor < index; cursor += 1) tick += barTicks(song.document.bars[cursor].signature);
      player.api.tickPosition = tick;
      currentMeasure = index;
    }
  }

  function tap() {
    if (!song.has_audio || !audioEl || barCount <= 0) return;
    const next = seedAnchors();
    next[String(tapIndex)] = Number(audioEl.currentTime.toFixed(3));
    commitAnchors(next);
    tapIndex = Math.min(barCount - 1, tapIndex + 1);
  }

  function nudge(delta: number) {
    if (currentMeasure < 0 || currentMeasure >= barCount) return;
    const next = seedAnchors();
    next[String(currentMeasure)] = Number((startsNow()[currentMeasure] + delta).toFixed(3));
    commitAnchors(next);
  }

  function clearCurrent() {
    if (currentMeasure < 0) return;
    const next = { ...song.document.sync.anchors };
    delete next[String(currentMeasure)];
    commitAnchors(next);
  }

  function setLoop(which: "a" | "b") {
    if (currentMeasure < 0 || currentMeasure >= barCount) return;
    if (which === "a") {
      loopA = currentMeasure;
      if (loopB == null || loopB < currentMeasure) loopB = currentMeasure;
    } else {
      loopB = currentMeasure;
      if (loopA == null || loopA > currentMeasure) loopA = currentMeasure;
    }
  }

  function setFollow(checked: boolean) {
    follow = checked;
    const api = player.api;
    if (!api) return;
    api.settings.player.scrollMode = checked ? alphaTab.ScrollMode.Continuous : alphaTab.ScrollMode.Off;
    api.updateSettings();
  }

  function setRate(value: number) {
    rate = value;
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

  function exportUrl(kind: string): string {
    return new URL(`api/songs/${song.id}/export.${kind}`, document.baseURI).toString();
  }
</script>

{#if error}<p class="error">{error}</p>{/if}
<div class="row" style="justify-content:space-between">
  <div>
    <h2 style="margin:0">{song.title}</h2>
    <p class="hint" style="margin:0.2rem 0 0">
      {song.artist}
      {#if song.artist}·{/if}
      {instrumentLabel(track.instrument)}
      · {tuningLabel(track.tuning_midi)}
      · {track.capo > 0 ? t("player.capo", { fret: track.capo }) : t("player.noCapo")}
    </p>
  </div>
  <div class="actions">
    <a class="button" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>{t("app.back")}</a>
    <a class="button" href={hrefFor(`/songs/${song.id}/edit`)} onclick={(event) => followLink(event, `/songs/${song.id}/edit`)}>{t("player.edit")}</a>
    <a class="button" href={exportUrl("musicxml")}>{t("player.exportMusicXml")}</a>
    <a class="button" href={exportUrl("json")}>{t("player.exportJson")}</a>
    <button onclick={() => player.api?.print()}>{t("player.print")}</button>
  </div>
</div>

<div class="transport">
  <button class="primary" onclick={toggle}>{playing ? t("player.pause") : t("player.play")}</button>
  {#if song.document.tracks.length > 1}
    <label class="field">
      {t("player.track")}
      <select bind:value={trackId}>
        {#each song.document.tracks as item (item.id)}
          <option value={item.id}>{item.name}</option>
        {/each}
      </select>
    </label>
  {/if}
  <label class="field">
    {t("player.bpm")}
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
  <label class="field">
    {t("player.rate")}
    <select value={rate} onchange={(event) => setRate(Number(event.currentTarget.value))}>
      {#each [0.5, 0.75, 1, 1.25, 1.5] as value (value)}
        <option {value}>{value}</option>
      {/each}
    </select>
  </label>
  <label class="field" style="align-items:center">
    <span>{t("player.follow")}</span>
    <input type="checkbox" checked={follow} onchange={(event) => setFollow(event.currentTarget.checked)} />
  </label>
  {#if song.has_audio}
    <button onclick={tap}>{t("player.tap")}</button>
    <button onclick={() => nudge(-0.05)}>{t("player.nudgeBack")}</button>
    <button onclick={() => nudge(0.05)}>{t("player.nudgeForward")}</button>
    <button onclick={clearCurrent}>{t("player.clearAnchor")}</button>
    <button onclick={() => setLoop("a")}>{t("player.loopA")}</button>
    <button onclick={() => setLoop("b")}>{t("player.loopB")}</button>
    <button onclick={() => { loopA = null; loopB = null; }}>{t("player.clearLoop")}</button>
    <button onclick={() => commitAnchors(pointAnchors(song.document.sync, barCount))}>{t("player.restore")}</button>
    <button onclick={() => commitAnchors({})}>{t("player.clearAll")}</button>
  {/if}
  <label class="field">
    {t("player.upload")}
    <input
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

<p class="hint">
  {#if currentMeasure >= 0 && currentMeasure < barCount}
    {t("player.status", { measure: currentMeasure + 1, total: barCount, time: clock })}
  {:else}
    {t("player.statusIdle", { time: clock })}
  {/if}
  {#if song.has_audio}
    · {t("player.nextTap", { measure: tapIndex + 1 })}
  {/if}
  {#if saveLabel}· {saveLabel}{/if}
  {#if loopA != null && loopB != null}· {t("player.loopRange", { a: loopA + 1, b: loopB + 1 })}{/if}
</p>
{#if song.has_audio && Object.keys(song.document.sync.anchors).length === 0 && song.document.sync.points.some((point) => point != null)}
  <p class="hint">{t("player.usingPublished")}</p>
{:else if song.has_audio}
  <p class="hint">{t("player.keys")}</p>
{:else if song.document.sync.points.length || song.document.sync.video_id}
  <p class="hint">{t("player.needAudio")}</p>
{:else}
  <p class="hint">{t("player.synth")} {t("player.keys")}</p>
{/if}

{#if song.has_audio}
  <audio bind:this={audioEl} src={audioSrc} preload="auto"></audio>
{/if}
<div class="paper" bind:this={host}></div>
