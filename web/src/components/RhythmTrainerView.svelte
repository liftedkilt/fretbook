<script lang="ts">
  import Icon from "./Icon.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import ListenPanel from "./ListenPanel.svelte";
  import { getSong, listSongs, recordPracticeExercise } from "../lib/api";
  import { Clicker } from "../lib/clicker";
  import { t } from "../lib/i18n.svelte";
  import { getLocalCalibration } from "../lib/listen/calibration";
  import { getSavedChannel, getSavedDevice } from "../lib/listen/devicePrefs";
  import { describeProblem, ListenError, startListening } from "../lib/listen/input";
  import type { ListenSession } from "../lib/listen/input";
  import { clampBpm, MAX_BPM, MIN_BPM } from "../lib/metronome";
  import { localDay } from "../lib/practiceLog";
  import { barBreakdown, errorTone, songRhythms, type SongRhythm } from "../lib/rhythm/bars";
  import { beamAt, hasFlag } from "../lib/rhythm/beaming";
  import {
    PATTERNS,
    cellCount,
    patternById,
    strumDirection,
    DEFAULT_PATTERN_ID,
    type RhythmPattern,
  } from "../lib/rhythm/patterns";
  import {
    RhythmRun,
    type HitSource,
    type RhythmResult,
    type RunPosition,
  } from "../lib/rhythm/run";
  import { histogram } from "../lib/rhythm/timing";
  import type { ScoreDocument, SongSummary } from "../lib/types";

  const STORAGE_KEY = "fretbook.rhythm.settings";
  const BAR_CHOICES = [2, 4, 8];

  function load(): { pattern: string; bpm: number; bars: number } {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
      return {
        pattern: PATTERNS.some((p) => p.id === parsed.pattern)
          ? parsed.pattern
          : DEFAULT_PATTERN_ID,
        bpm: clampBpm(parsed.bpm ?? 80),
        bars: BAR_CHOICES.includes(parsed.bars) ? parsed.bars : 4,
      };
    } catch {
      return { pattern: DEFAULT_PATTERN_ID, bpm: 80, bars: 4 };
    }
  }

  const saved = load();
  let patternId = $state(saved.pattern);
  let bpm = $state(saved.bpm);
  let bars = $state(saved.bars);
  let useMic = $state(false);
  const savedDevice = getSavedDevice();
  let micDevice = $state(savedDevice);
  let micChannel = $state(getSavedChannel(savedDevice));
  let micLevel = $state(0);
  let micSession = $state<ListenSession | null>(null);

  let running = $state(false);
  let position = $state<RunPosition | null>(null);
  let result = $state<RhythmResult | null>(null);
  let error = $state("");

  /** Where the rhythm comes from: the built-in patterns, or the bars of one of the player's tabs. */
  let source = $state<"builtin" | "song">("builtin");
  let songs = $state<SongSummary[]>([]);
  let songId = $state("");
  let songDoc = $state<ScoreDocument | null>(null);
  let trackIndex = $state(0);
  let songPatternId = $state("");
  let songError = $state("");
  let songsLoaded = false;

  const rhythms = $derived<SongRhythm[]>(songDoc ? songRhythms(songDoc, trackIndex) : []);
  const songPattern = $derived(
    source === "song" ? rhythms.find((r) => r.pattern.id === songPatternId) : undefined,
  );
  const pattern = $derived<RhythmPattern>(
    songPattern
      ? { ...songPattern.pattern, label: songLabel(songPattern) }
      : patternById(patternId),
  );
  /** What the shown results were played with, so changing a picker afterwards does not rewrite them. */
  let played = $state<{ pattern: RhythmPattern; bars: number } | null>(null);
  const breakdown = $derived(
    result && played ? barBreakdown(played.pattern, played.bars, result.match.errors) : [],
  );
  const cells = $derived(Array.from({ length: cellCount(pattern) }, (_, i) => i));
  const calibration = $derived(useMic ? getLocalCalibration("default", "default") : null);
  const bins = $derived(result ? histogram(result.match.errors) : []);
  const binMax = $derived(Math.max(1, ...bins.map((b) => b.count)));
  const clicker = new Clicker();
  let run: RhythmRun | null = null;
  let session: ListenSession | null = null;
  let poll: ReturnType<typeof setInterval> | undefined;

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ pattern: patternId, bpm, bars }));
    } catch {
      // Storage may be blocked; the settings just don't stick.
    }
  }

  function cellState(cell: number): "hit" | "rest" {
    return pattern.cells[cell] === "x" ? "hit" : "rest";
  }

  function songLabel(rhythm: SongRhythm): string {
    return t("rhythm.songBar", { bar: rhythm.firstBar, count: rhythm.count });
  }

  async function chooseSource(next: "builtin" | "song") {
    source = next;
    result = null;
    if (next !== "song" || songsLoaded) return;
    try {
      const page = await listSongs({ limit: 200 });
      songs = page.items.filter((song) => song.content_kind === "tab");
      songsLoaded = true;
    } catch {
      songError = t("rhythm.songLoadFailed");
    }
  }

  async function chooseSong(id: string) {
    songId = id;
    songDoc = null;
    songPatternId = "";
    trackIndex = 0;
    songError = "";
    result = null;
    if (!id) return;
    try {
      const song = await getSong(id);
      if (songId !== id) return;
      if ("document" in song && song.document) {
        const doc = song.document as ScoreDocument;
        songDoc = doc;
        trackIndex = Math.max(
          0,
          doc.tracks.findIndex((track) => track.preferred),
        );
        songPatternId = songRhythms(doc, trackIndex)[0]?.pattern.id ?? "";
      }
      if (!songDoc) songError = t("rhythm.songLoadFailed");
    } catch {
      if (songId === id) songError = t("rhythm.songLoadFailed");
    }
  }

  function chooseTrack(index: number) {
    trackIndex = index;
    songPatternId = (songDoc ? songRhythms(songDoc, index)[0]?.pattern.id : "") ?? "";
    result = null;
  }

  /** What the log stores: a built-in pattern id, or `song:<id>:<first bar>`, so it needs no translation. */
  function patternName(): string {
    return songPattern ? `song:${songId}:${songPattern.firstBar}` : patternId;
  }

  function logRun(finished: RhythmResult, startedAt: number, tempo: number) {
    const seconds = Math.round((Date.now() - startedAt) / 1000);
    const { summary } = finished;
    if (seconds < 1 || summary.expected === 0) return;
    void recordPracticeExercise({
      kind: "rhythm",
      day: localDay(new Date(startedAt)),
      started_at: new Date(startedAt).toISOString(),
      duration_seconds: Math.min(seconds, 6 * 3600),
      rounds: summary.expected,
      correct: summary.hit,
      score: Math.round((summary.hit / summary.expected) * 1000) / 10,
      pattern: patternName(),
      bpm: tempo,
      mean_error_ms: summary.meanMs === null ? null : Math.round(summary.meanMs * 10) / 10,
    });
  }

  function record(source: HitSource, timeMs = performance.now()) {
    run?.hit(timeMs, source);
  }

  async function begin() {
    if (running) return;
    error = "";
    result = null;
    clicker.unlock();
    if (useMic) {
      try {
        session = await startListening({
          deviceId: micDevice || undefined,
          channel: micChannel,
          onLevel: ({ peak }) => (micLevel = peak),
          onPitch: (event) => {
            if (!event.onset || event.onsetTime === null || !session) return;
            const ago = session.currentTime - event.onsetTime;
            record("mic", performance.now() - ago * 1000);
          },
        });
      } catch (err) {
        error = err instanceof ListenError ? describeProblem(err.problem) : String(err);
        return;
      }
    }
    micSession = session;
    const startedAt = Date.now();
    const runPattern = pattern;
    const runBars = bars;
    const latency = useMic ? getLocalCalibration("default", "default") : null;
    run = new RhythmRun({
      pattern,
      bpm,
      bars,
      now: () => performance.now(),
      click: (delay, accent) => clicker.click(delay, accent, 0.7),
      latencyMs: latency ?? 0,
      onFinish: (finished) => {
        result = finished;
        played = { pattern: runPattern, bars: runBars };
        logRun(finished, startedAt, bpm);
        end();
      },
    });
    running = true;
    run.begin();
    poll = setInterval(() => (position = run?.position() ?? null), 30);
  }

  function end() {
    running = false;
    position = null;
    clearInterval(poll);
    poll = undefined;
    run?.stop();
    run = null;
    const finished = session;
    session = null;
    micSession = null;
    micLevel = 0;
    void finished?.stop().catch(() => undefined);
  }

  function stop() {
    end();
  }

  function onKey(event: KeyboardEvent) {
    if (!running || event.code !== "Space") return;
    const target = event.target as HTMLElement | null;
    if (target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
    event.preventDefault();
    if (event.type === "keydown" && !event.repeat) record("keyboard");
  }

  $effect(() => () => {
    end();
    clicker.close();
  });

  const messageKey = $derived(
    result
      ? {
          rushing: "rhythm.rushing",
          dragging: "rhythm.dragging",
          steady: "rhythm.steady",
          none: "rhythm.noHits",
        }[result.summary.tendency]
      : "",
  );
  const ms = (value: number) => `${value > 0 ? "+" : ""}${Math.round(value)}`;
</script>

<svelte:window onkeydown={onKey} onkeyup={onKey} />

<Page width="page">
  <div class="tool-view" data-testid="rhythm-trainer-view">
    <PageHeader
      title={t("rhythm.toolTitle")}
      titleSize="title"
      eyebrow={t("tools.nav")}
      subtitle={t("rhythm.intro")}
      backHref="/tools"
      backLabel={t("tools.heading")}
      backTestId="tool-back"
    />

    <div class="standalone-pickers">
      <label class="tool-field">
        <span>{t("rhythm.source")}</span>
        <select
          data-testid="rhythm-source"
          value={source}
          disabled={running}
          onchange={(event) => chooseSource(event.currentTarget.value as "builtin" | "song")}
        >
          <option value="builtin">{t("rhythm.sourceBuiltin")}</option>
          <option value="song">{t("rhythm.sourceSong")}</option>
        </select>
      </label>
      {#if source === "song"}
        <label class="tool-field">
          <span>{t("rhythm.song")}</span>
          <select
            data-testid="rhythm-song"
            value={songId}
            disabled={running}
            onchange={(event) => chooseSong(event.currentTarget.value)}
          >
            <option value="">{t("rhythm.chooseSong")}</option>
            {#each songs as song (song.id)}
              <option value={song.id}>{song.title}</option>
            {/each}
          </select>
        </label>
        {#if songDoc}
          {#if songDoc.tracks.length > 1}
            <label class="tool-field">
              <span>{t("rhythm.track")}</span>
              <select
                data-testid="rhythm-track"
                value={trackIndex}
                disabled={running}
                onchange={(event) => chooseTrack(Number(event.currentTarget.value))}
              >
                {#each songDoc.tracks as track, index (track.id)}
                  <option value={index}>{track.name}</option>
                {/each}
              </select>
            </label>
          {/if}
          <label class="tool-field">
            <span>{t("rhythm.songRhythm")}</span>
            <select
              data-testid="rhythm-song-rhythm"
              value={songPatternId}
              disabled={running || rhythms.length === 0}
              onchange={(event) => {
                songPatternId = event.currentTarget.value;
                result = null;
              }}
            >
              {#each rhythms as rhythm (rhythm.pattern.id)}
                <option value={rhythm.pattern.id}>{songLabel(rhythm)}</option>
              {/each}
            </select>
          </label>
        {/if}
      {:else}
        <label class="tool-field">
          <span>{t("rhythm.pattern")}</span>
          <select
            data-testid="rhythm-pattern"
            value={patternId}
            disabled={running}
            onchange={(event) => {
              patternId = event.currentTarget.value;
              result = null;
              persist();
            }}
          >
            {#each PATTERNS as option (option.id)}
              <option value={option.id}>{t(option.labelKey)}</option>
            {/each}
          </select>
        </label>
      {/if}
      <label class="tool-field">
        <span>{t("rhythm.tempo")}</span>
        <input
          type="number"
          data-testid="rhythm-bpm"
          min={MIN_BPM}
          max={MAX_BPM}
          value={bpm}
          disabled={running}
          aria-label={t("rhythm.tempo")}
          oninput={(event) => {
            bpm = clampBpm(Number(event.currentTarget.value));
            persist();
          }}
        />
      </label>
      <label class="tool-field">
        <span>{t("rhythm.bars")}</span>
        <select
          data-testid="rhythm-bars"
          value={bars}
          disabled={running}
          onchange={(event) => {
            bars = Number(event.currentTarget.value);
            persist();
          }}
        >
          {#each BAR_CHOICES as choice (choice)}
            <option value={choice}>{choice}</option>
          {/each}
        </select>
      </label>
      <label class="tool-toggle rhythm-mic">
        <input type="checkbox" data-testid="rhythm-mic" bind:checked={useMic} disabled={running} />
        {t("rhythm.useMic")}
      </label>
    </div>
    {#if useMic}
      <p class="muted small" data-testid="rhythm-mic-hint">
        {calibration === null
          ? t("rhythm.noCalibration")
          : t("rhythm.calibrated", { ms: Math.round(calibration) })}
      </p>
    {/if}
    {#if useMic}
      <ListenPanel
        session={micSession}
        deviceId={micDevice}
        channel={micChannel}
        level={micLevel}
        onDevice={(next) => (micDevice = next)}
        onChannel={(next) => (micChannel = next)}
      />
    {/if}
    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
    {#if source === "song"}
      {#if songError}
        <p class="alert" role="alert" data-testid="rhythm-song-error">
          <Icon name="alert" size={18} />{songError}
        </p>
      {:else if songDoc && rhythms.length === 0}
        <p class="muted small" data-testid="rhythm-song-empty">{t("rhythm.songEmpty")}</p>
      {/if}
    {/if}

    <div
      class="rhythm-bar"
      data-testid="rhythm-bar"
      role="img"
      aria-label={t("rhythm.barLabel", { pattern: pattern.label ?? t(pattern.labelKey) })}
    >
      {#each cells as cell (cell)}
        <div
          class="rhythm-cell {cellState(cell)}"
          class:beat={cell % pattern.grid === 0}
          class:now={position !== null && !position.countIn && position.cell === cell}
          data-testid={`rhythm-cell-${cell}`}
          data-state={cellState(cell)}
        >
          <span class="rhythm-count" aria-hidden="true"
            >{cell % pattern.grid === 0 ? cell / pattern.grid + 1 : "·"}</span
          >
          <div class="rhythm-note-area">
            <div class="rhythm-note-glyph">
              {#if cellState(cell) === "hit"}
                <svg viewBox="0 0 24 40" class="rhythm-note" aria-hidden="true">
                  <ellipse cx="9" cy="32" rx="6" ry="4.2" transform="rotate(-20 9 32)" />
                  <rect x="14" y="4" width="2" height="28" />
                  {#if hasFlag(pattern, cell, (i) => cellState(i) === "hit")}
                    <path d="M14 4 c5 2 7 7 6 12 c-2 -3 -4 -5 -6 -6" />
                    {#if pattern.grid === 4}
                      <path d="M14 11 c5 2 7 7 6 12 c-2 -3 -4 -5 -6 -6" />
                    {/if}
                  {/if}
                </svg>
              {:else}
                <svg viewBox="0 0 24 40" class="rhythm-rest" aria-hidden="true">
                  <rect x="5" y="24" width="14" height="4" />
                </svg>
              {/if}
            </div>
            {#if cellState(cell) === "hit"}
              {@const beam = beamAt(pattern, cell, (i) => cellState(i) === "hit")}
              {#if beam}
                <div
                  class="rhythm-beam"
                  data-testid="rhythm-beam"
                  data-span={beam.span}
                  style="width: calc({beam.span} * (100% + var(--rhythm-gap)) + 2px);"
                ></div>
                {#if beam.secondary}
                  <div
                    class="rhythm-beam secondary"
                    data-testid="rhythm-beam-secondary"
                    data-span={beam.span}
                    style="width: calc({beam.span} * (100% + var(--rhythm-gap)) + 2px);"
                  ></div>
                {/if}
              {/if}
            {/if}
          </div>
          {#if cellState(cell) === "hit"}
            <svg
              viewBox="0 0 24 28"
              class="rhythm-strum"
              aria-hidden="true"
              data-direction={strumDirection(pattern, cell)}
            >
              {#if strumDirection(pattern, cell) === "down"}
                <path d="M12 3v20M5 16l7 8 7-8" />
              {:else}
                <path d="M12 25V5M5 12l7-8 7 8" />
              {/if}
            </svg>
          {/if}
        </div>
      {/each}
    </div>
    {#if pattern.grid === 3}<p class="muted small">{t("rhythm.tripletNote")}</p>{/if}

    <div class="rhythm-status" aria-live="polite" data-testid="rhythm-status">
      {#if running}
        {position?.countIn !== false
          ? t("rhythm.countIn")
          : t("rhythm.playing", { bar: (position?.bar ?? 0) + 1, bars })}
      {/if}
    </div>

    <button
      class="rhythm-pad"
      data-testid="rhythm-pad"
      disabled={!running}
      onpointerdown={(event) => {
        event.preventDefault();
        record("touch");
      }}
      onkeydown={(event) => event.code === "Space" && event.preventDefault()}
    >
      <Icon name="tap" size={28} />
      <span>{t("rhythm.tap")}</span>
    </button>

    <div class="metronome-action-row">
      {#if running}
        <button class="primary metronome-toggle-btn" data-testid="rhythm-stop" onclick={stop}>
          <Icon name="pause" size={22} /><span>{t("tools.stop")}</span>
        </button>
      {:else}
        <button class="primary metronome-toggle-btn" data-testid="rhythm-start" onclick={begin}>
          <Icon name="play" size={22} /><span>{result ? t("rhythm.again") : t("tools.start")}</span>
        </button>
      {/if}
    </div>

    {#if result}
      <section class="rhythm-results" data-testid="rhythm-results" aria-label={t("rhythm.results")}>
        <h2>{t("rhythm.results")}</h2>
        <p
          class="rhythm-verdict"
          data-testid="rhythm-verdict"
          data-tendency={result.summary.tendency}
        >
          {t(messageKey)}
        </p>
        <dl class="rhythm-stats">
          <div>
            <dt>{t("rhythm.hits")}</dt>
            <dd data-testid="rhythm-hit-count">{result.summary.hit} / {result.summary.expected}</dd>
          </div>
          <div>
            <dt>{t("rhythm.extra")}</dt>
            <dd data-testid="rhythm-extra-count">{result.summary.extra}</dd>
          </div>
          {#if result.summary.meanMs !== null && result.summary.spreadMs !== null}
            <div>
              <dt>{t("rhythm.average")}</dt>
              <dd data-testid="rhythm-mean">{ms(result.summary.meanMs)} {t("rhythm.ms")}</dd>
            </div>
            <div>
              <dt>{t("rhythm.spread")}</dt>
              <dd data-testid="rhythm-spread">
                ±{Math.round(result.summary.spreadMs)}
                {t("rhythm.ms")}
              </dd>
            </div>
          {/if}
        </dl>
        <div
          class="rhythm-histogram"
          data-testid="rhythm-histogram"
          role="img"
          aria-label={t("rhythm.histogram")}
        >
          {#each bins as bin (bin.centerMs)}
            <div class="rhythm-bin">
              <div
                class="rhythm-bin-bar"
                class:early={bin.centerMs < 0}
                class:late={bin.centerMs > 0}
                style:height={`${(bin.count / binMax) * 100}%`}
                data-count={bin.count}
              ></div>
              <span class="rhythm-bin-label">{bin.centerMs > 0 ? "+" : ""}{bin.centerMs}</span>
            </div>
          {/each}
        </div>
        <p class="muted small">{t("rhythm.histogramHint")}</p>
        <h3>{t("rhythm.perBar")}</h3>
        <ol class="rhythm-per-bar" data-testid="rhythm-per-bar">
          {#each breakdown as row (row.bar)}
            <li data-testid={`rhythm-bar-row-${row.bar}`}>
              <span class="rhythm-bar-name">{t("rhythm.barNumber", { bar: row.bar + 1 })}</span>
              <span class="rhythm-bar-cells" aria-hidden="true">
                {#each row.cells as error, i (i)}
                  <span class="rhythm-bar-cell {errorTone(error)}" class:rest={error === undefined}
                  ></span>
                {/each}
              </span>
              <span class="rhythm-bar-stat" data-testid={`rhythm-bar-stat-${row.bar}`}>
                {row.hit}/{row.expected}
                {#if row.meanMs !== null}· {ms(row.meanMs)} {t("rhythm.ms")}{/if}
              </span>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
  </div>
</Page>

<style>
  .rhythm-mic {
    grid-column: 1 / -1;
    min-height: 44px;
  }
  .rhythm-bar {
    --rhythm-gap: 2px;
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: var(--rhythm-gap);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    padding: 0.75rem 0.5rem;
    overflow-x: auto;
  }
  .rhythm-cell {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0;
    border-radius: var(--r-xs);
    min-width: 0;
  }
  .rhythm-cell.beat {
    border-left: 2px solid var(--line-strong);
  }
  .rhythm-cell.now {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
  }
  .rhythm-count {
    font-size: 0.8rem;
    color: var(--text-2);
  }
  .rhythm-note-area {
    position: relative;
    width: 100%;
    height: 40px;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .rhythm-note-glyph {
    position: relative;
    width: 24px;
    height: 40px;
    flex: none;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .rhythm-note,
  .rhythm-rest {
    width: 24px;
    height: 40px;
    fill: var(--text);
  }
  .rhythm-beam {
    position: absolute;
    left: calc(50% + 2px);
    top: 4px;
    height: 4px;
    background: var(--text);
    z-index: 1;
    pointer-events: none;
    border-radius: 1px;
  }
  .rhythm-beam.secondary {
    top: 11px;
    height: 3px;
  }
  .rhythm-strum {
    width: 100%;
    max-width: 28px;
    height: auto;
    fill: none;
    stroke: var(--text-2);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .rhythm-rest {
    fill: var(--text-2);
  }
  .rhythm-status {
    min-height: 1.5rem;
    text-align: center;
    color: var(--text-2);
    font-weight: 600;
  }
  .rhythm-pad {
    min-height: 96px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    font-size: 1.1rem;
    border-radius: var(--r-md);
    border: 2px dashed var(--line-strong);
    background: var(--surface);
    color: var(--text);
    touch-action: manipulation;
  }
  .rhythm-pad:not(:disabled):active {
    background: color-mix(in srgb, var(--accent) 22%, var(--surface));
  }
  .rhythm-pad:disabled {
    opacity: 0.6;
  }
  .rhythm-results {
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .rhythm-verdict {
    font-size: 1.15rem;
    font-weight: 700;
    margin: 0;
  }
  .rhythm-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    gap: 0.75rem;
    margin: 0;
  }
  .rhythm-stats dt {
    font-size: 0.8rem;
    color: var(--text-2);
  }
  .rhythm-stats dd {
    margin: 0;
    font-weight: 700;
  }
  .rhythm-histogram {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 4px;
    height: 120px;
    align-items: end;
  }
  .rhythm-bin {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: stretch;
    height: 100%;
    gap: 2px;
  }
  .rhythm-bin-bar {
    background: var(--text-2);
    border-radius: var(--r-xs) var(--r-xs) 0 0;
    min-height: 0;
  }
  .rhythm-bin-bar.early {
    background: var(--grade-early);
  }
  .rhythm-bin-bar.late {
    background: var(--grade-late);
  }
  .rhythm-per-bar {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.4rem;
  }
  .rhythm-per-bar li {
    display: grid;
    grid-template-columns: 4.5rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.6rem;
  }
  .rhythm-bar-cells {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 2px;
  }
  .rhythm-bar-cell {
    height: 14px;
    border-radius: var(--r-xs);
    background: var(--line-strong);
  }
  .rhythm-bar-cell.rest {
    background: transparent;
    border: 1px dashed var(--line-strong);
  }
  .rhythm-bar-cell.good {
    background: var(--grade-hit);
  }
  .rhythm-bar-cell.early {
    background: var(--grade-early);
  }
  .rhythm-bar-cell.late {
    background: var(--grade-late);
  }
  .rhythm-bar-cell.missed {
    background: var(--grade-miss);
  }
  .rhythm-bar-stat {
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
  }
  .rhythm-bin-label {
    font-size: 0.7rem;
    text-align: center;
    color: var(--text-2);
  }
</style>
