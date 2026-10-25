<script lang="ts">
  import Cover from "./Cover.svelte";
  import Icon from "./Icon.svelte";
  import NewSetlistSheet from "./setlists/NewSetlistSheet.svelte";
  import LibrarySwitch from "./shell/LibrarySwitch.svelte";
  import OverflowMenu from "./ui/OverflowMenu.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import { createSetlist, deleteSetlist, getSetlist, listSetlists, listSongs } from "../lib/api";
  import { coverSrc } from "../lib/cover";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor, navigate } from "../lib/router.svelte";
  import { formatDuration } from "../lib/practiceText";
  import { ui } from "../lib/ui.svelte";
  import { runningSeconds, setlistPath, songsById } from "../lib/setlists";
  import type { SetlistDetail, SetlistSummary, SongSummary } from "../lib/types";

  let setlists = $state<SetlistSummary[]>([]);
  let loaded = $state(false);
  let error = $state("");
  let creating = $state(false);
  let createError = $state("");
  // Each setlist's songs and the library's songs, for the cover mosaic and the running time.
  let details = $state<Record<string, SetlistDetail>>({});
  let songs = $state<Map<string, SongSummary>>(new Map());

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : t("error.generic");
  }

  $effect(() => {
    listSetlists()
      .then((rows) => {
        setlists = rows;
        loaded = true;
        // The extras fill in as they arrive; the cards work without them.
        for (const row of rows) {
          getSetlist(row.id)
            .then((detail) => (details[row.id] = detail))
            .catch(() => {});
        }
        return songsById((cursor) => listSongs({ limit: 200, sort: "title", cursor })).then(
          (found) => (songs = found),
        );
      })
      .catch(fail);
  });

  async function create(name: string) {
    createError = "";
    try {
      const made = await createSetlist(name);
      creating = false;
      navigate(setlistPath(made.id));
    } catch (err) {
      createError = err instanceof Error ? err.message : t("error.generic");
    }
  }

  async function remove(setlist: SetlistSummary) {
    if (!confirm(t("setlists.confirmDelete", { name: setlist.name }))) return;
    try {
      await deleteSetlist(setlist.id);
      setlists = setlists.filter((item) => item.id !== setlist.id);
    } catch (err) {
      fail(err);
    }
  }

  function summary(setlist: SetlistSummary): string {
    const count = t("setlists.count", { count: setlist.entry_count });
    const entries = details[setlist.id]?.entries;
    const seconds = entries
      ? runningSeconds(
          entries.map((entry) => entry.song_id),
          songs,
        )
      : 0;
    return seconds > 0
      ? t("setlists.countTime", { count: setlist.entry_count, time: formatDuration(seconds) })
      : count;
  }
</script>

<Page width="page">
  <section class="setlists-page">
    <LibrarySwitch active="setlists" />
    <PageHeader title={t("setlists.heading")}>
      {#snippet actions()}
        {#if !ui.demoMode}
          <button class="primary" data-testid="setlist-new" onclick={() => (creating = true)}>
            <Icon name="plus" size={18} />{t("setlists.newButton")}
          </button>
        {/if}
      {/snippet}
    </PageHeader>

    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

    {#if !loaded}
      <p class="muted" role="status">{t("app.loading")}</p>
    {:else if setlists.length === 0}
      <div class="empty-state compact" data-testid="setlists-empty">
        <span class="empty-art"><Icon name="listMusic" size={30} /></span>
        <p class="muted">{t("setlists.empty")}</p>
      </div>
    {:else}
      <ul class="setlist-grid">
        {#each setlists as setlist (setlist.id)}
          {@const entries = details[setlist.id]?.entries ?? []}
          <li class="setlist-card" data-testid="setlist-row">
            <a
              class="setlist-link"
              href={hrefFor(setlistPath(setlist.id))}
              onclick={(event) => followLink(event, setlistPath(setlist.id))}
            >
              <span class="mosaic" aria-hidden="true">
                {#each [0, 1, 2, 3] as slot (slot)}
                  {@const entry = entries[slot]}
                  {#if entry}
                    <Cover
                      id={entry.song_id}
                      title={entry.title}
                      kind={entry.content_kind}
                      strings={entry.string_count}
                      size="md"
                      src={coverSrc(songs.get(entry.song_id)?.cover_url)}
                    />
                  {:else}
                    <span class="blank"></span>
                  {/if}
                {/each}
              </span>
              <strong class="name">{setlist.name}</strong>
              <span class="muted">{summary(setlist)}</span>
            </a>
            {#if !ui.demoMode}
              <div class="card-menu">
                <OverflowMenu
                  label={t("setlists.cardMenu", { name: setlist.name })}
                  testid="setlist-card-menu"
                  items={[
                    {
                      id: "delete",
                      label: t("setlists.deleteItem"),
                      icon: "trash",
                      danger: true,
                      testid: "setlist-card-delete",
                      onclick: () => void remove(setlist),
                    },
                  ]}
                />
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if !ui.demoMode}
      <NewSetlistSheet
        open={creating}
        error={createError}
        onsubmit={(name) => void create(name)}
        onclose={() => (creating = false)}
      />
    {/if}
  </section>
</Page>

<style>
  .setlist-grid {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
    gap: var(--sp-4);
  }
  .setlist-card {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
  }
  .setlist-link {
    display: grid;
    gap: var(--sp-1);
    padding: var(--sp-3);
    color: inherit;
    text-decoration: none;
    min-width: 0;
  }
  .mosaic {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-1);
    margin-bottom: var(--sp-2);
  }
  .blank {
    aspect-ratio: 1;
    border-radius: var(--r-md);
    background: var(--surface-2);
  }
  .name {
    padding-right: 2.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .card-menu {
    position: absolute;
    right: var(--sp-2);
    bottom: var(--sp-2);
  }
</style>
