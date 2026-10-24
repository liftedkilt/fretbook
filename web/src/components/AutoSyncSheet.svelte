<script lang="ts">
  import { onDestroy } from "svelte";

  import Icon from "./Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import { dismissJob, getJob, startAutoSync } from "../lib/api";
  import {
    barsToCheck,
    clampBar,
    confidencePercent,
    dueClicks,
    firstClickAt,
    previewClicks,
    proposedStarts,
    type Click,
  } from "../lib/autosync";
  import { Clicker } from "../lib/clicker";
  import { playedBars } from "../lib/playback";
  import { keyed, t, tOr } from "../lib/i18n.svelte";
  import type { AutoSyncProposal, ScoreDocument } from "../lib/types";

  let {
    open,
    songId,
    document: score,
    audioUrl,
    existing,
    onclose,
    onaccept,
  }: {
    open: boolean;
    songId: string;
    document: ScoreDocument;
    audioUrl: string;
    /** How many marks the song has now; accepting replaces them. */
    existing: number;
    onclose: () => void;
    /** The accepted anchors, played bar index to seconds. The caller saves them. */
    onaccept: (anchors: Record<string, number>) => void;
  } = $props();

  const SHOWN_BARS = 12;
  const clicker = new Clicker();

  let phase = $state<"idle" | "working" | "ready" | "failed">("idle");
  let progress = $state("");
  let error = $state("");
  let proposal = $state<AutoSyncProposal | null>(null);
  let startBar = $state(1);
  let previewing = $state(false);
  let volume = 0.8;

  let audio: HTMLAudioElement | null = null;
  let timer = 0;
  let clicks: Click[] = [];
  let cursor = 0;
  let run = 0;

  // The end of the last bar is a mark too, but not a bar.
  const playedCount = $derived(playedBars(score.bars).length);
  const barCount = $derived(
    proposal ? Object.keys(proposal.anchors).filter((key) => Number(key) < playedCount).length : 0,
  );
  const toCheck = $derived(proposal ? barsToCheck(proposal) : []);
  const shown = $derived(toCheck.slice(0, SHOWN_BARS).join(", "));

  async function estimate() {
    const mine = ++run;
    stopPreview();
    phase = "working";
    progress = t("autoSync.queued");
    error = "";
    proposal = null;
    try {
      const { job_id } = await startAutoSync(songId);
      for (let attempt = 0; attempt < 1200; attempt += 1) {
        const job = await getJob(job_id);
        if (job.status === "done" || job.status === "error") {
          // Read it once and let it go: it is not an import, and a failed one would sit in the import list.
          void dismissJob(job_id).catch(() => undefined);
        }
        if (mine !== run) return;
        if (job.status === "error") {
          throw new Error(
            keyed({ key: job.error_key, message: job.error ?? "", params: job.error_params }),
          );
        }
        if (job.status === "done") {
          const found = job.result?.autosync;
          if (!found) throw new Error(t("autoSync.noResult"));
          proposal = found;
          startBar = found.low_confidence.length ? found.low_confidence[0] + 1 : 1;
          phase = "ready";
          return;
        }
        progress = tOr(job.progress_key, job.progress || t("autoSync.working"));
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      throw new Error(t("autoSync.timeout"));
    } catch (err) {
      if (mine !== run) return;
      error = err instanceof Error ? err.message : t("error.generic");
      phase = "failed";
    }
  }

  // Start estimating each time the sheet opens; closing it drops the proposal and stops the preview.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) void estimate();
    if (!open && wasOpen) reset();
    wasOpen = open;
  });

  function reset() {
    run += 1;
    stopPreview();
    phase = "idle";
    proposal = null;
    error = "";
  }

  function startPreview() {
    if (!proposal) return;
    clicker.unlock();
    clicks = previewClicks(score, proposal.anchors);
    const starts = proposedStarts(score, proposal.anchors);
    const from = starts[clampBar(startBar, barCount)] ?? 0;
    audio ??= new Audio(audioUrl);
    audio.currentTime = Math.max(0, from);
    cursor = firstClickAt(clicks, audio.currentTime);
    audio.onended = stopPreview;
    previewing = true;
    void audio.play().catch(() => stopPreview());
    window.clearInterval(timer);
    timer = window.setInterval(tick, 40);
  }

  function tick() {
    if (!audio) return;
    const now = audio.currentTime;
    const next = dueClicks(clicks, cursor, now);
    cursor = next.cursor;
    for (const click of next.due) clicker.click(click.time - now, click.accent, volume);
  }

  function stopPreview() {
    window.clearInterval(timer);
    audio?.pause();
    previewing = false;
  }

  function accept() {
    if (!proposal) return;
    const anchors = { ...proposal.anchors };
    stopPreview();
    onaccept(anchors);
  }

  onDestroy(() => {
    window.clearInterval(timer);
    audio?.pause();
    audio = null;
    clicker.close();
  });
</script>

<Sheet
  {open}
  title={t("autoSync.title")}
  subtitle={t("autoSync.subtitle")}
  testid="autosync-sheet"
  onclose={() => {
    reset();
    onclose();
  }}
>
  <div class="autosync">
    {#if phase === "working" || phase === "idle"}
      <p class="muted" role="status" data-testid="autosync-working">{progress}</p>
    {:else if phase === "failed"}
      <p class="alert" role="alert" data-testid="autosync-error">
        <Icon name="alert" size={18} />{error}
      </p>
      <div class="row">
        <button data-testid="autosync-retry" onclick={() => void estimate()}>
          <Icon name="refresh" size={18} />{t("autoSync.retry")}
        </button>
        <button class="ghost" type="button" onclick={onclose}>{t("autoSync.close")}</button>
      </div>
    {:else if proposal}
      <section aria-live="polite" data-testid="autosync-summary">
        <p>
          {t("autoSync.summary", {
            marks: barCount,
            confidence: confidencePercent(proposal),
            bpm: Math.round(proposal.tempo_bpm),
          })}
        </p>
        {#if toCheck.length}
          <p class="muted" data-testid="autosync-check">
            {t("autoSync.check", { bars: shown })}{#if toCheck.length > SHOWN_BARS}&nbsp;{t(
                "autoSync.checkMore",
                { count: toCheck.length - SHOWN_BARS },
              )}{/if}
          </p>
        {:else}
          <p class="muted">{t("autoSync.allClear")}</p>
        {/if}
        {#if existing > 0}
          <p class="muted" data-testid="autosync-replaces">
            {t("autoSync.replaces", { count: existing })}
          </p>
        {/if}
      </section>

      <div class="row preview">
        <label class="field">
          <span>{t("autoSync.startAt")}</span>
          <input
            data-testid="autosync-start"
            type="number"
            min="1"
            max={Math.max(1, barCount)}
            value={startBar}
            onchange={(event) => {
              startBar = clampBar(Number(event.currentTarget.value), barCount) + 1;
              event.currentTarget.value = String(startBar);
            }}
          />
        </label>
        {#if previewing}
          <button data-testid="autosync-stop" onclick={stopPreview}>
            <Icon name="pause" size={18} />{t("autoSync.stop")}
          </button>
        {:else}
          <button data-testid="autosync-preview" onclick={startPreview}>
            <Icon name="play" size={18} />{t("autoSync.preview")}
          </button>
        {/if}
      </div>
      <p class="muted">{t("autoSync.previewHint")}</p>

      <div class="row">
        <button class="primary" data-testid="autosync-accept" onclick={accept}>
          <Icon name="check" size={18} />{t("autoSync.accept")}
        </button>
        <button class="ghost" type="button" data-testid="autosync-discard" onclick={onclose}>
          {t("autoSync.discard")}
        </button>
      </div>
      <p class="muted">{t("autoSync.acceptHint")}</p>
    {/if}
  </div>
</Sheet>

<style>
  .autosync {
    display: grid;
    gap: 0.9rem;
  }
  .preview {
    align-items: end;
  }
  .preview .field {
    max-width: 8rem;
  }
</style>
