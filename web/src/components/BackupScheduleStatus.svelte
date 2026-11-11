<script lang="ts">
  import Icon from "./Icon.svelte";
  import { ApiError, getBackupSchedule, runBackupNow } from "../lib/api";
  import { formatBytes } from "../lib/format";
  import { t } from "../lib/i18n.svelte";
  import type { BackupSchedule } from "../lib/api-types";

  let status = $state<BackupSchedule | null>(null);
  let error = $state("");
  let saved = $state("");
  let busy = $state(false);

  function message(err: unknown): string {
    if (err instanceof ApiError) {
      if (err.key === "backupSchedule.failed")
        return t("backupSchedule.failed", { reason: String(err.params.reason ?? err.message) });
      if (err.key === "backupSchedule.busy") return t("backupSchedule.busy");
      return err.message;
    }
    return err instanceof Error ? err.message : t("error.generic");
  }

  function when(value: string): string {
    return new Date(value).toLocaleString();
  }

  async function load() {
    try {
      status = await getBackupSchedule();
    } catch (err) {
      error = message(err);
    }
  }

  $effect(() => {
    void load();
  });

  async function backUpNow() {
    busy = true;
    error = "";
    saved = "";
    try {
      status = await runBackupNow();
      if (status.last_snapshot)
        saved = t("backupSchedule.saved", { path: status.last_snapshot.path });
    } catch (err) {
      error = message(err);
      await load();
    } finally {
      busy = false;
    }
  }

  const scheduleLabels = $derived<Record<BackupSchedule["schedule"], string>>({
    off: t("backupSchedule.schedule.off"),
    daily: t("backupSchedule.schedule.daily"),
    weekly: t("backupSchedule.schedule.weekly"),
  });
  const scheduleLabel = $derived(status ? scheduleLabels[status.schedule] : "");
</script>

<section class="setting setting-stacked" data-testid="backup-schedule">
  <div class="setting-label">
    <span class="setting-icon"><Icon name="save" /></span>
    <div>
      <strong>{t("backupSchedule.heading")}</strong>
      {#if status}
        <p class="muted">
          {t("backupSchedule.scheduleLine", { schedule: scheduleLabel, keep: status.keep })}
          {#if status.next_due_at}· {t("backupSchedule.nextDue", {
              when: when(status.next_due_at),
            })}{/if}
        </p>
        <p class="muted">{t("backupSchedule.directory", { path: status.directory })}</p>
        <p class="muted" data-testid="backup-last">
          {#if status.last_snapshot}
            {t("backupSchedule.last", {
              when: when(status.last_snapshot.created_at),
              size: formatBytes(status.last_snapshot.bytes),
            })}
          {:else}
            {t("backupSchedule.never")}
          {/if}
        </p>
      {/if}
    </div>
  </div>
  {#if status?.last_error && !error}
    <p class="alert setting-notice" role="alert" data-testid="backup-error">
      <Icon name="alert" size={18} />{t("backupSchedule.lastError", {
        when: status.last_error_at ? when(status.last_error_at) : "",
        reason: status.last_error,
      })}
    </p>
  {/if}
  {#if error}
    <p class="alert setting-notice" role="alert" data-testid="backup-error">
      <Icon name="alert" size={18} />{error}
    </p>
  {/if}
  {#if saved}<p class="muted" role="status">{saved}</p>{/if}
  <div>
    <button
      class="primary"
      type="button"
      data-testid="backup-now"
      disabled={busy || status?.running}
      onclick={() => void backUpNow()}
    >
      {busy ? t("backupSchedule.running") : t("backupSchedule.backUpNow")}
    </button>
  </div>
</section>
