<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import Icon from "./Icon.svelte";
  import { dismissJob, listJobs, retryJob } from "../lib/api";
  import { keyed, t, tOr } from "../lib/i18n.svelte";
  import { importQueue } from "../lib/importQueue.svelte";
  import type { Job } from "../lib/types";
  import { refreshSongs, ui } from "../lib/ui.svelte";

  let serverJobs = $state<Job[]>([]);
  let retryingId = $state<string | null>(null);
  let dismissingId = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let reviewing = $state(false);
  let dismissingAll = $state(false);
  let sessionDoneIds = $state<Set<string>>(new Set());

  const allJobs = $derived([...(importQueue.clientJobs ?? []), ...(serverJobs ?? [])]);

  $effect(() => {
    // Track jobs that started in this session and finished
    for (const j of allJobs) {
      if (j.status === "queued" || j.status === "running") {
        if (!sessionDoneIds.has(j.id)) {
          sessionDoneIds.add(j.id);
        }
      }
    }
  });

  const activeJobs = $derived(
    allJobs.filter(
      (j) =>
        j.status === "queued" ||
        j.status === "running" ||
        j.status === "error" ||
        (j.status === "done" &&
          (sessionDoneIds.has(j.id) ||
            importQueue.trackedServerJobIds.has(j.id) ||
            j.id.startsWith("client-"))),
    ),
  );

  async function loadJobs() {
    try {
      const res = await listJobs();
      // Auto-sync estimates are the player's own business, not imports.
      serverJobs = (res ?? []).filter((job) => job.kind !== "audio.autosync");
    } catch {
      // ignore network errors when polling
    }
  }

  function startPollingIfNeeded() {
    const list = serverJobs ?? [];
    const clientList = importQueue.clientJobs ?? [];
    const hasRunning =
      list.some((j) => j.status === "queued" || j.status === "running") ||
      clientList.some((j) => j.status === "queued" || j.status === "running");

    if (hasRunning && !pollTimer) {
      pollTimer = setInterval(async () => {
        const prevDoneCount = (serverJobs ?? []).filter((j) => j.status === "done").length;
        await loadJobs();
        const nextDoneCount = (serverJobs ?? []).filter((j) => j.status === "done").length;
        if (nextDoneCount > prevDoneCount) {
          void refreshSongs();
        }
        if (!(serverJobs ?? []).some((j) => j.status === "queued" || j.status === "running")) {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
        }
      }, 1000);
    } else if (!hasRunning && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  $effect(() => {
    startPollingIfNeeded();
  });

  $effect(() => {
    if (!ui.sheet) {
      void loadJobs();
    }
  });

  $effect(() => {
    if (importQueue.lastServerRefresh > 0) {
      void loadJobs();
    }
  });

  onMount(() => {
    void loadJobs();
  });

  onDestroy(() => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });

  async function handleRetry(job: Job) {
    retryingId = job.id;
    try {
      await retryJob(job.id);
      await loadJobs();
    } catch {
      await loadJobs();
    } finally {
      retryingId = null;
    }
  }

  async function handleDismiss(job: Job) {
    dismissingId = job.id;
    try {
      if (job.id.startsWith("client-")) {
        importQueue.dismissJob(job.id);
      } else {
        importQueue.untrackJobId(job.id);
        await dismissJob(job.id);
        serverJobs = serverJobs.filter((j) => j.id !== job.id);
      }
      sessionDoneIds.delete(job.id);
    } catch {
      await loadJobs();
    } finally {
      dismissingId = null;
    }
  }

  const runningJobs = $derived(
    activeJobs.filter((job) => job.status === "queued" || job.status === "running"),
  );
  // Everything that has stopped: failures first, since they are what needs attention.
  const settledJobs = $derived([
    ...activeJobs.filter((job) => job.status === "error"),
    ...activeJobs.filter((job) => job.status === "done"),
  ]);
  const failedCount = $derived(settledJobs.filter((job) => job.status === "error").length);

  // Finished imports are good news, so they stay open; only failures fold into the banner.
  const expanded = $derived(reviewing || failedCount === 0);

  async function handleDismissAll() {
    dismissingAll = true;
    try {
      for (const job of settledJobs) await handleDismiss(job);
    } finally {
      dismissingAll = false;
      reviewing = false;
    }
  }

  function errorMessage(job: Job): string {
    return (
      keyed({ key: job.error_key, message: job.error ?? "", params: job.error_params }) ||
      t("error.generic")
    );
  }

  function statusMessage(job: Job): string {
    if (job.status === "queued") return t("recentImports.queued");
    if (job.status === "running") {
      return tOr(job.progress_key, job.progress || t("library.importing"));
    }
    if (job.status === "done") {
      if (job.result?.skipped) return t("recentImports.skippedDuplicate");
      if (job.result?.replaced) return t("recentImports.replacedDuplicate");
      return t("recentImports.completed");
    }
    return "";
  }
</script>

{#if activeJobs.length > 0}
  <aside class="imports" data-testid="recent-imports-panel" aria-label={t("recentImports.heading")}>
    {#if runningJobs.length > 0}
      <ul class="progress-list" data-testid="recent-imports-progress" aria-live="polite">
        {#each runningJobs.slice(0, 3) as job (job.id)}
          <li class="progress">
            <span class="spinner" aria-hidden="true"></span>
            <strong class="progress-label" data-testid="job-label">{job.label || job.id}</strong>
            <span class="muted progress-status" data-testid="job-status">{statusMessage(job)}</span>
            <button
              type="button"
              class="small-button ghost"
              data-testid="job-dismiss"
              disabled={dismissingId === job.id}
              onclick={() => void handleDismiss(job)}
            >
              {t("recentImports.dismiss")}
            </button>
          </li>
        {/each}
        {#if runningJobs.length > 3}
          <li class="progress muted" data-testid="recent-imports-more">
            {t("recentImports.moreRunning", { count: runningJobs.length - 3 })}
          </li>
        {/if}
      </ul>
    {/if}

    {#if settledJobs.length > 0}
      <div class="banner" class:failed={failedCount > 0} data-testid="recent-imports-banner">
        <span class="banner-icon" aria-hidden="true">
          <Icon name={failedCount > 0 ? "alert" : "check"} size={18} />
        </span>
        <span class="banner-text" data-testid="recent-imports-summary">
          {failedCount > 0
            ? t("recentImports.needAttention", { count: failedCount })
            : t("recentImports.finished", { count: settledJobs.length })}
        </span>
        {#if failedCount > 0}
          <button
            type="button"
            class="small-button ghost"
            data-testid="recent-imports-review"
            aria-expanded={reviewing}
            aria-controls="recent-imports-list"
            onclick={() => (reviewing = !reviewing)}
          >
            {reviewing ? t("recentImports.hide") : t("recentImports.review")}
          </button>
        {/if}
        <button
          type="button"
          class="small-button ghost"
          data-testid="recent-imports-dismiss-all"
          disabled={dismissingAll}
          onclick={() => void handleDismissAll()}
        >
          {t("recentImports.dismissAll")}
        </button>
      </div>
      {#if expanded}
        <ul class="recent-imports-list" id="recent-imports-list">
          {#each settledJobs as job (job.id)}
            <li
              class="recent-import-item"
              class:is-error={job.status === "error"}
              class:is-done={job.status === "done"}
              data-testid="recent-import-item"
            >
              <div class="job-info">
                <span class="job-icon">
                  <Icon name={job.status === "error" ? "alert" : "check"} size={18} />
                </span>
                <div class="job-details">
                  <span class="job-label" data-testid="job-label">{job.label || job.id}</span>
                  {#if job.status === "error"}
                    <span class="job-error" data-testid="job-error">{errorMessage(job)}</span>
                  {:else}
                    <span class="job-status muted" data-testid="job-status"
                      >{statusMessage(job)}</span
                    >
                  {/if}
                </div>
              </div>
              <div class="job-actions">
                {#if job.status === "done" && job.result?.song_id}
                  <a
                    class="small-button ghost"
                    href={`/songs/${job.result.song_id}`}
                    data-testid="job-link"
                  >
                    {t("recentImports.viewSong")}
                  </a>
                {/if}
                {#if job.status === "error" && !job.id.startsWith("client-")}
                  <button
                    class="small-button"
                    data-testid="job-retry"
                    disabled={retryingId === job.id}
                    onclick={() => void handleRetry(job)}
                  >
                    {retryingId === job.id ? t("recentImports.retrying") : t("recentImports.retry")}
                  </button>
                {/if}
                <button
                  class="small-button ghost"
                  data-testid="job-dismiss"
                  disabled={dismissingId === job.id}
                  onclick={() => void handleDismiss(job)}
                >
                  {dismissingId === job.id
                    ? t("recentImports.dismissing")
                    : t("recentImports.dismiss")}
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </aside>
{/if}

<style>
  .imports {
    display: grid;
    gap: var(--sp-2);
    margin-bottom: var(--sp-4);
  }

  .progress,
  .banner {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: 44px;
    padding: var(--sp-2) var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface);
    font-size: var(--fs-sm);
  }

  .progress-list {
    display: grid;
    gap: var(--sp-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .progress {
    min-height: 40px;
  }

  .progress-label {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .progress-status {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .banner.failed {
    border-color: color-mix(in srgb, var(--warn) 40%, transparent);
    background: var(--warn-soft);
  }

  .banner-icon {
    display: flex;
    flex: none;
    color: var(--success);
  }

  .banner.failed .banner-icon {
    color: var(--warn);
  }

  .banner-text {
    flex: 1;
    min-width: 0;
    font-weight: 600;
  }

  @media (max-width: 767px) {
    .banner {
      flex-wrap: wrap;
    }

    .banner-text {
      flex-basis: calc(100% - 40px);
    }
  }

  .recent-imports-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  .recent-import-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    padding: var(--sp-3);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    border: 1px solid var(--line);
    flex-wrap: wrap;
  }

  .recent-import-item.is-error {
    background: var(--danger-soft);
    border-color: color-mix(in srgb, var(--danger) 30%, transparent);
  }

  .recent-import-item.is-error .job-icon {
    color: var(--danger);
  }

  .recent-import-item.is-done .job-icon {
    color: var(--success);
  }

  .job-info {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-width: 0;
    flex: 1;
  }

  .job-icon {
    flex: none;
    display: flex;
    align-items: center;
  }

  .job-details {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    min-width: 0;
  }

  .job-label {
    font-weight: 600;
    font-size: var(--fs-sm);
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .job-error {
    font-size: var(--fs-sm);
    color: var(--danger);
    word-break: break-word;
  }

  .job-status {
    font-size: var(--fs-sm);
  }

  .job-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    flex: none;
  }
</style>
