<script lang="ts">
  import { tick } from "svelte";

  import Icon from "../Icon.svelte";
  import IconButton from "./IconButton.svelte";

  export type OverflowItem = {
    id: string;
    label: string;
    icon?: string;
    href?: string;
    testid?: string;
    disabled?: boolean;
    /** Drawn last, after a divider, in the danger colour. */
    danger?: boolean;
    /** A choice that is currently selected (a check, before the label). */
    active?: boolean;
    onclick?: () => void;
  };

  let {
    label,
    items,
    testid,
    align = "end",
    placement = "below",
  }: {
    label: string;
    items: OverflowItem[];
    testid?: string;
    align?: "start" | "end";
    placement?: "above" | "below";
  } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  let menuEl = $state<HTMLDivElement | null>(null);
  const menuId = `overflow-${Math.random().toString(36).slice(2, 8)}`;

  const regular = $derived(items.filter((item) => !item.danger));
  const danger = $derived(items.filter((item) => item.danger));

  function enabledItems(): HTMLElement[] {
    return menuEl
      ? [...menuEl.querySelectorAll<HTMLElement>("[role='menuitem']:not([aria-disabled='true'])")]
      : [];
  }

  async function toggle() {
    open = !open;
    if (!open) return;
    await tick();
    enabledItems()[0]?.focus();
  }

  function close(restore = true) {
    if (!open) return;
    open = false;
    if (restore) {
      queueMicrotask(() => root?.querySelector("button")?.focus());
    }
  }

  function choose(item: OverflowItem) {
    if (item.disabled) return;
    close(false);
    item.onclick?.();
  }

  function onMenuKey(event: KeyboardEvent) {
    const list = enabledItems();
    const index = list.findIndex((node) => node === document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.preventDefault();
      if (list.length === 0) return;
      let next = index < 0 ? 0 : index;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = list.length - 1;
      else if (event.key === "ArrowDown") next = (Math.max(index, 0) + 1) % list.length;
      else next = (Math.max(index, 0) - 1 + list.length) % list.length;
      list[next]?.focus();
      return;
    }
    if (event.key === "Tab") close(false);
  }

  $effect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  });
</script>

{#snippet entry(item: OverflowItem)}
  {#if item.href}
    <a
      class="item"
      class:danger={item.danger}
      class:active={item.active}
      role="menuitem"
      href={item.href}
      data-testid={item.testid}
      aria-current={item.active ? "true" : undefined}
      aria-disabled={item.disabled || undefined}
      tabindex="0"
      onclick={(event) => {
        if (item.disabled) {
          event.preventDefault();
          return;
        }
        choose(item);
      }}
    >
      {#if item.active}<Icon name="check" size={18} />{/if}
      {#if item.icon}<Icon name={item.icon} size={18} />{/if}
      {item.label}
    </a>
  {:else}
    <button
      type="button"
      class="item"
      class:danger={item.danger}
      class:active={item.active}
      role="menuitem"
      data-testid={item.testid}
      aria-current={item.active ? "true" : undefined}
      aria-disabled={item.disabled || undefined}
      disabled={item.disabled}
      onclick={() => choose(item)}
    >
      {#if item.active}<Icon name="check" size={18} />{/if}
      {#if item.icon}<Icon name={item.icon} size={18} />{/if}
      {item.label}
    </button>
  {/if}
{/snippet}

<div class="menu" bind:this={root}>
  <IconButton
    {label}
    icon="more"
    {testid}
    {placement}
    haspopup="menu"
    expanded={open}
    controls={open ? menuId : undefined}
    onclick={() => void toggle()}
  />
  {#if open}
    <div
      class="list"
      class:start={align === "start"}
      class:up={placement === "above"}
      id={menuId}
      role="menu"
      aria-label={label}
      tabindex="-1"
      bind:this={menuEl}
      onkeydown={onMenuKey}
    >
      {#each regular as item (item.id)}
        {@render entry(item)}
      {/each}
      {#if regular.length > 0 && danger.length > 0}
        <div class="divider" role="separator"></div>
      {/if}
      {#each danger as item (item.id)}
        {@render entry(item)}
      {/each}
    </div>
  {/if}
</div>

<style>
  .menu {
    position: relative;
    display: inline-flex;
  }

  .list {
    position: absolute;
    top: calc(100% + var(--sp-2));
    right: 0;
    z-index: 60;
    display: grid;
    gap: 2px;
    min-width: 220px;
    padding: var(--sp-1);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  .start {
    right: auto;
    left: 0;
  }

  .up {
    top: auto;
    bottom: calc(100% + var(--sp-2));
  }

  .item {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--sp-2);
    width: 100%;
    min-height: 40px;
    padding: 0 var(--sp-3);
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text);
    font-size: var(--fs-sm);
    line-height: 1.45;
    text-align: left;
    text-decoration: none;
  }

  .item:hover:not(:disabled),
  .item:focus-visible {
    background: var(--surface-2);
  }

  .danger {
    color: var(--danger);
  }

  .active {
    font-weight: 650;
  }

  .divider {
    height: 1px;
    margin: var(--sp-1) var(--sp-2);
    background: var(--line);
  }
</style>
