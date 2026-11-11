<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import { dismissUndo, trashUndo, undoDelete } from "../lib/trash.svelte";
  import { refreshSongs } from "../lib/ui.svelte";

  let busy = $state(false);

  async function undo() {
    busy = true;
    try {
      if (await undoDelete()) await refreshSongs().catch(() => undefined);
    } finally {
      busy = false;
    }
  }
</script>

<div class="host" aria-live="polite" aria-atomic="true">
  {#if trashUndo.current}
    <div class="toast" role="status" data-testid="trash-undo">
      <span class="copy">
        {trashUndo.current.failed
          ? t("trash.undoFailed")
          : t("trash.moved", { title: trashUndo.current.title })}
      </span>
      <button
        type="button"
        class="primary"
        disabled={busy}
        onclick={() => void undo()}
        data-testid="trash-undo-button"
      >
        {t("trash.undo")}
      </button>
      <button
        type="button"
        class="close"
        aria-label={t("trash.dismiss")}
        onclick={dismissUndo}
        data-testid="trash-undo-dismiss"
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  {/if}
</div>

<style>
  .host {
    position: fixed;
    z-index: 45;
    left: 50%;
    bottom: calc(var(--sp-5) + env(safe-area-inset-bottom, 0px));
    transform: translateX(-50%);
    width: min(26rem, calc(100% - 2 * var(--pad)));
    pointer-events: none;
  }

  /* Clear the phone tab bar. */
  @media (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    .host {
      bottom: calc(72px + env(safe-area-inset-bottom, 0px) + var(--sp-3));
    }
  }

  .toast {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
    pointer-events: auto;
  }

  .copy {
    flex: 1;
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: var(--fs-sm);
  }

  .close {
    display: grid;
    place-items: center;
    flex: none;
    padding: var(--sp-2);
    border: 0;
    background: none;
    color: var(--text-2);
  }
</style>
