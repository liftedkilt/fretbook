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
      serverJobs = res ?? [];
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
  <aside
    class="recent-imports-panel card"
    data-testid="recent-imports-panel"
    aria-label={t("recentImports.heading")}
  >
    <h2 class="card-title">{t("recentImports.heading")}</h2>
    <ul class="recent-imports-list">
      {#each activeJobs as job (job.id)}
        <li
          class="recent-import-item"
          class:is-error={job.status === "error"}
          class:is-done={job.status === "done"}
          data-testid="recent-import-item"
        >
          <div class="job-info">
            <span class="job-icon">
              {#if job.status === "error"}
                <Icon name="alert" size={18} />
              {:else if job.status === "done"}
                <Icon name="check" size={18} />
              {:else}
                <span class="spinner" aria-hidden="true"></span>
              {/if}
            </span>
            <div class="job-details">
              <span class="job-label" data-testid="job-label">{job.label || job.id}</span>
              {#if job.status === "error"}
                <span class="job-error" data-testid="job-error">{errorMessage(job)}</span>
              {:else}
                <span class="job-status muted" data-testid="job-status">{statusMessage(job)}</span>
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
                class="small-button primary"
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
              {dismissingId === job.id ? t("recentImports.dismissing") : t("recentImports.dismiss")}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  </aside>
{/if}

<style>
  .recent-imports-panel {
    margin-bottom: 1.5rem;
  }

  .recent-imports-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .recent-import-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border-radius: var(--r-md);
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
    color: var(--success, #22c55e);
  }

  .job-info {
    display: flex;
    align-items: center;
    gap: 0.75rem;
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
    gap: 0.2rem;
    min-width: 0;
  }

  .job-label {
    font-weight: 600;
    font-size: 0.92rem;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .job-error {
    font-size: 0.85rem;
    color: var(--danger);
    word-break: break-word;
  }

  .job-status {
    font-size: 0.85rem;
  }

  .job-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex: none;
  }
</style>
