<script lang="ts">
  import type { Snippet } from "svelte";

  import Page from "./Page.svelte";
  import PageHeader from "./PageHeader.svelte";
  import { t } from "../../lib/i18n.svelte";

  // The one tool-page template: the standard header, then a stage card (the live readout and the
  // primary action) beside a settings card. On phones they stack, with the stage first.
  let {
    title,
    subtitle = "",
    testid,
    stageLabel = "",
    settingsLabel = "",
    stage,
    settings,
    actions,
  }: {
    title: string;
    subtitle?: string;
    testid?: string;
    stageLabel?: string;
    settingsLabel?: string;
    stage: Snippet;
    settings?: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<Page width="page">
  <div class="tool-page" data-testid={testid}>
    <PageHeader
      {title}
      {subtitle}
      titleSize="title"
      eyebrow={t("tools.nav")}
      backHref="/tools"
      backLabel={t("tools.heading")}
      backTestId="tool-back"
      {actions}
    />

    <div class="body" class:single={!settings}>
      <section class="card stage" aria-label={stageLabel || undefined} data-testid="tool-stage">
        {@render stage()}
      </section>
      {#if settings}
        <section
          class="card settings"
          aria-label={settingsLabel || t("tools.settings")}
          data-testid="tool-settings"
        >
          {@render settings()}
        </section>
      {/if}
    </div>
  </div>
</Page>

<style>
  .tool-page {
    min-width: 0;
  }

  .body {
    display: grid;
    gap: var(--sp-4);
    align-items: start;
    min-width: 0;
  }

  .card {
    display: grid;
    gap: var(--sp-4);
    min-width: 0;
    padding: var(--sp-5);
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--surface);
  }

  @media (min-width: 768px) {
    .body:not(.single) {
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
    }
  }

  @media (max-width: 767px) {
    .card {
      padding: var(--sp-4);
    }
  }
</style>
