<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import {
    isSetlistSaved,
    isSongSaved,
    removeSetlistOffline,
    removeSongOffline,
    saveSetlistOffline,
    saveSongOffline,
  } from "../lib/offline/offline.svelte";
  import { offlineSupported } from "../lib/offline/store";

  // `compact` shows only the icon (the text stays for screen readers), for headers with no room to spare.
  let {
    kind,
    id,
    title = "",
    compact = false,
  }: { kind: "song" | "setlist"; id: string; title?: string; compact?: boolean } = $props();

  let busy = $state(false);
  let error = $state("");

  const saved = $derived(kind === "song" ? isSongSaved(id) : isSetlistSaved(id));

  async function toggle() {
    busy = true;
    error = "";
    try {
      if (kind === "song") {
        if (saved) await removeSongOffline(id);
        else await saveSongOffline(id, title);
      } else if (saved) await removeSetlistOffline(id);
      else await saveSetlistOffline(id);
    } catch (err) {
      error = saved || !(err instanceof Error) ? t("offline.failed") : t("offline.saveFailed");
    } finally {
      busy = false;
    }
  }
</script>

{#if offlineSupported()}
  <span class="offline-toggle">
    <button
      type="button"
      data-testid="offline-toggle"
      aria-pressed={saved}
      disabled={busy}
      title={saved ? t("offline.removeHint") : t("offline.makeHint")}
      onclick={() => void toggle()}
    >
      <Icon name={saved ? "cloudCheck" : "cloudDownload"} size={18} />
      <span class:visually-hidden={compact}>
        {#if busy}{t("offline.working")}{:else if saved}{t("offline.saved")}{:else}{t(
            "offline.make",
          )}{/if}
      </span>
    </button>
    {#if error}<span class="small offline-error" role="alert">{error}</span>{/if}
  </span>
{/if}

<style>
  .offline-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .offline-error {
    color: var(--danger);
  }
</style>
