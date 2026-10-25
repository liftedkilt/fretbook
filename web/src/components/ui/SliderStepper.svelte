<script lang="ts">
  import IconButton from "./IconButton.svelte";

  // A themed slider with a decrease and an increase icon button either side.
  let {
    label,
    value,
    min,
    max,
    step = 1,
    decreaseLabel,
    increaseLabel,
    testid,
    decreaseTestId,
    increaseTestId,
    disabled = false,
    onchange,
  }: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    decreaseLabel: string;
    increaseLabel: string;
    testid?: string;
    decreaseTestId?: string;
    increaseTestId?: string;
    disabled?: boolean;
    onchange: (value: number) => void;
  } = $props();
</script>

<div class="slider-stepper">
  <IconButton
    label={decreaseLabel}
    icon="minus"
    testid={decreaseTestId}
    disabled={disabled || value <= min}
    onclick={() => onchange(value - step)}
  />
  <input
    type="range"
    data-testid={testid}
    {min}
    {max}
    {step}
    {value}
    {disabled}
    aria-label={label}
    oninput={(event) => onchange(Number(event.currentTarget.value))}
  />
  <IconButton
    label={increaseLabel}
    icon="plus"
    testid={increaseTestId}
    disabled={disabled || value >= max}
    onclick={() => onchange(value + step)}
  />
</div>

<style>
  .slider-stepper {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-width: 0;
  }

  .slider-stepper :global(.icon-button) {
    min-width: 44px;
    min-height: 44px;
  }

  input {
    flex: 1;
    min-width: 0;
    min-height: 44px;
  }
</style>
