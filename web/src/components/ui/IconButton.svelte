<script lang="ts">
  import Icon from "../Icon.svelte";
  import Tooltip from "./Tooltip.svelte";

  // An icon-only button. The label is required: it is the accessible name and the tooltip.
  let {
    label,
    icon,
    size = 18,
    class: className = "",
    testid,
    pressed,
    expanded,
    haspopup,
    controls,
    disabled = false,
    placement = "below",
    onclick,
  }: {
    label: string;
    icon: string;
    size?: number;
    class?: string;
    testid?: string;
    pressed?: boolean;
    expanded?: boolean;
    haspopup?: "menu" | "dialog" | "true" | "listbox" | "tree" | "grid";
    controls?: string;
    disabled?: boolean;
    placement?: "above" | "below";
    onclick?: (event: MouseEvent) => void;
  } = $props();
</script>

<Tooltip text={label} {placement}>
  {#snippet children(describedBy)}
    <button
      type="button"
      class="icon-button {className}"
      data-testid={testid}
      aria-label={label}
      aria-describedby={describedBy || undefined}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={haspopup}
      aria-controls={controls}
      {disabled}
      {onclick}
    >
      <Icon name={icon} {size} />
    </button>
  {/snippet}
</Tooltip>
