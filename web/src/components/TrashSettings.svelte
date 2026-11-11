<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "./Icon.svelte";
  import { deleteTrashedSong, emptyTrash, listTrash, restoreSong } from "../lib/api";
  import type { TrashedSong } from "../lib/api-types";
  import { currentLocale, t } from "../lib/i18n.svelte";
  import { refreshSongs, ui } from "../lib/ui.svelte";

  // Hidden until the server says it keeps deleted songs, and for a library the person cannot edit.
  let days = $state(0);
  let items = $state<TrashedSong[]>([]);
  let error = $state("");
  let notice = $state("");
  let busy = $state(false);

  function day(iso: string): string {
    return new Date(iso).toLocaleDateString(currentLocale());
  }

  async function load() {
    try {
      const trash = await listTrash(ui.libraryId);
      days = trash.retention_days;
      items = trash.items;
    } catch {
      days = 0;
      items = [];
    }
  }

  async function run(action: () => Promise<void>) {
    error = "";
    notice = "";
    busy = true;
    try {
      await action();
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    } finally {
      busy = false;
    }
  }

  function restore(song: TrashedSong) {
    return run(async () => {
      await restoreSong(song.id);
      items = items.filter((item) => item.id !== song.id);
      notice = t("trash.restored", { title: song.title });
      await refreshSongs().catch(() => undefined);
    });
  }

  function remove(song: TrashedSong) {
    if (!confirm(t("trash.confirmDelete", { title: song.title }))) return;
    return run(async () => {
      await deleteTrashedSong(song.id);
      items = items.filter((item) => item.id !== song.id);
    });
  }

  function empty() {
    if (!confirm(t("trash.confirmEmpty", { count: items.length }))) return;
    return run(async () => {
      await emptyTrash(ui.libraryId);
      items = [];
    });
  }

  onMount(() => void load());
</script>

{#if days > 0}
  <section class="setting setting-stacked" data-testid="trash-settings">
    <div class="setting-label">
      <span class="setting-icon"><Icon name="trash" /></span>
      <div>
        <strong>{t("trash.heading")}</strong>
        <p class="muted">{t("trash.hint", { days })}</p>
      </div>
    </div>
    {#if items.length === 0}
      <p class="muted" data-testid="trash-empty">{t("trash.empty")}</p>
    {:else}
      <ul class="token-list">
        {#each items as song (song.id)}
          <li data-testid="trash-row">
            <div>
              <strong>{song.title}</strong>
              <p class="muted">
                {#if song.artist}{song.artist} ·
                {/if}{t("trash.deletedOn", { date: day(song.deleted_at) })}
                · {t("trash.purgedOn", { date: day(song.purge_at) })}
              </p>
            </div>
            <div class="account-row">
              <button
                type="button"
                disabled={busy}
                onclick={() => void restore(song)}
                data-testid="trash-restore"
              >
                {t("trash.restore")}
              </button>
              <button
                type="button"
                disabled={busy}
                onclick={() => void remove(song)}
                data-testid="trash-delete"
              >
                <Icon name="trash" size={16} />{t("trash.deleteForGood")}
              </button>
            </div>
          </li>
        {/each}
      </ul>
      <div class="account-row">
        <button
          type="button"
          disabled={busy}
          onclick={() => void empty()}
          data-testid="trash-clear"
        >
          {t("trash.emptyTrash")}
        </button>
      </div>
    {/if}
    {#if notice}<p class="muted" role="status" data-testid="trash-notice">{notice}</p>{/if}
    {#if error}<p class="alert" role="alert">{error}</p>{/if}
  </section>
{/if}
