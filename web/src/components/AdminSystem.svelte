<script lang="ts">
  import Icon from "./Icon.svelte";
  import { ApiError, getAdminSystem } from "../lib/api";
  import { nodeVersion } from "../lib/buildInfo";
  import { formatBytes } from "../lib/format";
  import { t } from "../lib/i18n.svelte";
  import type { SystemInfo } from "../lib/api-types";

  let info = $state<SystemInfo | null>(null);
  let error = $state("");

  $effect(() => {
    getAdminSystem().then(
      (value) => (info = value),
      (err: unknown) =>
        (error =
          err instanceof ApiError || err instanceof Error ? err.message : t("error.generic")),
    );
  });

  const rows = $derived(
    info
      ? [
          [t("adminDashboard.system.version"), info.version],
          [t("adminDashboard.system.commit"), info.commit?.slice(0, 12) ?? ""],
          [t("adminDashboard.system.schema"), String(info.schema_version)],
          [t("adminDashboard.system.ytdlp"), info.ytdlp_version ?? ""],
          [t("adminDashboard.system.python"), info.python_version],
          [t("adminDashboard.system.node"), nodeVersion],
          [
            "diskFree",
            `${formatBytes(info.disk_free_bytes)} / ${formatBytes(info.disk_total_bytes)}`,
          ],
          [t("adminDashboard.system.database"), formatBytes(info.database_bytes)],
          [
            "quota",
            info.user_quota_mb
              ? formatBytes(info.user_quota_mb * 1024 * 1024)
              : t("adminDashboard.storage.noQuota"),
          ],
        ]
      : [],
  );
</script>

{#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

<section class="card">
  <h2 class="card-title">{t("adminDashboard.system.heading")}</h2>
  <dl class="system-info" data-testid="system-info">
    {#each rows as [label, value] (label)}
      <dt>{label}</dt>
      <dd>{value || t("adminDashboard.system.unknown")}</dd>
    {/each}
  </dl>
</section>
