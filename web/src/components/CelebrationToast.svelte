<script lang="ts">
  import Icon from "./Icon.svelte";
  import { celebrations, type Celebration } from "../lib/celebrate";
  import { t } from "../lib/i18n.svelte";

  let current = $state<Celebration | null>(null);

  $effect(() => {
    return celebrations.subscribe((item) => {
      current = item;
    });
  });

  // Literal keys so the catalog test can see every milestone line.
  function streakLine(count: number): string {
    if (count === 3) return t("celebrations.streak.3");
    if (count === 7) return t("celebrations.streak.7");
    if (count === 14) return t("celebrations.streak.14");
    if (count === 30) return t("celebrations.streak.30");
    if (count === 50) return t("celebrations.streak.50");
    if (count === 100) return t("celebrations.streak.100");
    return "";
  }
</script>

<div class="host" aria-live="polite" aria-atomic="true" data-testid="celebration-host">
  {#if current}
    <div
      class="toast"
      class:visual={current.visual}
      class:visually-hidden={!current.visual}
      data-testid="celebration-toast"
      data-kind={current.kind}
      data-visual={current.visual ? "true" : "false"}
    >
      <span class="tile" aria-hidden="true">
        <Icon name={current.kind === "streak" ? "flame" : "target"} size={22} />
      </span>
      <span class="copy">
        {#if current.kind === "goal"}
          <strong>{t("celebrations.goalTitle")}</strong>
          {#if current.count > 0}
            <span>{t("celebrations.goalDetail", { count: current.count })}</span>
          {/if}
        {:else}
          <strong>{t("celebrations.streakTitle", { count: current.count })}</strong>
          {#if streakLine(current.count)}<span>{streakLine(current.count)}</span>{/if}
        {/if}
      </span>
    </div>
  {/if}
</div>

<style>
  .host {
    position: fixed;
    z-index: 45;
    top: var(--sp-4);
    left: 50%;
    transform: translateX(-50%);
    width: min(22rem, calc(100% - 2 * var(--pad)));
    pointer-events: none;
  }

  /* Sit under the phone top bar, which is 58px plus the safe area. */
  @media (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    .host {
      top: calc(58px + env(safe-area-inset-top, 0px) + var(--sp-3));
    }
  }

  .toast.visual {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    animation: toast-in 200ms var(--ease);
  }

  .tile {
    display: grid;
    place-items: center;
    flex: none;
    width: var(--sp-7);
    height: var(--sp-7);
    border-radius: var(--r-sm);
    background: var(--grad);
    color: var(--accent-ink);
    box-shadow: var(--glow);
  }

  .copy {
    display: grid;
    gap: var(--sp-1);
    min-width: 0;
  }

  .copy strong {
    font-size: var(--fs-body);
    line-height: 1.3;
  }

  .copy span {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .toast.visual {
      animation: none;
    }
  }
</style>
