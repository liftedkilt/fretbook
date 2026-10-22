<script lang="ts">
  import * as alphaTab from "@coderline/alphatab";
  import { onMount } from "svelte";

  import { ApiError, getMeta, getSong, patchSync, uploadAudio } from "../lib/api";
  import { AudioMedia } from "../lib/alphatab/audioHandler";
  import { preferredTrack, trackToAlphaTex } from "../lib/alphatex";
  import { printScore } from "../lib/export/pdf";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import { flatSyncPoints, measureAt, measureStarts, playbackAnchors } from "../lib/sync";
  import { tuningLabel } from "../lib/tuning";
  import type { SongDetail } from "../lib/types";

  let { id }: { id: string } = $props();

  let song = $state<SongDetail | null>(null);
  let error = $state("");
  let host = $state<HTMLDivElement | null>(null);
  let audioEl = $state<HTMLAudioElement | null>(null);
  let trackId = $state("");
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
  let exporters = $state<string[]>([]);
  let saveTimer = 0;

  const track = $derived(
    song?.document.tracks.find((item) => item.id === trackId) ?? (song ? preferredTrack(song.document) : undefined),
  );
  const measureCount = $derived(track?.measures.length ?? 0);
  const audioSrc = $derived(song?.audio_url ? new URL(song.audio_url, document.baseURI).toString() : "");

  function message(err: unknown): string {
    return err instanceof Error ? err.message : t("error.generic");
  }

  function formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
  }

  function startsNow(): number[] {
    if (!song || measureCount <= 0) return [];
    return measureStarts(measureCount, song.document.bpm, playbackAnchors(song.document.sync, measureCount));
  }

  function seedAnchors(): Record<string, number> {
    if (!song) return {};
    const next = { ...song.document.sync.anchors };
    if (Object.keys(next).length === 0) {
      song.document.sync.points.forEach((point, index) => {
        if (index < measureCount) next[String(index)] = point;
      });
    }
    return next;
  }

  function commitAnchors(next: Record<string, number>, bpm = song?.document.bpm) {
    if (!song || bpm == null) return;
    song.document.sync.anchors = next;
    song.document.bpm = bpm;
    if (song.document.tempos[0]) song.document.tempos[0].bpm = bpm;
    const songId = song.id;
    window.clearTimeout(saveTimer);
    saveLabel = t("editor.saving");
    saveTimer = window.setTimeout(() => {
      void patchSync(songId, { bpm, anchors: next })
        .then(() => {
          saveLabel = t("editor.saved");
        })
        .catch((err: unknown) => {
          error = message(err);
        });
    }, 250);
  }

  function applySync() {
    const instance = player.api;
    if (!instance?.score || !song || measureCount <= 0) return;
    const built = flatSyncPoints(startsNow());
    shiftMs = built.shiftMs;
    instance.score.applyFlatSyncPoints(built.points);
    instance.updateSyncPoints();
  }

  function paintClock() {
    if (!song) return;
    let seconds = 0;
    if (song.has_audio && audioEl) {
      seconds = audioEl.currentTime;
      const output = player.api?.player?.output as alphaTab.synth.IExternalMediaSynthOutput | undefined;
      output?.updatePosition(seconds * 1000 + shiftMs);
      const starts = startsNow();
      const measure = measureAt(starts, seconds);
      currentMeasure = measure;
      if (loopA != null && loopB != null && measure > loopB && !audioEl.paused) {
        audioEl.currentTime = Math.max(0, starts[loopA] ?? 0);
      }
    } else if (player.api) {
      seconds = player.api.timePosition / 1000;
      const quarters = seconds * (song.document.bpm / 60);
      let walked = 0;
      let measure = -1;
      track?.measures.forEach((item, index) => {
        const [numerator, denominator] = item.signature;
        const length = (4 * numerator) / denominator;
        if (measure < 0 && quarters < walked + length) measure = index;
        walked += length;
      });
      currentMeasure = measure;
    }
    clock = formatTime(seconds);
    playing = player.api?.playerState === alphaTab.synth.PlayerState.Playing;
  }

  $effect(() => {
    const songId = id;
    let cancel = false;
    song = null;
    error = "";
    trackId = "";
    void getSong(songId)
      .then((loaded) => {
        if (cancel) return;
        song = loaded;
        trackId = loaded.preferred_track_id;
      })
      .catch((err: unknown) => {
        if (!cancel) error = message(err);
      });
    void getMeta()
      .then((meta) => {
        exporters = meta.exporters;
      })
      .catch(() => undefined);
    return () => {
      cancel = true;
    };
  });

  $effect(() => {
    const element = host;
    const current = song;
    const selected = trackId;
    if (!element || !current || !selected) return;
    const tex = trackToAlphaTex(current.document, selected, current.title, current.artist);
    const useAudio = current.has_audio;
    const settings = new alphaTab.Settings();
    settings.core.fontDirectory = new URL("font/", document.baseURI).href;
    settings.core.logLevel = alphaTab.LogLevel.Warning;
    settings.display.staveProfile = alphaTab.StaveProfile.ScoreTab;
    settings.player.playerMode = useAudio
      ? alphaTab.PlayerMode.EnabledExternalMedia
      : alphaTab.PlayerMode.EnabledSynthesizer;
    settings.player.soundFont = new URL("soundfont/sonivox.sf2", document.baseURI).href;
    settings.player.enableCursor = true;
    settings.player.enableElementHighlighting = true;
    settings.player.enableUserInteraction = true;
    settings.player.scrollElement = element;
    settings.player.scrollOffsetY = 16;
    settings.player.scrollMode = alphaTab.ScrollMode.Continuous;
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
      if (audioEl) audioEl.playbackRate = rate;
    });
    instance.tex(tex);
    return () => {
      scoreReady = 0;
      player.api = null;
      instance.destroy();
    };
  });

  $effect(() => {
    if (!scoreReady || !song) return;
    void song.document.bpm;
    void song.document.sync.anchors;
    void song.document.sync.points;
    void measureCount;
    applySync();
  });

  onMount(() => {
    const timer = window.setInterval(paintClock, 50);
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;
      if (event.ctrlKey || event.metaKey) return;
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
      window.clearTimeout(saveTimer);
    };
  });

  function toggle() {
    const api = player.api;
    if (!api) return;
    if (api.playerState === alphaTab.synth.PlayerState.Playing) api.pause();
    else api.play();
  }

  function step(direction: number) {
    const index = Math.min(measureCount - 1, Math.max(0, (currentMeasure < 0 ? 0 : currentMeasure) + direction));
    tapIndex = index;
    if (song?.has_audio && audioEl) {
      audioEl.currentTime = Math.max(0, startsNow()[index] ?? 0);
    } else if (player.api && track) {
      let tick = player.api.midiTickShift || 0;
      for (let cursor = 0; cursor < index; cursor += 1) {
        const [numerator, denominator] = track.measures[cursor].signature;
        tick += ((4 * numerator) / denominator) * 960;
      }
      player.api.tickPosition = tick;
    }
  }

  function tap() {
    if (!song?.has_audio || !audioEl || measureCount <= 0) return;
    const next = seedAnchors();
    next[String(tapIndex)] = Number(audioEl.currentTime.toFixed(3));
    commitAnchors(next);
    tapIndex = Math.min(measureCount - 1, tapIndex + 1);
  }

  function nudge(delta: number) {
    if (!song || currentMeasure < 0 || currentMeasure >= measureCount) return;
    const next = seedAnchors();
    next[String(currentMeasure)] = Number((startsNow()[currentMeasure] + delta).toFixed(3));
    commitAnchors(next);
  }

  function clearCurrent() {
    if (!song || currentMeasure < 0) return;
    const next = { ...song.document.sync.anchors };
    delete next[String(currentMeasure)];
    commitAnchors(next);
  }

  function setLoop(which: "a" | "b") {
    if (currentMeasure < 0 || currentMeasure >= measureCount) return;
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
    if (!song) return;
    try {
      song = await uploadAudio(song.id, file);
    } catch (err) {
      error = err instanceof ApiError ? err.message : message(err);
    }
  }
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if !song}
  <p class="hint">{t("app.loading")}</p>
{:else}
  {@const current = song}
  <div class="row" style="justify-content:space-between">
    <div>
      <h2 style="margin:0">{song.title}</h2>
      <p class="hint" style="margin:0.2rem 0 0">
        {song.artist}
        {#if song.artist}·{/if}
        {track?.instrument}
        · {track ? tuningLabel(track.tuning_midi) : ""}
        · {track && track.capo > 0 ? t("player.capo", { fret: track.capo }) : t("player.noCapo")}
      </p>
    </div>
    <div class="actions">
      <a class="button" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>{t("app.back")}</a>
      <a class="button" href={hrefFor(`/songs/${current.id}/edit`)} onclick={(event) => followLink(event, `/songs/${current.id}/edit`)}>{t("player.edit")}</a>
      <a class="button" href={new URL(`api/songs/${current.id}/export.json`, document.baseURI).toString()}>{t("player.exportJson")}</a>
      {#if exporters.includes("pdf")}
        <button onclick={() => printScore(player.api)}>{t("player.exportPdf")}</button>
      {/if}
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
          if (song && bpm > 0 && bpm < 400) commitAnchors({ ...song.document.sync.anchors }, bpm);
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
      <button onclick={() => commitAnchors(Object.fromEntries(song?.document.sync.points.slice(0, measureCount).map((point, index) => [String(index), point]) ?? []))}>{t("player.restore")}</button>
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
    {#if currentMeasure >= 0 && currentMeasure < measureCount}
      {t("player.status", { measure: currentMeasure + 1, total: measureCount, time: clock })}
    {:else}
      {t("player.statusIdle", { time: clock })}
    {/if}
    {#if song.has_audio}
      · {t("player.nextTap", { measure: tapIndex + 1 })}
    {/if}
    {#if saveLabel}· {saveLabel}{/if}
    {#if loopA != null && loopB != null}· A{loopA + 1}–B{loopB + 1}{/if}
  </p>
  {#if song.has_audio && Object.keys(song.document.sync.anchors).length === 0 && song.document.sync.points.length > 0}
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
{/if}
