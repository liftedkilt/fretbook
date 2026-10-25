<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import { ui } from "../lib/ui.svelte";
  import { ytdlpHealth } from "../lib/ytdlp";
</script>

{#if ui.ytdlp}
  <section class="setting setting-stacked" data-testid="ytdlp-setting">
    <div class="setting-label">
      <span class="setting-icon"><Icon name="download" /></span>
      <div>
        <strong>{t("ytdlp.label")}</strong>
        <p class="muted">{t("ytdlp.hint")}</p>
        <p class="muted">
          {#if ui.ytdlp.version}
            {t("ytdlp.version", { version: ui.ytdlp.version })}
            {#if ui.ytdlp.released && ui.ytdlp.age_days !== null}
              · {t("ytdlp.released", { date: ui.ytdlp.released, count: ui.ytdlp.age_days })}
            {/if}
          {:else}
            {t("ytdlp.unknown")}
          {/if}
          {ui.ytdlp.auto_update ? t("ytdlp.autoUpdateOn") : t("ytdlp.autoUpdateOff")}
        </p>
      </div>
    </div>
    {#if ytdlpHealth(ui.ytdlp) === "stale"}
      <p class="notice setting-notice" role="status">
        {t("ytdlp.stale", { count: ui.ytdlp.age_days ?? 0 })}
      </p>
    {/if}
  </section>
{/if}
