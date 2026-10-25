<script lang="ts">
  import Icon from "./Icon.svelte";
  import Page from "./ui/Page.svelte";
  import LibrarySwitch from "./shell/LibrarySwitch.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import { createSetlist, deleteSetlist, listSetlists } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor, navigate } from "../lib/router.svelte";
  import { ui } from "../lib/ui.svelte";
  import { setlistPath } from "../lib/setlists";
  import type { SetlistSummary } from "../lib/types";

  let setlists = $state<SetlistSummary[]>([]);
  let loaded = $state(false);
  let name = $state("");
  let error = $state("");

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : t("error.generic");
  }

  $effect(() => {
    listSetlists()
      .then((rows) => {
        setlists = rows;
        loaded = true;
      })
      .catch(fail);
  });

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    error = "";
    try {
      const made = await createSetlist(name.trim());
      navigate(setlistPath(made.id));
    } catch (err) {
      fail(err);
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
</script>

<Page width="page">
  <section class="setlists-page">
    <LibrarySwitch active="setlists" />
    <PageHeader title={t("setlists.heading")} eyebrow={t("setlists.nav")} />

    {#if !ui.demoMode}<form class="setlist-new" onsubmit={create}>
        <label class="visually-hidden" for="new-setlist">{t("setlists.newLabel")}</label>
        <input
          id="new-setlist"
          data-testid="setlist-new-name"
          bind:value={name}
          maxlength="200"
          placeholder={t("setlists.newPlaceholder")}
        />
        <button class="primary" type="submit" data-testid="setlist-create" disabled={!name.trim()}>
          <Icon name="plus" size={18} />{t("setlists.create")}
        </button>
      </form>{/if}

    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

    {#if !loaded}
      <p class="muted" role="status">{t("app.loading")}</p>
    {:else if setlists.length === 0}
      <div class="empty-state compact" data-testid="setlists-empty">
        <span class="empty-art"><Icon name="listMusic" size={30} /></span>
        <p class="muted">{t("setlists.empty")}</p>
      </div>
    {:else}
      <ul class="setlist-list">
        {#each setlists as setlist (setlist.id)}
          <li class="setlist-row" data-testid="setlist-row">
            <a
              class="setlist-link"
              href={hrefFor(setlistPath(setlist.id))}
              onclick={(event) => followLink(event, setlistPath(setlist.id))}
            >
              <Icon name="listMusic" size={20} />
              <strong>{setlist.name}</strong>
              <span class="muted">{t("setlists.count", { count: setlist.entry_count })}</span>
            </a>
            {#if !ui.demoMode}<button
                class="icon-button glass"
                onclick={() => void remove(setlist)}
                aria-label={`${t("setlists.delete")}: ${setlist.name}`}
                title={t("setlists.delete")}
              >
                <Icon name="trash" size={16} />
              </button>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</Page>

<style>
  .setlist-new {
    display: flex;
    gap: 0.6rem;
    margin: 1rem 0 1.25rem;
    flex-wrap: wrap;
  }
  .setlist-new input {
    flex: 1 1 14rem;
  }
  .setlist-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .setlist-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    padding: 0.35rem 0.6rem 0.35rem 0.85rem;
  }
  .setlist-link {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.55rem 0;
    color: inherit;
    text-decoration: none;
    min-width: 0;
    min-height: 44px;
  }
  .setlist-link strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
