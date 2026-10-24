<script lang="ts">
  import Icon from "./Icon.svelte";
  import { ApiError, cleanOrphans, getAdminStorage } from "../lib/api";
  import { formatBytes } from "../lib/format";
  import { t } from "../lib/i18n.svelte";
  import type { OrphanReport, Storage as StorageReport } from "../lib/api-types";

  let report = $state<StorageReport | null>(null);
  let error = $state("");
  let notice = $state("");

  const orphans = $derived<OrphanReport>(report?.orphans ?? { files: 0, bytes: 0, empty_dirs: 0 });
  const tracked = $derived(
    (report?.users ?? []).filter((user) => !user.local || user.media_files + user.db_rows > 0),
  );
  const totals = $derived({
    rows: tracked.reduce((sum, user) => sum + user.db_rows, 0),
    files: tracked.reduce((sum, user) => sum + user.media_files, 0),
    bytes: tracked.reduce((sum, user) => sum + user.media_bytes, 0),
  });

  function message(err: unknown): string {
    if (err instanceof ApiError || err instanceof Error) return err.message;
    return t("error.generic");
  }

  async function refresh() {
    try {
      report = await getAdminStorage();
    } catch (err) {
      error = message(err);
    }
  }

  $effect(() => {
    void refresh();
  });

  async function cleanup() {
    if (!confirm(t("adminDashboard.storage.confirmCleanup"))) return;
    error = "";
    try {
      const done = await cleanOrphans();
      notice = t("adminDashboard.storage.cleaned", {
        count: done.files,
        size: formatBytes(done.bytes),
      });
      await refresh();
    } catch (err) {
      error = message(err);
    }
  }
</script>

{#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
{#if notice}<p class="muted" role="status">{notice}</p>{/if}

<section class="card">
  <h2 class="card-title">{t("adminDashboard.storage.heading")}</h2>
  <p class="muted">{t("adminDashboard.storage.hint")}</p>
  <div class="table-scroll">
    <table class="user-table" data-testid="storage-table">
      <thead>
        <tr>
          <th>{t("adminDashboard.storage.user")}</th>
          <th>{t("adminDashboard.storage.songs")}</th>
          <th>{t("adminDashboard.storage.rows")}</th>
          <th>{t("adminDashboard.storage.files")}</th>
          <th>{t("adminDashboard.storage.size")}</th>
          <th>{t("adminDashboard.storage.quota")}</th>
        </tr>
      </thead>
      <tbody>
        {#each tracked as user (user.user_id)}
          <tr>
            <td>{user.display_name}</td>
            <td>{user.song_count}</td>
            <td>{user.db_rows}</td>
            <td>{user.media_files}</td>
            <td>{formatBytes(user.media_bytes)}</td>
            <td>
              {#if user.quota_bytes}
                <meter
                  min="0"
                  max={user.quota_bytes}
                  value={user.media_bytes}
                  aria-label={t("adminDashboard.storage.quota")}
                ></meter>
                <div class="muted">
                  {formatBytes(user.media_bytes)} / {formatBytes(user.quota_bytes)}
                </div>
              {:else}
                <span class="muted">{t("adminDashboard.storage.noQuota")}</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <th>{t("adminDashboard.storage.total")}</th>
          <td></td>
          <td>{totals.rows}</td>
          <td>{totals.files}</td>
          <td>{formatBytes(totals.bytes)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>
</section>

<section class="card">
  <h2 class="card-title">{t("adminDashboard.storage.orphansHeading")}</h2>
  {#if orphans.files === 0 && orphans.empty_dirs === 0}
    <p class="muted" data-testid="orphans-none">{t("adminDashboard.storage.orphansNone")}</p>
  {:else}
    <p data-testid="orphans-found">
      {t("adminDashboard.storage.orphansFound", {
        count: orphans.files,
        size: formatBytes(orphans.bytes),
      })}
      {#if orphans.empty_dirs > 0}{t("adminDashboard.storage.emptyDirs", {
          count: orphans.empty_dirs,
        })}{/if}
    </p>
    <p class="muted">{t("adminDashboard.storage.orphansHint")}</p>
    <div class="button-row">
      <button class="primary" onclick={() => void cleanup()}>
        <Icon name="trash" size={16} />{t("adminDashboard.storage.cleanup")}
      </button>
    </div>
  {/if}
</section>
