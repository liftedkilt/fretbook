<script lang="ts">
  import Icon from "./Icon.svelte";
  import Tooltip from "./ui/Tooltip.svelte";

  // A dock control with an icon and a word. The word stays available to
  // assistive tech on a phone, where only the icon (and an optional value) show.
  let {
    label,
    icon,
    value = "",
    pressed,
    expanded,
    controls,
    testid,
    onclick,
  }: {
    label: string;
    icon: string;
    value?: string;
    pressed?: boolean;
    expanded?: boolean;
    controls?: string;
    testid?: string;
    onclick?: (event: MouseEvent) => void;
  } = $props();
</script>

<Tooltip text={value ? `${label} ${value}` : label} placement="above">
  {#snippet children(describedBy)}
    <button
      type="button"
      class="dock-label"
      data-testid={testid}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-describedby={describedBy || undefined}
      {onclick}
    >
      <Icon name={icon} size={18} />
      <span class="word">{label}</span>
      {#if value}<span class="value">{value}</span>{/if}
    </button>
  {/snippet}
</Tooltip>

<style>
  .dock-label {
    gap: var(--sp-1);
    min-height: 40px;
    padding: 0 var(--sp-3);
    border-color: transparent;
    background: transparent;
    color: var(--text-2);
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .dock-label:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }

  .dock-label[aria-pressed="true"] {
    background: var(--accent-soft);
    color: var(--accent-text);
  }

  .value {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }

  @media (max-width: 767px) {
    .word {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .dock-label {
      padding: 0 var(--sp-2);
    }
  }
</style>
