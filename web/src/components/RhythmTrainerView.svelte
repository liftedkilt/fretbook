<script lang="ts">
  import Icon from "./Icon.svelte";
  import { Clicker } from "../lib/clicker";
  import { t } from "../lib/i18n.svelte";
  import { getLocalCalibration } from "../lib/listen/calibration";
  import { describeProblem, ListenError, startListening } from "../lib/listen/input";
  import type { ListenSession } from "../lib/listen/input";
  import { clampBpm, MAX_BPM, MIN_BPM } from "../lib/metronome";
  import {
    PATTERNS,
    cellCount,
    patternById,
    strumDirection,
    DEFAULT_PATTERN_ID,
  } from "../lib/rhythm/patterns";
  import {
    RhythmRun,
    type HitSource,
    type RhythmResult,
    type RunPosition,
  } from "../lib/rhythm/run";
  import { histogram } from "../lib/rhythm/timing";
  import { followLink, hrefFor } from "../lib/router.svelte";

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

  let running = $state(false);
  let position = $state<RunPosition | null>(null);
  let result = $state<RhythmResult | null>(null);
  let error = $state("");

  const pattern = $derived(patternById(patternId));
  const cells = $derived(Array.from({ length: cellCount(pattern) }, (_, i) => i));
  const calibration = $derived(useMic ? getLocalCalibration("default", "default") : null);
  const bins = $derived(result ? histogram(result.match.errors) : []);
  const binMax = $derived(Math.max(1, ...bins.map((b) => b.count)));
  /** Expected hits are listed in cell order, so each hit cell maps to its error by rank. */
  const cellErrors = $derived.by(() => {
    const map: Record<number, number | null> = {};
    if (!result) return map;
    const hitCells = cells.filter((c) => pattern.cells[c] === "x");
    // Only the first scored bar is drawn; later bars repeat it in the summary.
    hitCells.forEach((cell, i) => (map[cell] = result!.match.errors[i]));
    return map;
  });

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

  function errorClass(cell: number): string {
    if (!(cell in cellErrors)) return "";
    const error = cellErrors[cell];
    if (error === null) return "missed";
    if (Math.abs(error) <= 25) return "good";
    return error < 0 ? "early" : "late";
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

<div class="tool-view" data-testid="rhythm-trainer-view">
  <header class="tool-header">
    <a
      class="button ghost tool-back"
      data-testid="tool-back"
      href={hrefFor("/tools")}
      onclick={(event) => followLink(event, "/tools")}
    >
      <Icon name="back" size={18} /><span>{t("tools.heading")}</span>
    </a>
    <h1 class="display">{t("rhythm.toolTitle")}</h1>
  </header>

  <p class="muted">{t("rhythm.intro")}</p>

  <div class="standalone-pickers">
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
  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

  <div
    class="rhythm-bar"
    data-testid="rhythm-bar"
    role="img"
    aria-label={t("rhythm.barLabel", { pattern: t(pattern.labelKey) })}
  >
    {#each cells as cell (cell)}
      <div
        class="rhythm-cell {cellState(cell)} {errorClass(cell)}"
        class:beat={cell % pattern.grid === 0}
        class:now={position !== null && !position.countIn && position.cell === cell}
        data-testid={`rhythm-cell-${cell}`}
        data-state={cellState(cell)}
      >
        <span class="rhythm-count" aria-hidden="true"
          >{cell % pattern.grid === 0 ? cell / pattern.grid + 1 : "·"}</span
        >
        {#if cellState(cell) === "hit"}
          <svg viewBox="0 0 24 40" class="rhythm-note" aria-hidden="true">
            <ellipse cx="9" cy="32" rx="6" ry="4.2" transform="rotate(-20 9 32)" />
            <rect x="14" y="4" width="2" height="28" />
            {#if pattern.grid >= 2 && cell % pattern.grid !== pattern.grid - 1 && cellState(cell + 1) === "hit"}
              <rect x="14" y="4" width="24" height="4" />
              {#if pattern.grid === 4}<rect x="14" y="11" width="24" height="3" />{/if}
            {/if}
          </svg>
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
        {:else}
          <svg viewBox="0 0 24 40" class="rhythm-rest" aria-hidden="true">
            <rect x="5" y="24" width="14" height="4" />
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
    </section>
  {/if}
</div>

<style>
  .rhythm-mic {
    grid-column: 1 / -1;
    min-height: 44px;
  }
  .rhythm-bar {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(0, 1fr);
    gap: 2px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius, 12px);
    padding: 0.75rem 0.5rem;
    overflow-x: auto;
  }
  .rhythm-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0;
    border-radius: 6px;
    min-width: 0;
  }
  .rhythm-cell.beat {
    border-left: 2px solid var(--border);
  }
  .rhythm-cell.now {
    background: color-mix(in srgb, var(--accent, #4f8cff) 22%, transparent);
  }
  .rhythm-cell.good {
    background: color-mix(in srgb, #2e9e5b 25%, transparent);
  }
  .rhythm-cell.early,
  .rhythm-cell.late {
    background: color-mix(in srgb, #d9822b 25%, transparent);
  }
  .rhythm-cell.missed {
    background: color-mix(in srgb, #d04a4a 25%, transparent);
  }
  .rhythm-count {
    font-size: 0.8rem;
    color: var(--text-2);
  }
  .rhythm-note,
  .rhythm-strum,
  .rhythm-rest {
    width: 100%;
    max-width: 28px;
    height: auto;
    fill: var(--text);
    overflow: visible;
  }
  .rhythm-strum {
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
    border-radius: var(--radius, 12px);
    border: 2px dashed var(--border);
    background: var(--surface);
    color: var(--text);
    touch-action: manipulation;
  }
  .rhythm-pad:not(:disabled):active {
    background: color-mix(in srgb, var(--accent, #4f8cff) 22%, var(--surface));
  }
  .rhythm-pad:disabled {
    opacity: 0.6;
  }
  .rhythm-results {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius, 12px);
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
    border-radius: 3px 3px 0 0;
    min-height: 0;
  }
  .rhythm-bin-bar.early {
    background: #3b82c4;
  }
  .rhythm-bin-bar.late {
    background: #d9822b;
  }
  .rhythm-bin-label {
    font-size: 0.7rem;
    text-align: center;
    color: var(--text-2);
  }
</style>
