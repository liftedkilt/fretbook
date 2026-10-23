<script lang="ts">
  import Icon from "./Icon.svelte";
  import { apiUrl, importLibrary, waitForJob } from "../lib/api";
  import { keyed, t, tOr } from "../lib/i18n.svelte";
  import { ui } from "../lib/ui.svelte";

  let mode = $state<"skip" | "copy">("skip");
  let busy = $state("");
  let error = $state("");
  let summary = $state("");
  let warnings = $state<string[]>([]);
  let input = $state<HTMLInputElement>();

  const isAdmin = $derived(ui.me?.authenticated === true && ui.me.role === "admin");

  async function restore(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    error = "";
    summary = "";
    warnings = [];
    busy = t("backup.restoring");
    try {
      const started = await importLibrary(file, mode);
      const job = await waitForJob(started.job_id, (current) => {
        busy = tOr(current.progress_key, current.progress || t("backup.restoring"));
      });
      if (job.status === "error") {
        throw new Error(
          keyed({ key: job.error_key, message: job.error ?? "", params: job.error_params }),
        );
      }
      const result = job.result ?? {};
      summary = t("backup.done", {
        imported: result.imported ?? 0,
        skipped: result.skipped ?? 0,
        copied: result.copied ?? 0,
        failed: result.failed ?? 0,
      });
      warnings = (result.warnings ?? []).map((item) => keyed(item));
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    } finally {
      busy = "";
      if (input) input.value = "";
    }
  }
</script>

<section class="setting setting-stacked" data-testid="backup-setting">
  <div class="setting-label">
    <span class="setting-icon"><Icon name="download" /></span>
    <div>
      <strong>{t("backup.heading")}</strong>
      <p class="muted">{t("backup.hint")}</p>
    </div>
  </div>
  <div class="account-row">
    <a class="button" href={apiUrl("/api/library/export")} download data-testid="backup-export">
      <Icon name="download" size={16} />{t("backup.export")}
    </a>
    {#if isAdmin}
      <a
        class="button"
        href={apiUrl("/api/admin/library/export")}
        download
        data-testid="backup-export-all"
      >
        <Icon name="download" size={16} />{t("backup.exportAll")}
      </a>
    {/if}
  </div>
  <div class="segmented" role="radiogroup" aria-label={t("backup.modeLabel")}>
    <button role="radio" aria-checked={mode === "skip"} onclick={() => (mode = "skip")}>
      {t("backup.modeSkip")}
    </button>
    <button role="radio" aria-checked={mode === "copy"} onclick={() => (mode = "copy")}>
      {t("backup.modeCopy")}
    </button>
  </div>
  <label class="field">
    <span>{t("backup.restore")}</span>
    <input
      bind:this={input}
      type="file"
      accept=".zip,application/zip"
      aria-label={t("backup.choose")}
      data-testid="backup-file"
      disabled={busy !== ""}
      onchange={restore}
    />
  </label>
  {#if busy}<p class="muted" role="status" data-testid="backup-busy">{busy}</p>{/if}
  {#if summary}<p class="notice setting-notice" role="status" data-testid="backup-summary">
      {summary}
    </p>{/if}
  {#if warnings.length}
    <p class="muted">{t("backup.warningsHeading")}</p>
    <ul class="muted">
      {#each warnings as warning, index (index)}<li>{warning}</li>{/each}
    </ul>
  {/if}
  {#if error}<p class="alert" role="alert">{error}</p>{/if}
</section>
