<script lang="ts">
  import Icon from "./Icon.svelte";
  import {
    ApiError,
    cancelAdminJob,
    getAdminJobs,
    getAdminWorkers,
    retryAdminJob,
  } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import type { JobOverview, Workers } from "../lib/api-types";

  const statusLabels = $derived<Record<string, string>>({
    queued: t("adminDashboard.jobs.status_queued"),
    running: t("adminDashboard.jobs.status_running"),
    done: t("adminDashboard.jobs.status_done"),
    error: t("adminDashboard.jobs.status_error"),
  });

  let overview = $state<JobOverview | null>(null);
  let workers = $state<Workers | null>(null);
  let status = $state("");
  let error = $state("");
  let notice = $state("");

  const kinds = $derived([...new Set((overview?.counts ?? []).map((row) => row.kind))]);

  function countOf(kind: string, state: string): number {
    return overview?.counts.find((row) => row.kind === kind && row.status === state)?.count ?? 0;
  }

  function message(err: unknown): string {
    if (err instanceof ApiError || err instanceof Error) return err.message;
    return t("error.generic");
  }

  function when(value: string): string {
    return new Date(value).toLocaleString();
  }

  async function refresh() {
    try {
      [overview, workers] = await Promise.all([
        getAdminJobs(status || undefined),
        getAdminWorkers(),
      ]);
    } catch (err) {
      error = message(err);
    }
  }

  $effect(() => {
    void status;
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  });

  async function act(run: () => Promise<unknown>, done: string) {
    error = "";
    try {
      await run();
      notice = done;
      await refresh();
    } catch (err) {
      error = message(err);
    }
  }

  function cancel(id: string, label: string) {
    if (!confirm(t("adminDashboard.jobs.confirmCancel", { name: label }))) return;
    void act(() => cancelAdminJob(id), t("adminDashboard.jobs.cancelled"));
  }
</script>

{#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
{#if notice}<p class="muted" role="status">{notice}</p>{/if}

<section class="card">
  <h2 class="card-title">{t("adminDashboard.jobs.heading")}</h2>
  <p class="muted">{t("adminDashboard.jobs.hint")}</p>
  {#if kinds.length > 0}
    <div class="table-scroll">
      <table class="user-table" data-testid="job-counts">
        <thead>
          <tr>
            <th>{t("adminDashboard.jobs.kind")}</th>
            {#each ["queued", "running", "done", "error"] as state (state)}
              <th>{statusLabels[state]}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each kinds as kind (kind)}
            <tr>
              <td>{kind}</td>
              {#each ["queued", "running", "done", "error"] as state (state)}
                <td>{countOf(kind, state)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <label class="field">
    {t("adminDashboard.jobs.filter")}
    <select bind:value={status} data-testid="job-status-filter">
      <option value="">{t("adminDashboard.jobs.all")}</option>
      {#each ["queued", "running", "done", "error"] as state (state)}
        <option value={state}>{statusLabels[state]}</option>
      {/each}
    </select>
  </label>
  {#if overview && overview.jobs.length === 0}
    <p class="muted">{t("adminDashboard.jobs.empty")}</p>
  {:else if overview}
    <div class="table-scroll">
      <table class="user-table" data-testid="job-table">
        <thead>
          <tr>
            <th>{t("adminDashboard.jobs.job")}</th>
            <th>{t("adminDashboard.jobs.owner")}</th>
            <th>{t("adminDashboard.jobs.status")}</th>
            <th>{t("adminDashboard.jobs.worker")}</th>
            <th>{t("adminDashboard.jobs.updated")}</th>
            <th>{t("adminDashboard.jobs.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {#each overview.jobs as job (job.id)}
            <tr>
              <td>
                {job.label}
                <div class="muted">{job.kind}</div>
                {#if job.status === "error" && job.error}<div class="muted">{job.error}</div>{/if}
              </td>
              <td>{job.owner_name}</td>
              <td
                ><span class="pill" class:pill-accent={job.status === "running"}
                  >{statusLabels[job.status]}</span
                ></td
              >
              <td class="muted">{job.worker_id}</td>
              <td>{when(job.updated_at)}</td>
              <td>
                {#if job.status === "queued"}
                  <button class="ghost" onclick={() => cancel(job.id, job.label)}>
                    <Icon name="close" size={16} />{t("adminDashboard.jobs.cancel")}
                  </button>
                {:else if job.status === "error"}
                  <button
                    class="ghost"
                    onclick={() =>
                      void act(() => retryAdminJob(job.id), t("adminDashboard.jobs.retried"))}
                  >
                    <Icon name="refresh" size={16} />{t("adminDashboard.jobs.retry")}
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<section class="card">
  <h2 class="card-title">{t("adminDashboard.jobs.workersHeading")}</h2>
  <p class="muted">{t("adminDashboard.jobs.workersHint")}</p>
  {#if workers && workers.workers.length === 0}
    <p class="muted">{t("adminDashboard.jobs.workersNone")}</p>
  {:else if workers}
    <div class="table-scroll">
      <table class="user-table" data-testid="worker-table">
        <thead>
          <tr>
            <th>{t("adminDashboard.jobs.worker")}</th>
            <th>{t("adminDashboard.jobs.host")}</th>
            <th>{t("adminDashboard.jobs.kinds")}</th>
            <th>{t("adminDashboard.jobs.heartbeat")}</th>
            <th>{t("adminDashboard.jobs.status")}</th>
          </tr>
        </thead>
        <tbody>
          {#each workers.workers as worker (worker.id)}
            <tr>
              <td>{worker.id}</td>
              <td>{worker.host}</td>
              <td>{worker.kinds.join(", ")}</td>
              <td>{when(worker.heartbeat_at)}</td>
              <td>
                <span class="pill" class:pill-accent={worker.alive}>
                  {worker.alive ? t("adminDashboard.jobs.alive") : t("adminDashboard.jobs.stale")}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  {#if workers}
    <p class="muted">
      {t("adminDashboard.jobs.localKinds", { kinds: workers.local_kinds.join(", ") })}
    </p>
  {/if}
</section>
