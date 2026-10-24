<script lang="ts">
  import type { Snippet } from "svelte";

  // Shown on hover and on keyboard focus. Rendered only while visible so a
  // resting page does not carry a stack of hidden tooltips.
  let {
    text,
    placement = "below",
    children,
  }: {
    text: string;
    placement?: "above" | "below";
    children: Snippet<[string]>;
  } = $props();

  const tipId = `tip-${Math.random().toString(36).slice(2, 8)}`;
  let open = $state(false);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="tip"
  onmouseenter={() => (open = true)}
  onmouseleave={() => (open = false)}
  onfocusin={() => (open = true)}
  onfocusout={() => (open = false)}
>
  {@render children(open ? tipId : "")}
  {#if open}
    <span class="bubble {placement}" id={tipId} role="tooltip">{text}</span>
  {/if}
</span>

<style>
  .tip {
    position: relative;
    display: inline-flex;
    max-width: 100%;
  }

  .bubble {
    position: absolute;
    z-index: 70;
    left: 50%;
    width: max-content;
    max-width: 16rem;
    padding: var(--sp-1) var(--sp-2);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-sm);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    color: var(--text);
    font-size: var(--fs-xs);
    font-weight: 600;
    line-height: 1.4;
    pointer-events: none;
    transform: translateX(-50%);
  }

  .below {
    top: calc(100% + var(--sp-2));
  }

  .above {
    bottom: calc(100% + var(--sp-2));
  }
</style>
