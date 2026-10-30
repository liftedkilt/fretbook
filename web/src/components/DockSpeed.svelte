<script lang="ts">
  import { RATES } from "../lib/shortcuts";
  import { formatRate } from "../lib/playerSheet";
  import { t } from "../lib/i18n.svelte";
  import DockTextButton from "./DockTextButton.svelte";

  let { rate, onchange }: { rate: number; onchange: (value: number) => void } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  const popoverId = "player-speed-popover";

  function choose(value: number) {
    onchange(value);
    open = false;
    queueMicrotask(() => root?.querySelector("button")?.focus());
  }

  function close() {
    open = false;
    queueMicrotask(() => root?.querySelector("button")?.focus());
  }

  $effect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) open = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Capture so a sheet that also listens for Escape stays open.
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  });
</script>

<div class="speed" bind:this={root}>
  <DockTextButton
    label={t("player.rate")}
    icon="gauge"
    value={formatRate(rate)}
    testid="player-speed"
    expanded={open}
    controls={open ? popoverId : undefined}
    onclick={() => (open = !open)}
  />
  {#if open}
    <div
      class="popover"
      id={popoverId}
      role="dialog"
      aria-label={t("player.rate")}
      data-testid="player-speed-popover"
    >
      {#each RATES as value (value)}
        <button
          type="button"
          aria-pressed={value === rate}
          data-testid={`player-speed-${value}`}
          onclick={() => choose(value)}
        >
          {formatRate(value)}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .speed {
    position: relative;
    display: inline-flex;
  }

  .popover {
    position: absolute;
    right: 0;
    bottom: calc(100% + var(--sp-2));
    z-index: 70;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: var(--sp-1);
    width: calc(var(--sp-8) * 4);
    padding: var(--sp-2);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  .popover button {
    min-width: var(--sp-8);
    min-height: 36px;
    padding: 0 var(--sp-2);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }

  .popover button[aria-pressed="true"] {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent-text);
  }

  @media (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    .popover {
      right: auto;
      left: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .popover button {
      transition: none;
    }
  }
</style>
