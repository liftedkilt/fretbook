<script lang="ts">
  import Icon from "../Icon.svelte";

  type Option = {
    value: string;
    label: string;
    icon?: string;
    testid?: string;
    disabled?: boolean;
  };

  // One single-choice switch: pill track, selected segment raised.
  let {
    label,
    value,
    options,
    onchange,
    testid,
    role = "radiogroup",
    disabled = false,
    icons = false,
  }: {
    label: string;
    value: string;
    options: Option[];
    onchange: (value: string) => void;
    testid?: string;
    role?: "radiogroup" | "tablist";
    disabled?: boolean;
    /** Icon-only segments. The label stays available to assistive tech. */
    icons?: boolean;
  } = $props();

  const tabs = $derived(role === "tablist");

  function move(event: KeyboardEvent) {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const enabled = options.filter((option) => !option.disabled && !disabled);
    if (enabled.length === 0) return;
    const index = Math.max(
      0,
      enabled.findIndex((option) => option.value === value),
    );
    let next = index;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    else if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % enabled.length;
    else next = (index - 1 + enabled.length) % enabled.length;
    event.preventDefault();
    const option = enabled[next];
    if (option.value !== value) onchange(option.value);
    const control = event.currentTarget as HTMLElement;
    queueMicrotask(() => {
      control.querySelector<HTMLElement>(`[data-value="${option.value}"]`)?.focus();
    });
  }
</script>

<div
  class="control segmented"
  class:icons
  {role}
  aria-label={label}
  aria-orientation="horizontal"
  data-testid={testid}
  onkeydown={move}
>
  {#each options as option (option.value)}
    <button
      type="button"
      role={tabs ? "tab" : "radio"}
      data-value={option.value}
      data-testid={option.testid}
      aria-checked={tabs ? undefined : value === option.value}
      aria-selected={tabs ? value === option.value : undefined}
      disabled={disabled || option.disabled}
      onclick={() => onchange(option.value)}
    >
      {#if option.icon}<Icon name={option.icon} size={icons ? 18 : 16} />{/if}
      <span class:visually-hidden={icons && Boolean(option.icon)}>{option.label}</span>
    </button>
  {/each}
</div>

<style>
  /* `.control.segmented` beats the older global `.segmented` rules in app.css. */
  .control.segmented {
    display: inline-flex;
    gap: var(--sp-1);
    max-width: 100%;
    padding: var(--sp-1);
    overflow-x: auto;
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    background: var(--surface);
    scrollbar-width: none;
  }

  .control.segmented::-webkit-scrollbar {
    display: none;
  }

  .control.segmented button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-1);
    min-height: 36px;
    padding: 0 var(--sp-3);
    border: 0;
    border-radius: var(--r-pill);
    background: transparent;
    box-shadow: none;
    color: var(--text-2);
    font-size: var(--fs-sm);
    line-height: 1.45;
    white-space: nowrap;
    transition:
      background 200ms var(--ease),
      color 200ms var(--ease);
  }

  .control.segmented button:hover:not(:disabled) {
    background: transparent;
    color: var(--text);
  }

  .control.segmented button[aria-checked="true"],
  .control.segmented button[aria-selected="true"] {
    background: var(--surface-3);
    box-shadow: none;
    color: var(--text);
  }

  .control.segmented button:disabled {
    opacity: 0.55;
  }

  .control.segmented.icons button {
    min-width: 36px;
    padding: 0 var(--sp-2);
  }

  @media (prefers-reduced-motion: reduce) {
    .control.segmented button {
      transition: none;
    }
  }
</style>
