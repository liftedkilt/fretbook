<script lang="ts">
  import Icon from "../Icon.svelte";

  // filter: toggles. tag: opens or toggles a tag filter. meta: not interactive.
  let {
    variant,
    label,
    pressed = false,
    count,
    icon,
    accent = false,
    title,
    testid,
    disabled = false,
    onclick,
  }: {
    variant: "filter" | "tag" | "meta";
    label: string;
    pressed?: boolean;
    count?: number | string;
    icon?: string;
    accent?: boolean;
    title?: string;
    testid?: string;
    disabled?: boolean;
    onclick?: () => void;
  } = $props();
</script>

{#if variant === "meta"}
  <span class="meta" class:accent {title} data-testid={testid}>
    {#if icon}<Icon name={icon} size={14} />{/if}
    {label}
  </span>
{:else}
  <button
    type="button"
    class={variant}
    data-testid={testid}
    aria-pressed={pressed}
    {disabled}
    {title}
    {onclick}
  >
    {#if variant === "tag"}<Icon name="tag" size={13} />{/if}
    {#if icon}<Icon name={icon} size={14} />{/if}
    {label}
    {#if count !== undefined}<span class="count">{count}</span>{/if}
  </button>
{/if}

<style>
  .filter,
  .tag,
  .meta {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    flex: none;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .filter,
  .tag {
    min-height: 36px;
    padding: 0 var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    background: var(--surface);
    color: var(--text-2);
    font-size: var(--fs-sm);
    line-height: 1.45;
    transition:
      background 200ms var(--ease),
      color 200ms var(--ease),
      border-color 200ms var(--ease);
  }

  /* Hover is for pointers that can hover (touch keeps it stuck after a tap),
     and never applies to a pressed chip, whose text must stay --bg on --text. */
  @media (hover: hover) {
    .filter:hover:not(:disabled):not([aria-pressed="true"]),
    .tag:hover:not(:disabled):not([aria-pressed="true"]) {
      color: var(--text);
    }
  }

  .filter[aria-pressed="true"],
  .tag[aria-pressed="true"] {
    border-color: var(--text);
    background: var(--text);
    color: var(--bg);
  }

  .count {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }

  .filter[aria-pressed="true"] .count,
  .tag[aria-pressed="true"] .count {
    color: var(--bg);
    opacity: 0.75;
  }

  /* Meta is information, not a control: no border, no pill, no hover. */
  .meta {
    min-height: 24px;
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--r-xs);
    background: var(--surface-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    line-height: 1.4;
    cursor: default;
  }

  .meta.accent {
    color: var(--accent-text);
  }

  @media (prefers-reduced-motion: reduce) {
    .filter,
    .tag {
      transition: none;
    }
  }
</style>
