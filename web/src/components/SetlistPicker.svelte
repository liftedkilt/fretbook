<script lang="ts">
  import Icon from "./Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import { addSetlistEntry, createSetlist, listSetlists } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { setlistPath } from "../lib/setlists";
  import { hrefFor, followLink } from "../lib/router.svelte";
  import type { SetlistSummary } from "../lib/types";

  // "Add to setlist": lists the user's setlists and offers a new one. `song` is the song to add, or null while closed.
  let { song, onclose }: { song: { id: string; title: string } | null; onclose: () => void } =
    $props();

  let setlists = $state<SetlistSummary[]>([]);
  let loaded = $state(false);
  let name = $state("");
  let busy = $state(false);
  let error = $state("");
  let done = $state<{ id: string; name: string } | null>(null);

  $effect(() => {
    if (!song) return;
    loaded = false;
    error = "";
    done = null;
    name = "";
    listSetlists()
      .then((rows) => {
        setlists = rows;
        loaded = true;
      })
      .catch(fail);
  });

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : t("error.generic");
  }

  async function addTo(target: { id: string; name: string }) {
    if (!song || busy) return;
    busy = true;
    error = "";
    try {
      await addSetlistEntry(target.id, song.id);
      done = target;
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  async function createAndAdd(event: SubmitEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    busy = true;
    error = "";
    try {
      const made = await createSetlist(trimmed);
      busy = false;
      await addTo({ id: made.id, name: made.name });
    } catch (err) {
      fail(err);
      busy = false;
    }
  }
</script>

<Sheet
  open={song !== null}
  title={t("setlists.addToTitle")}
  subtitle={song?.title ?? ""}
  testid="setlist-picker"
  {onclose}
>
  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
  {#if done}
    <p role="status" data-testid="setlist-picker-done">
      {t("setlists.addedTo", { title: song?.title ?? "", name: done.name })}
    </p>
    <p>
      <a
        class="button"
        href={hrefFor(setlistPath(done.id))}
        onclick={(event) => {
          onclose();
          followLink(event, setlistPath(done!.id));
        }}>{t("setlists.open")}</a
      >
    </p>
  {:else}
    {#if !loaded}
      <p class="muted" role="status">{t("app.loading")}</p>
    {:else if setlists.length === 0}
      <p class="muted" data-testid="setlist-picker-empty">{t("setlists.pickerEmpty")}</p>
    {:else}
      <ul class="plain-list" data-testid="setlist-picker-list">
        {#each setlists as setlist (setlist.id)}
          <li>
            <button
              class="menu-item"
              data-testid="setlist-picker-item"
              disabled={busy}
              onclick={() => void addTo(setlist)}
            >
              <Icon name="listMusic" size={18} />
              <span>{setlist.name}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <form class="setlist-new" onsubmit={createAndAdd}>
      <label class="visually-hidden" for="picker-new-setlist">{t("setlists.newLabel")}</label>
      <input
        id="picker-new-setlist"
        data-testid="setlist-picker-name"
        bind:value={name}
        maxlength="200"
        placeholder={t("setlists.pickerNew")}
      />
      <button
        class="primary"
        type="submit"
        data-testid="setlist-picker-create"
        disabled={!name.trim() || busy}
      >
        <Icon name="plus" size={18} />{t("setlists.create")}
      </button>
    </form>
  {/if}
</Sheet>

<style>
  .plain-list {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    display: grid;
    gap: 0.25rem;
  }
  .setlist-new {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
  }
  .setlist-new input {
    flex: 1 1 12rem;
  }
</style>
