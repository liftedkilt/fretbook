<script lang="ts">
  import type { Snippet } from "svelte";

  import Icon from "../Icon.svelte";
  import { followLink, hrefFor } from "../../lib/router.svelte";

  // The one page-header template: back link, eyebrow, title, subtitle, actions.
  let {
    title,
    titleSize = "display",
    titleTestId,
    titleClass = "",
    eyebrow = "",
    subtitle = "",
    subtitleTestId,
    backHref = "",
    backLabel = "",
    backTestId,
    class: className = "",
    testid,
    leading,
    actions,
    below,
    titleContent,
  }: {
    title: string;
    titleSize?: "display" | "title";
    titleTestId?: string;
    titleClass?: string;
    eyebrow?: string;
    subtitle?: string;
    subtitleTestId?: string;
    backHref?: string;
    backLabel?: string;
    backTestId?: string;
    class?: string;
    testid?: string;
    leading?: Snippet;
    actions?: Snippet;
    below?: Snippet;
    /** Replaces the visible title (a rename field). `title` stays the h1 text. */
    titleContent?: Snippet;
  } = $props();
</script>

<header class="page-header {className}" data-testid={testid}>
  {#if backHref && backLabel}
    <a
      class="back"
      data-testid={backTestId}
      href={hrefFor(backHref)}
      onclick={(event) => followLink(event, backHref)}
    >
      <Icon name="back" size={18} /><span>{backLabel}</span>
    </a>
  {/if}
  <div class="row">
    <div class="identity">
      {#if leading}<div class="leading">{@render leading()}</div>{/if}
      <div class="text">
        {#if eyebrow}<p class="eyebrow">{eyebrow}</p>{/if}
        {#if titleContent}
          <h1 class="visually-hidden">{title}</h1>
          {@render titleContent()}
        {:else}
          <h1 class="{titleSize} {titleClass}" data-testid={titleTestId}>{title}</h1>
        {/if}
        {#if subtitle}<p class="subtitle" data-testid={subtitleTestId}>{subtitle}</p>{/if}
      </div>
    </div>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </div>
  <!-- Full width, so meta facts are not covered by the action buttons. -->
  {#if below}<div class="below">{@render below()}</div>{/if}
</header>

<style>
  .page-header {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--sp-2);
    margin-bottom: var(--sp-6);
    min-width: 0;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    align-self: flex-start;
    min-height: 44px;
    padding: 0 var(--sp-2) 0 0;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-sm);
    font-weight: 600;
    line-height: 1.45;
    text-decoration: none;
  }

  .back:hover {
    color: var(--text);
    background: var(--surface);
  }

  .row {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--sp-4);
    width: 100%;
    min-width: 0;
  }

  .identity {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-4);
    /* Stay wide enough for the title; the actions wrap onto the next line instead. */
    min-width: min(100%, 24rem);
    flex: 1 1 24rem;
  }

  .leading {
    flex: none;
  }

  .text {
    display: grid;
    gap: var(--sp-2);
    min-width: 0;
  }

  h1 {
    margin: 0;
    overflow-wrap: anywhere;
    font-family: var(--font-display);
    font-weight: 400;
    letter-spacing: -0.01em;
  }

  h1.display {
    font-size: var(--fs-display);
    line-height: 1.02;
  }

  h1.title {
    font-size: var(--fs-title);
    line-height: 1.1;
  }

  .subtitle {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-body);
    line-height: 1.55;
  }

  .below {
    display: grid;
    gap: var(--sp-2);
    width: 100%;
    min-width: 0;
  }

  .actions {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--sp-2);
    margin-left: auto;
    max-width: 100%;
  }

  /* Phones: actions wrap onto their own row under the title. */
  @media (max-width: 767px) {
    .identity {
      flex-wrap: wrap;
    }

    .actions {
      width: 100%;
      margin-left: 0;
      justify-content: flex-start;
    }
  }
</style>
