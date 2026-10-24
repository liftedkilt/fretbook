<script lang="ts">
  import Cover from "./Cover.svelte";
  import FirstRun from "./FirstRun.svelte";
  import Icon from "./Icon.svelte";
  import ManageTagsSheet from "./ManageTagsSheet.svelte";
  import RecentImports from "./RecentImports.svelte";
  import SetlistPicker from "./SetlistPicker.svelte";
  import { addTags, deleteSong } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { levelOf } from "../lib/difficulty";
  import { instrumentLabel } from "../lib/instruments";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { LibraryLevel, LibrarySort, SongSummary } from "../lib/types";
  import {
    countFor,
    defaultOrder,
    loadLibrary,
    loadMore,
    openSheet,
    refreshSongs,
    setSort,
    starSong,
    toggleTagFilter,
    ui,
    type LibraryFilter,
  } from "../lib/ui.svelte";

  let error = $state("");
  let pickerSong = $state<{ id: string; title: string } | null>(null);
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
    { id: "difficulty", key: "library.sortDifficulty" },
  ];
  const levels: { id: LibraryLevel; key: string }[] = [
    { id: "all", key: "difficulty.levelAll" },
    { id: "easy", key: "difficulty.levelEasy" },
    { id: "medium", key: "difficulty.levelMedium" },
    { id: "hard", key: "difficulty.levelHard" },
  ];

  // The server searches, filters, sorts and pages. Typing waits a moment; the other changes load at once.
  // App loads the first page; this only reacts to changes once it has.
  $effect(() => {
    const text = ui.search.trim();
    void [ui.filter, ui.sort, ui.order, ui.tags, ui.favouritesOnly, ui.level];
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

  let selecting = $state(false);
  let selected = $state<string[]>([]);
  let bulkTag = $state("");
  let bulkNotice = $state("");
  let managingTags = $state(false);

  function toggleSelecting() {
    selecting = !selecting;
    selected = [];
    bulkTag = "";
    bulkNotice = "";
  }

  function toggleSelected(id: string) {
    selected = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
  }

  async function tagSelected() {
    const tag = bulkTag.trim();
    if (!tag || selected.length === 0) return;
    try {
      const count = await addTags(selected, [tag]);
      bulkNotice = t("tags.bulkDone", { count, tag });
      selected = [];
      bulkTag = "";
      await refreshSongs();
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }

  async function toggleStar(song: SongSummary) {
    try {
      await starSong(song.id, !song.favourite);
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }

  function tagSelectedFilter(tag: string): boolean {
    return ui.tags.some((item) => item.toLowerCase() === tag.toLowerCase());
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
    {#if !ui.demoMode}
      <button class="primary hero-add" data-testid="add-song-hero" onclick={() => openSheet("add")}
        ><Icon name="plus" />{t("add.button")}</button
      >
    {/if}
  </header>

  <RecentImports />

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
        class="chip select-toggle"
        data-testid="library-select"
        aria-pressed={selecting}
        onclick={toggleSelecting}
      >
        {t("tags.select")}
      </button>
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
      <button
        class="chip"
        data-testid="library-filter-favourites"
        aria-pressed={ui.favouritesOnly}
        onclick={() => (ui.favouritesOnly = !ui.favouritesOnly)}
      >
        <Icon name={ui.favouritesOnly ? "starFilled" : "star"} size={14} />{t(
          "tags.favourites",
        )}<span class="chip-count">{countFor("favourites")}</span>
      </button>
    </div>

    <div class="chips" role="group" aria-label={t("difficulty.filters")}>
      {#each levels as item (item.id)}
        <button
          class="chip"
          data-testid={`library-level-${item.id}`}
          aria-pressed={ui.level === item.id}
          onclick={() => (ui.level = item.id)}
        >
          {t(item.key)}
        </button>
      {/each}
    </div>

    {#if ui.tagList.length}
      <div class="chips tag-chips" role="group" aria-label={t("tags.filters")}>
        {#each ui.tagList as item (item.tag)}
          <button
            class="chip"
            data-testid="library-tag"
            aria-pressed={tagSelectedFilter(item.tag)}
            onclick={() => toggleTagFilter(item.tag)}
          >
            <Icon name="tag" size={13} />{item.tag}<span class="chip-count">{item.count}</span>
          </button>
        {/each}
        <button
          class="chip"
          data-testid="library-manage-tags"
          onclick={() => (managingTags = true)}
        >
          {t("manageTags.open")}
        </button>
      </div>
    {/if}

    {#if selecting}
      <form
        class="bulk-bar"
        data-testid="library-bulk"
        onsubmit={(event) => {
          event.preventDefault();
          void tagSelected();
        }}
      >
        <span data-testid="library-selected">{t("tags.selected", { count: selected.length })}</span>
        <button
          type="button"
          data-testid="library-select-all"
          onclick={() => (selected = ui.songs.map((song) => song.id))}>{t("tags.selectAll")}</button
        >
        <input
          type="text"
          data-testid="library-bulk-tag"
          list="library-tag-suggestions"
          maxlength="40"
          bind:value={bulkTag}
          placeholder={t("tags.addPlaceholder")}
          aria-label={t("tags.bulkAdd")}
        />
        <datalist id="library-tag-suggestions">
          {#each ui.tagList as item (item.tag)}<option value={item.tag}></option>{/each}
        </datalist>
        <button
          class="primary"
          type="submit"
          data-testid="library-bulk-apply"
          disabled={!bulkTag.trim() || selected.length === 0}>{t("tags.bulkAdd")}</button
        >
      </form>
    {/if}
    {#if bulkNotice}<p class="muted" role="status" data-testid="library-bulk-notice">
        {bulkNotice}
      </p>{/if}
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
    {#if ui.demoMode}
      <div class="empty-state" data-testid="library-empty">
        <span class="empty-art"><Icon name="sparkle" size={34} /></span>
        <h2 class="display">{t("library.emptyTitle")}</h2>
        <p class="muted">{t("demo.banner")}</p>
      </div>
    {:else}
      <FirstRun />
    {/if}
  {:else if ui.songs.length === 0}
    <div class="empty-state compact" data-testid="library-filter-empty">
      <span class="empty-art"><Icon name="search" size={30} /></span>
      <p class="muted">
        {ui.search.trim()
          ? t("library.searchEmpty", { query: ui.search.trim() })
          : t("library.filterEmpty")}
      </p>
      {#if ui.tags.length || ui.favouritesOnly || ui.level !== "all"}
        <button
          data-testid="library-clear-tags"
          onclick={() => {
            ui.tags = [];
            ui.favouritesOnly = false;
            ui.level = "all";
          }}>{t("tags.clearFilters")}</button
        >
      {/if}
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
                  {#if song.difficulty !== null}
                    · <span data-testid="song-difficulty"
                      >{t("difficulty.level", { level: levelOf(song.difficulty) })}</span
                    >{/if}
                </span>
              {/if}
              {#if song.tags.length}
                <span class="song-tag-row" data-testid="song-card-tags">
                  {#each song.tags.slice(0, 3) as tag (tag)}<span class="tag-mini">{tag}</span
                    >{/each}
                  {#if song.tags.length > 3}<span class="tag-mini">+{song.tags.length - 3}</span
                    >{/if}
                </span>
              {/if}
            </span>
          </a>
          {#if selecting}
            <label class="song-select">
              <input
                type="checkbox"
                data-testid="song-select"
                checked={selected.includes(song.id)}
                onchange={() => toggleSelected(song.id)}
                aria-label={`${t("tags.selectSong")}: ${song.title}`}
              />
            </label>
          {/if}
          <div class="song-actions" class:starred={song.favourite}>
            <button
              class="icon-button glass song-star"
              class:on={song.favourite}
              data-testid="song-star"
              aria-pressed={song.favourite}
              onclick={() => void toggleStar(song)}
              aria-label={`${song.favourite ? t("tags.unfavourite") : t("tags.favourite")}: ${song.title}`}
              title={song.favourite ? t("tags.unfavourite") : t("tags.favourite")}
            >
              <Icon name={song.favourite ? "starFilled" : "star"} size={16} />
            </button>
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
              data-testid="song-add-to-setlist"
              onclick={() => (pickerSong = { id: song.id, title: song.title })}
              aria-label={`${t("setlists.addToSetlist")}: ${song.title}`}
              title={t("setlists.addToSetlist")}
            >
              <Icon name="list" size={16} />
            </button>
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
  <SetlistPicker song={pickerSong} onclose={() => (pickerSong = null)} />
</section>

<ManageTagsSheet open={managingTags} onclose={() => (managingTags = false)} />
