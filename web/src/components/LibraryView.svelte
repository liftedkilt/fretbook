<script lang="ts">
  import Cover from "./Cover.svelte";
  import Icon from "./Icon.svelte";
  import { deleteSong } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { instrumentLabel } from "../lib/instruments";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { LibrarySort, SongSummary } from "../lib/types";
  import {
    countFor,
    defaultOrder,
    loadLibrary,
    loadMore,
    openSheet,
    refreshSongs,
    setSort,
    ui,
    type LibraryFilter,
  } from "../lib/ui.svelte";

  let error = $state("");
  let searchInput = $state<HTMLInputElement>();
  let searchSeen = ui.search.trim();

  const filters: { id: LibraryFilter; key: string }[] = [
    { id: "all", key: "library.filterAll" },
    { id: "bass", key: "library.filterBass" },
    { id: "electric", key: "library.filterElectric" },
    { id: "acoustic", key: "library.filterAcoustic" },
    { id: "chords", key: "library.filterChords" },
  ];

  const sorts: { id: LibrarySort; key: string }[] = [
    { id: "updated", key: "library.sortRecent" },
    { id: "title", key: "library.sortTitle" },
    { id: "artist", key: "library.sortArtist" },
    { id: "added", key: "library.sortAdded" },
    { id: "opened", key: "library.sortOpened" },
  ];

  // The server searches, filters, sorts and pages. Typing waits a moment; the other changes load at once.
  // App loads the first page; this only reacts to changes once it has.
  $effect(() => {
    const text = ui.search.trim();
    void [ui.filter, ui.sort, ui.order];
    if (!ui.loaded) return;
    const delay = text === searchSeen ? 0 : 200;
    searchSeen = text;
    const timer = setTimeout(() => {
      loadLibrary().catch((err: unknown) => {
        error = err instanceof Error ? err.message : t("error.generic");
      });
    }, delay);
    return () => clearTimeout(timer);
  });

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    searchInput?.focus();
  }

  function flipOrder() {
    setSort(ui.sort, ui.order === "asc" ? "desc" : "asc");
  }

  async function more() {
    try {
      await loadMore();
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }

  const heading = $derived(
    t(filters.find((item) => item.id === ui.filter)?.key ?? "library.filterAll"),
  );

  async function remove(song: SongSummary) {
    if (!confirm(t("library.confirmDelete", { title: song.title }))) return;
    try {
      await deleteSong(song.id);
      await refreshSongs();
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }

  function kindLabel(song: SongSummary): string {
    return song.content_kind === "chords"
      ? t("library.chordSheet")
      : instrumentLabel(song.preferred_instrument);
  }
</script>

<svelte:window onkeydown={onKeydown} />

<section class="library">
  <header class="page-hero">
    <div>
      <p class="eyebrow">{t("library.heading")}</p>
      <h1 class="display hero-title">{ui.filter === "all" ? t("library.welcome") : heading}</h1>
      <p class="muted" data-testid="library-count">
        {t("library.count", { count: countFor(ui.filter) })}
      </p>
    </div>
    <button class="primary hero-add" data-testid="add-song-hero" onclick={() => openSheet("add")}
      ><Icon name="plus" />{t("add.button")}</button
    >
  </header>

  {#if countFor("all") > 0}
    <div class="toolbar">
      <label class="search">
        <Icon name="search" size={18} />
        <input
          type="search"
          data-testid="library-search"
          bind:this={searchInput}
          bind:value={ui.search}
          placeholder={t("library.search")}
          aria-label={t("library.search")}
          aria-keyshortcuts="/"
          title={t("library.searchShortcut")}
        />
      </label>
      <label class="sort">
        <span class="visually-hidden">{t("library.sort")}</span>
        <select
          value={ui.sort}
          data-testid="library-sort"
          aria-label={t("library.sort")}
          onchange={(event) => {
            const sort = event.currentTarget.value as LibrarySort;
            setSort(sort, defaultOrder(sort));
          }}
        >
          {#each sorts as item (item.id)}
            <option value={item.id}>{t(item.key)}</option>
          {/each}
        </select>
      </label>
      <button
        class="icon-button glass sort-order"
        data-testid="library-order"
        onclick={flipOrder}
        aria-label={t("library.order")}
        title={ui.order === "asc" ? t("library.orderAsc") : t("library.orderDesc")}
      >
        <span aria-hidden="true">{ui.order === "asc" ? "↑" : "↓"}</span>
      </button>
    </div>

    <div class="chips" role="group" aria-label={t("library.filters")}>
      {#each filters as item (item.id)}
        <button
          class="chip"
          data-testid={`library-filter-${item.id}`}
          aria-pressed={ui.filter === item.id}
          onclick={() => (ui.filter = item.id)}
        >
          {t(item.key)}<span class="chip-count">{countFor(item.id)}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

  {#if !ui.loaded}
    <div class="song-grid" aria-busy="true">
      {#each [0, 1, 2, 3, 4, 5] as index (index)}
        <div class="song-card skeleton">
          <div class="cover cover-md"></div>
          <span></span><span></span>
        </div>
      {/each}
    </div>
  {:else if countFor("all") === 0}
    <div class="empty-state" data-testid="library-empty">
      <span class="empty-art"><Icon name="sparkle" size={34} /></span>
      <h2 class="display">{t("library.emptyTitle")}</h2>
      <p class="muted">{t("library.empty")}</p>
      <div class="empty-actions">
        <button class="primary" onclick={() => openSheet("add")}
          ><Icon name="plus" />{t("add.button")}</button
        >
      </div>
    </div>
  {:else if ui.songs.length === 0}
    <div class="empty-state compact" data-testid="library-filter-empty">
      <span class="empty-art"><Icon name="search" size={30} /></span>
      <p class="muted">
        {ui.search.trim()
          ? t("library.searchEmpty", { query: ui.search.trim() })
          : t("library.filterEmpty")}
      </p>
      {#if ui.search.trim()}
        <button data-testid="library-clear-search" onclick={() => (ui.search = "")}
          >{t("library.clearSearch")}</button
        >
      {/if}
    </div>
  {:else}
    <div class="song-grid">
      {#each ui.songs as song (song.id)}
        <article class="song-card" data-testid="song-card">
          <a
            class="song-link"
            data-testid="song-link"
            href={hrefFor(`/songs/${song.id}`)}
            onclick={(event) => followLink(event, `/songs/${song.id}`)}
          >
            <span class="song-art">
              <Cover
                id={song.id}
                title={song.title}
                kind={song.content_kind}
                strings={song.string_count}
              />
              <span class="song-kind">
                <Icon
                  name={song.content_kind === "chords" ? "chords" : "tab"}
                  size={14}
                />{kindLabel(song)}
              </span>
              {#if song.has_audio}
                <span class="song-audio" title={t("library.audio")}
                  ><Icon name="waveform" size={14} /></span
                >
              {/if}
              <span class="song-play" aria-hidden="true"><Icon name="play" size={20} /></span>
            </span>
            <span class="song-text">
              <strong class="song-title" data-testid="song-title">{song.title}</strong>
              <span class="song-artist">{song.artist || "—"}</span>
              {#if song.content_kind === "tab"}
                <span class="song-meta">
                  {t("library.strings", { count: song.string_count })} · {t("library.measures", {
                    count: song.measure_count,
                  })} · {t("library.tempo", { bpm: song.bpm })}
                </span>
              {/if}
            </span>
          </a>
          <div class="song-actions">
            <a
              class="icon-button glass"
              data-testid="song-edit"
              href={hrefFor(`/songs/${song.id}/edit`)}
              onclick={(event) => followLink(event, `/songs/${song.id}/edit`)}
              aria-label={`${t("library.edit")}: ${song.title}`}
              title={t("library.edit")}
            >
              <Icon name="edit" size={16} />
            </a>
            <button
              class="icon-button glass"
              data-testid="song-delete"
              onclick={() => void remove(song)}
              aria-label={`${t("library.delete")}: ${song.title}`}
              title={t("library.delete")}
            >
              <Icon name="trash" size={16} />
            </button>
          </div>
        </article>
      {/each}
    </div>
    <div class="load-more">
      <p class="muted" data-testid="library-showing">
        {t("library.showing", { shown: ui.songs.length, total: ui.total })}
      </p>
      {#if ui.nextCursor}
        <button
          data-testid="library-load-more"
          disabled={ui.loadingMore}
          onclick={() => void more()}>{t("library.loadMore")}</button
        >
      {/if}
    </div>
  {/if}
</section>
