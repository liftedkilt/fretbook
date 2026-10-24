<script lang="ts">
  import type { Snippet } from "svelte";

  // One of the three page widths from the design language, so pages that share
  // a width start at the same x. Content inside stays left-aligned.
  let {
    width = "page",
    class: className = "",
    testid,
    children,
  }: {
    width?: "narrow" | "page" | "wide";
    class?: string;
    testid?: string;
    children?: Snippet;
  } = $props();
</script>

<div class="page width-{width} {className}" data-page-width={width} data-testid={testid}>
  {#if children}{@render children()}{/if}
</div>

<style>
  .page {
    width: 100%;
    min-width: 0;
    margin-inline: 0;
  }

  /* Two classes so these beat `.content > *` (a hotspot rule on the shell). */
  .page.width-narrow {
    max-width: var(--page-narrow);
  }

  .page.width-page {
    max-width: var(--page);
  }

  .page.width-wide {
    max-width: var(--page-wide);
  }
</style>
