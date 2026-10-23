<script lang="ts">
  import type { Snippet } from "svelte";

  import Icon from "./Icon.svelte";

  // A button that opens a small list of actions. Closes on outside click, Escape, or choosing an item.
  let {
    label,
    icon = "more",
    showLabel = true,
    align = "end",
    up = false,
    disabled = false,
    testid,
    children,
  }: {
    label: string;
    icon?: string;
    showLabel?: boolean;
    align?: "start" | "end";
    up?: boolean;
    disabled?: boolean;
    testid?: string;
    children: Snippet<[() => void]>;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);

  function close() {
    open = false;
  }

  $effect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

<div class="menu" bind:this={root}>
  <button
    class={showLabel ? "button" : "icon-button"}
    data-testid={testid}
    aria-haspopup="menu"
    aria-expanded={open}
    aria-label={showLabel ? undefined : label}
    title={showLabel ? undefined : label}
    {disabled}
    onclick={() => (open = !open)}
  >
    <Icon name={icon} size={18} />
    {#if showLabel}<span>{label}</span><Icon name="chevronDown" size={16} />{/if}
  </button>
  {#if open}
    <div class="menu-list" class:menu-start={align === "start"} class:menu-up={up} role="menu">
      {@render children(close)}
    </div>
  {/if}
</div>
