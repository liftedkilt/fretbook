<script lang="ts">
  import { untrack } from "svelte";

  import Icon from "./Icon.svelte";
  import { crashDetails } from "../lib/crash";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import { ui } from "../lib/ui.svelte";

  // Shown by ErrorBoundary in place of a page that threw while rendering.
  let { error, reset, path }: { error: unknown; reset: () => void; path: string } = $props();

  const details = $derived(crashDetails(error, path, ui.version));
  let copied = $state(false);

  // Going to another page is a fresh start: show that page, not this screen.
  const brokenPath = untrack(() => path);
  $effect(() => {
    if (path !== brokenPath) reset();
  });

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(details);
      copied = true;
    } catch {
      copied = false;
    }
  }
</script>

<div class="empty-state crash" role="alert" data-testid="crash-screen">
  <span class="empty-art"><Icon name="alert" size={34} /></span>
  <h1 class="display">{t("crash.title")}</h1>
  <p class="muted">{t("crash.body")}</p>
  <div class="actions">
    <button type="button" class="primary" data-testid="crash-retry" onclick={reset}>
      <Icon name="refresh" size={18} />{t("crash.retry")}
    </button>
    <button type="button" data-testid="crash-reload" onclick={() => location.reload()}>
      {t("crash.reload")}
    </button>
    <a class="button" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}
      >{t("app.back")}</a
    >
  </div>
  <details>
    <summary>{t("crash.details")}</summary>
    <pre data-testid="crash-details">{details}</pre>
    <button type="button" class="ghost" data-testid="crash-copy" onclick={() => void copy()}>
      {copied ? t("crash.copied") : t("crash.copy")}
    </button>
  </details>
</div>

<style>
  .crash {
    max-width: 560px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--sp-2);
  }

  details {
    width: 100%;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }

  summary {
    cursor: pointer;
  }

  pre {
    max-height: 14rem;
    margin: var(--sp-2) 0;
    padding: var(--sp-3);
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-align: left;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
</style>
