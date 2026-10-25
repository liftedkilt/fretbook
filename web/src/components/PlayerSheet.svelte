<script lang="ts">
  import { RATES } from "../lib/shortcuts";
  import { formatRate, loadSheetTab, saveSheetTab, type SheetTab } from "../lib/playerSheet";
  import { recordingGain, type PracticeSettings } from "../lib/practice";
  import { t } from "../lib/i18n.svelte";
  import FretboardPanel from "./FretboardPanel.svelte";
  import Icon from "./Icon.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import ListenPanel from "./ListenPanel.svelte";
  import LoopPanel from "./LoopPanel.svelte";
  import PracticePanel from "./PracticePanel.svelte";
  import ScorePanel from "./ScorePanel.svelte";
  import StemMixer from "./StemMixer.svelte";
  import WaitPanel from "./WaitPanel.svelte";
  import YouTubeAudio from "./YouTubeAudio.svelte";
  import type { ListenSession } from "../lib/listen/input";
  import type { SavedLoop } from "../lib/practice";
  import type { ScoreSummary } from "../lib/listen/scored";

  const TABS: { id: SheetTab; icon: string }[] = [
    { id: "practice", icon: "target" },
    { id: "audio", icon: "sliders" },
    { id: "sync", icon: "waveform" },
    { id: "view", icon: "eye" },
  ];

  let {
    userId = "",
    songId,
    practice,
    hasAudio,
    readOnly,
    demo,
    tracks,
    trackId,
    audioUrl,
    audioEl,
    canTranscribe,
    anchorCount,
    publishedSync,
    pendingSync,
    bpm,
    tapIndex,
    saveLabel,
    loopA,
    loopB,
    activeLoopId,
    speedTrainerRunning,
    speedTrainerPercent,
    speedTrainerPass,
    speedTrainerCompleted,
    rate,
    waitOn,
    waitAvailable,
    waitError,
    scoreOn,
    scoreSummary,
    scoreBleed,
    scoreCalibrated,
    scoreError,
    listenSession,
    listenDevice,
    listenChannel,
    listenLevel,
    notation,
    stage,
    onclose,
    onpractice,
    onfree,
    onwait,
    onscore,
    onwaitoptions,
    onloop,
    onclearloop,
    onjump,
    onrate,
    ontap,
    onnudge,
    onclearanchor,
    onrestore,
    onclearall,
    onautosync,
    ontranscribe,
    onbpm,
    onupload,
    onyoutube,
    onstems,
    ontrack,
    onnotation,
    onstage,
    onlistenDevice,
    onlistenChannel,
  }: {
    userId?: string;
    songId: string;
    practice: PracticeSettings;
    hasAudio: boolean;
    readOnly: boolean;
    demo: boolean;
    tracks: { id: string; name: string }[];
    trackId: string;
    audioUrl: string;
    audioEl: HTMLAudioElement | null;
    canTranscribe: boolean;
    anchorCount: number;
    publishedSync: boolean;
    pendingSync: boolean;
    bpm: number;
    tapIndex: number;
    saveLabel: string;
    loopA: number | null;
    loopB: number | null;
    activeLoopId: string | null;
    speedTrainerRunning: boolean;
    speedTrainerPercent: number;
    speedTrainerPass: number;
    speedTrainerCompleted: boolean;
    rate: number;
    waitOn: boolean;
    waitAvailable: boolean;
    waitError: string;
    scoreOn: boolean;
    scoreSummary: ScoreSummary | null;
    scoreBleed: boolean;
    scoreCalibrated: boolean;
    scoreError: string;
    listenSession: ListenSession | null;
    listenDevice: string;
    listenChannel: number;
    listenLevel: number;
    notation: boolean;
    stage: boolean;
    onclose: () => void;
    onpractice: () => void;
    onfree: () => void;
    onwait: () => void;
    onscore: () => void;
    onwaitoptions: () => void;
    onloop: (which: "a" | "b") => void;
    onclearloop: () => void;
    onjump: (loop: SavedLoop) => void;
    onrate: (value: number) => void;
    ontap: () => void;
    onnudge: (delta: number) => void;
    onclearanchor: () => void;
    onrestore: () => void;
    onclearall: () => void;
    onautosync: () => void;
    ontranscribe: () => void;
    onbpm: (bpm: number) => void;
    onupload: (file: File) => void;
    onyoutube: () => void;
    onstems: (active: boolean) => void;
    ontrack: (id: string) => void;
    onnotation: () => void;
    onstage: (on: boolean) => void;
    onlistenDevice: (id: string) => void;
    onlistenChannel: (channel: number) => void;
  } = $props();

  let root = $state<HTMLElement | null>(null);
  let tab = $state<SheetTab>("practice");
  // Set once the player picks a tab, so a later sign-in does not overwrite it.
  let touched = false;

  $effect.pre(() => {
    const id = userId;
    if (touched) return;
    tab = loadSheetTab(id);
  });

  const showSyncTools = $derived(hasAudio && !demo && !readOnly);

  function tabLabel(id: SheetTab): string {
    if (id === "practice") return t("playerSheet.practice");
    if (id === "audio") return t("playerSheet.audio");
    if (id === "sync") return t("playerSheet.sync");
    return t("playerSheet.view");
  }

  function select(next: SheetTab) {
    tab = next;
    touched = true;
    saveSheetTab(next, userId);
  }

  function onTabKey(event: KeyboardEvent) {
    const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const index = TABS.findIndex((item) => item.id === tab);
    let next = index;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else next = (index - 1 + TABS.length) % TABS.length;
    event.preventDefault();
    const chosen = TABS[next];
    select(chosen.id);
    queueMicrotask(() => document.getElementById(`player-sheet-tab-${chosen.id}`)?.focus());
  }

  // Escape closes the sheet only while focus is inside it, so a modal dialog
  // layered on top keeps its own Escape.
  $effect(() => {
    const node = root;
    if (!node) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onclose();
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  });
</script>

<section
  class="sheet"
  id="player-sheet"
  data-testid="player-sheet"
  data-tab={tab}
  aria-label={t("playerSheet.label")}
  bind:this={root}
>
  <div class="head">
    <div
      class="tabs"
      role="tablist"
      aria-label={t("playerSheet.label")}
      tabindex="-1"
      onkeydown={onTabKey}
    >
      {#each TABS as item (item.id)}
        <button
          type="button"
          class="tab"
          id={`player-sheet-tab-${item.id}`}
          role="tab"
          data-testid={`player-sheet-tab-${item.id}`}
          aria-selected={tab === item.id}
          aria-controls="player-sheet-panel"
          tabindex={tab === item.id ? 0 : -1}
          onclick={() => select(item.id)}
        >
          <Icon name={item.icon} size={16} />
          {tabLabel(item.id)}
        </button>
      {/each}
    </div>
    <IconButton icon="close" label={t("ui.close")} testid="player-sheet-close" onclick={onclose} />
  </div>

  <div
    class="body"
    role="tabpanel"
    id="player-sheet-panel"
    aria-labelledby={`player-sheet-tab-${tab}`}
    tabindex="0"
  >
    {#if tab === "practice"}
      <div class="panel-group">
        <h3>{t("playerSheet.mode")}</h3>
        <div class="modes" role="group" aria-label={t("playerSheet.mode")}>
          <button
            type="button"
            class="mode"
            data-testid="practice-mode-free"
            aria-pressed={!waitOn && !scoreOn}
            onclick={onfree}
          >
            <span class="mark"><Icon name="play" size={16} /></span>
            <span class="copy">
              <span class="name">{t("playerSheet.freePlay")}</span>
              <span class="blurb">{t("playerSheet.freePlayBlurb")}</span>
            </span>
          </button>
          <button
            type="button"
            class="mode"
            data-testid="score-toggle"
            aria-pressed={scoreOn}
            onclick={onscore}
          >
            <span class="mark"><Icon name="star" size={16} /></span>
            <span class="copy">
              <span class="name">{t("scored.start")}</span>
              <span class="blurb">{t("playerSheet.scoreBlurb")}</span>
            </span>
          </button>
          {#if waitAvailable}
            <button
              type="button"
              class="mode"
              data-testid="wait-toggle"
              aria-pressed={waitOn}
              onclick={onwait}
            >
              <span class="mark"><Icon name="hourglass" size={16} /></span>
              <span class="copy">
                <span class="name">{t("wait.start")}</span>
                <span class="blurb">{t("playerSheet.waitBlurb")}</span>
              </span>
            </button>
          {:else}
            <p class="hint" data-testid="wait-unavailable">{t("wait.needsSynth")}</p>
          {/if}
        </div>
      </div>
      {#if waitAvailable}
        <WaitPanel
          {practice}
          on={waitOn}
          available
          error={waitError}
          hideToggle
          onchange={onwaitoptions}
          ontoggle={onwait}
        />
      {/if}
      {#if !hasAudio}
        <ListenPanel
          session={listenSession}
          deviceId={listenDevice}
          channel={listenChannel}
          level={listenLevel}
          onDevice={onlistenDevice}
          onChannel={onlistenChannel}
        />
      {/if}
      {#if scoreOn || scoreError || scoreBleed}
        <ScorePanel
          on={scoreOn}
          summary={scoreSummary}
          bleed={scoreBleed}
          calibrated={scoreCalibrated}
          error={scoreError}
          hideToggle
          ontoggle={onscore}
        />
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
        onsetloop={onloop}
        {onclearloop}
        onchange={onpractice}
        {onjump}
      >
        {#snippet between()}
          <div class="panel-group">
            <h3 id="player-speed-heading">{t("playerSheet.speed")}</h3>
            <select
              aria-labelledby="player-speed-heading"
              data-testid="player-rate"
              value={String(rate)}
              onchange={(event) => onrate(Number(event.currentTarget.value))}
            >
              {#each RATES as value (value)}
                <option value={String(value)}>{formatRate(value)}</option>
              {/each}
            </select>
          </div>
        {/snippet}
      </LoopPanel>
    {:else if tab === "audio"}
      <PracticePanel {practice} {hasAudio} {tracks} onchange={onpractice} />
      {#if showSyncTools}
        <StemMixer {songId} {audioEl} master={recordingGain(practice.mix)} onactive={onstems} />
      {/if}
      {#if !readOnly}
        <div class="panel-group">
          <h3>{t("playerSheet.audioSource")}</h3>
          <div class="sources">
            <label class="button file-button">
              <Icon name="upload" size={18} />{t("player.upload")}
              <input
                class="visually-hidden"
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a,.flac,.webm"
                data-testid="player-upload"
                onchange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  if (file) onupload(file);
                }}
              />
            </label>
            {#if audioUrl}
              <a class="button" href={audioUrl} download data-testid="player-download-audio">
                <Icon name="download" size={18} />{t("playerSheet.download")}
              </a>
            {/if}
          </div>
          <YouTubeAudio {songId} ondone={onyoutube} />
        </div>
      {/if}
    {:else if tab === "sync"}
      <p class="hint">
        {#if hasAudio && anchorCount === 0 && publishedSync}
          {t("player.usingPublished")}
        {:else if hasAudio}
          {t("player.keys")}
        {:else if pendingSync}
          {t("player.needAudio")}
        {:else}
          {t("player.synth")} {t("player.keys")}
        {/if}
      </p>
      {#if showSyncTools}
        <div class="panel-group">
          <h3>{t("player.syncMarks")}</h3>
          <div class="button-row">
            <button type="button" class="accent" data-testid="player-tap" onclick={ontap}>
              <Icon name="tap" size={18} />{t("player.tap")}
            </button>
            <button type="button" onclick={() => onnudge(-0.05)}>{t("player.nudgeBack")}</button>
            <button type="button" onclick={() => onnudge(0.05)}>{t("player.nudgeForward")}</button>
            <button type="button" onclick={onclearanchor}>{t("player.clearAnchor")}</button>
            <button type="button" onclick={onrestore}>{t("player.restore")}</button>
            <button
              type="button"
              data-testid="player-autosync"
              title={t("autoSync.buttonHint")}
              onclick={onautosync}
            >
              <Icon name="waveform" size={18} />{t("autoSync.button")}
            </button>
            {#if canTranscribe}
              <button
                type="button"
                data-testid="player-transcribe"
                title={t("transcribe.buttonHint")}
                onclick={ontranscribe}
              >
                <Icon name="sparkle" size={18} />{t("transcribe.button")}
              </button>
            {/if}
            <button type="button" class="danger-text" onclick={onclearall}
              >{t("player.clearAll")}</button
            >
          </div>
          <p class="muted small">
            {t("player.nextTap", { measure: tapIndex + 1 })}{#if saveLabel}&nbsp;· {saveLabel}{/if}
          </p>
        </div>
      {/if}
      {#if !readOnly}
        <label class="field compact-field">
          <span>{t("player.bpm")}</span>
          <input
            type="number"
            min="1"
            max="399"
            value={bpm}
            onchange={(event) => {
              const next = Number(event.currentTarget.value);
              if (next > 0 && next < 400) onbpm(next);
            }}
          />
        </label>
      {/if}
    {:else}
      <FretboardPanel {practice} onchange={onpractice} />
      <div class="panel-group">
        <h3>{t("playerSheet.view")}</h3>
        <label class="switch">
          <input
            type="checkbox"
            data-testid="player-notation"
            checked={notation}
            onchange={onnotation}
          />
          <span class="switch-track"></span>
          {t("player.notation")}
        </label>
        <label class="switch" data-testid="stage-toggle">
          <input
            type="checkbox"
            checked={stage}
            onchange={(event) => onstage(event.currentTarget.checked)}
          />
          <span class="switch-track"></span>
          {t("handsFree.stage")}
        </label>
        {#if tracks.length > 1}
          <label class="field">
            <span>{t("player.track")}</span>
            <select
              data-testid="player-track"
              value={trackId}
              onchange={(event) => ontrack(event.currentTarget.value)}
            >
              {#each tracks as item (item.id)}
                <option value={item.id}>{item.name}</option>
              {/each}
            </select>
          </label>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .sheet {
    display: flex;
    flex-direction: column;
    height: 100%;
    max-height: inherit;
    overflow: hidden;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-lg);
    background: var(--surface);
    box-shadow: var(--shadow-lg);
    animation: sheet-up 320ms var(--ease);
  }

  .head {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-1);
    padding: var(--sp-2) var(--sp-2) 0;
    border-bottom: 1px solid var(--line);
  }

  .tabs {
    display: flex;
    flex: 1;
    gap: var(--sp-1);
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    flex: none;
    gap: var(--sp-1);
    min-height: 40px;
    margin-bottom: -1px;
    padding: var(--sp-2) var(--sp-3);
    border: 0;
    border-bottom: calc(var(--sp-1) / 2) solid transparent;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    color: var(--text-2);
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
  }

  .tab:hover:not(:disabled) {
    background: transparent;
    color: var(--text);
  }

  .tab[aria-selected="true"] {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: var(--sp-5);
    min-height: 0;
    overflow: auto;
    padding: var(--sp-4);
  }

  .modes {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .mode {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-3);
    width: 100%;
    min-height: 0;
    padding: var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    color: var(--text);
    text-align: left;
    white-space: normal;
    box-shadow: none;
  }

  .mode:hover:not(:disabled) {
    background: var(--surface-3);
  }

  .mode[aria-pressed="true"] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .copy {
    flex: 1;
    min-width: 0;
  }

  .mark {
    display: grid;
    place-items: center;
    flex: none;
    width: var(--sp-7);
    height: var(--sp-7);
    border-radius: var(--r-sm);
    background: var(--surface-3);
    color: var(--text-2);
  }

  .mode[aria-pressed="true"] .mark {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .name,
  .blurb {
    display: block;
  }

  .name {
    font-size: var(--fs-body);
    font-weight: 650;
  }

  .blurb {
    margin-top: var(--sp-1);
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 450;
    line-height: 1.4;
    white-space: normal;
  }

  .hint {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }

  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }

  @keyframes sheet-up {
    from {
      opacity: 0;
      transform: translateY(var(--sp-4));
    }
  }

  @keyframes sheet-side {
    from {
      opacity: 0;
      transform: translateX(var(--sp-4));
    }
  }

  @media (min-width: 768px) {
    .sheet {
      animation-name: sheet-side;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .sheet,
    .tab,
    .mode {
      animation: none;
      transition: none;
    }
  }
</style>
