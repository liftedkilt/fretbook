<script lang="ts">
  import FirstRun from "./FirstRun.svelte";
  import Icon from "./Icon.svelte";
  import LibrarySwitch from "./shell/LibrarySwitch.svelte";
  import LibraryPicker from "./LibraryPicker.svelte";
  import ManageTagsSheet from "./ManageTagsSheet.svelte";
  import RecentImports from "./RecentImports.svelte";
  import SetlistPicker from "./SetlistPicker.svelte";
  import FiltersPopover from "./library/FiltersPopover.svelte";
  import SongCard from "./library/SongCard.svelte";
  import Chip from "./ui/Chip.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import { addTags, deleteSong } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { keyLabel } from "../lib/keys";
  import type { LibraryLevel, LibrarySort, SongSummary, SortOrder } from "../lib/types";
  import {
    countFor,
    loadLibrary,
    loadMore,
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

  // The direction is part of the choice, so there is no separate arrow to decode.
  const sorts: { sort: LibrarySort; order: SortOrder; key: string }[] = [
    { sort: "updated", order: "desc", key: "libraryToolbar.sort.updatedDesc" },
    { sort: "updated", order: "asc", key: "libraryToolbar.sort.updatedAsc" },
    { sort: "title", order: "asc", key: "libraryToolbar.sort.titleAsc" },
    { sort: "title", order: "desc", key: "libraryToolbar.sort.titleDesc" },
    { sort: "artist", order: "asc", key: "libraryToolbar.sort.artistAsc" },
    { sort: "artist", order: "desc", key: "libraryToolbar.sort.artistDesc" },
    { sort: "added", order: "desc", key: "libraryToolbar.sort.addedDesc" },
    { sort: "added", order: "asc", key: "libraryToolbar.sort.addedAsc" },
    { sort: "opened", order: "desc", key: "libraryToolbar.sort.openedDesc" },
    { sort: "opened", order: "asc", key: "libraryToolbar.sort.openedAsc" },
    { sort: "difficulty", order: "asc", key: "libraryToolbar.sort.difficultyAsc" },
    { sort: "difficulty", order: "desc", key: "libraryToolbar.sort.difficultyDesc" },
  ];
  const levelKeys: Record<Exclude<LibraryLevel, "all">, string> = {
    easy: "difficulty.levelEasy",
    medium: "difficulty.levelMedium",
    hard: "difficulty.levelHard",
  };

  // The server searches, filters, sorts and pages. Typing waits a moment; the other changes load at once.
  // App loads the first page; this only reacts to changes once it has.
  $effect(() => {
    const text = ui.search.trim();
    void [
      ui.filter,
      ui.sort,
      ui.order,
      ui.tags,
      ui.favouritesOnly,
      ui.level,
      ui.keyFilter,
      ui.genreFilter,
    ];
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

  type ActiveFilter = { id: string; label: string; remove: () => void };

  // The filters inside the popover, shown as removable chips so they are never hidden state.
  const activeFilters = $derived.by<ActiveFilter[]>(() => {
    const list: ActiveFilter[] = [];
    if (ui.level !== "all") {
      const level = ui.level;
      list.push({ id: "level", label: t(levelKeys[level]), remove: () => (ui.level = "all") });
    }
    if (ui.keyFilter) {
      list.push({
        id: "key",
        label: `${t("metadata.filterKey")}: ${keyLabel(ui.keyFilter, t)}`,
        remove: () => (ui.keyFilter = ""),
      });
    }
    if (ui.genreFilter) {
      list.push({
        id: "genre",
        label: `${t("metadata.filterGenre")}: ${ui.genreFilter}`,
        remove: () => (ui.genreFilter = ""),
      });
    }
    for (const tag of ui.tags) {
      list.push({ id: `tag:${tag}`, label: tag, remove: () => toggleTagFilter(tag) });
    }
    return list;
  });

  function clearFilters() {
    ui.level = "all";
    ui.keyFilter = "";
    ui.genreFilter = "";
    ui.tags = [];
  }

  const paged = $derived(ui.nextCursor !== null && ui.nextCursor !== undefined);
</script>

<svelte:window onkeydown={onKeydown} />

<Page width="wide">
  <section class="library">
    <LibraryPicker />
    <LibrarySwitch active="songs" />
    <PageHeader
      title={ui.filter === "all" ? t("library.welcome") : heading}
      eyebrow={t("library.heading")}
      subtitle={t("library.count", { count: countFor(ui.filter) })}
      subtitleTestId="library-count"
    ></PageHeader>

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
            value={`${ui.sort}:${ui.order}`}
            data-testid="library-sort"
            aria-label={t("library.sort")}
            onchange={(event) => {
              const [sort, order] = event.currentTarget.value.split(":");
              setSort(sort as LibrarySort, order as SortOrder);
            }}
          >
            {#each sorts as item (`${item.sort}:${item.order}`)}
              <option value={`${item.sort}:${item.order}`}>{t(item.key)}</option>
            {/each}
          </select>
        </label>
        <FiltersPopover
          count={activeFilters.length}
          onmanagetags={ui.demoMode ? undefined : () => (managingTags = true)}
        />
        {#if !ui.demoMode}
          <span class="select-toggle">
            <Chip
              variant="filter"
              label={t("tags.select")}
              testid="library-select"
              pressed={selecting}
              onclick={toggleSelecting}
            />
          </span>
        {/if}
      </div>

      <div class="chip-line">
        <div class="chips" role="group" aria-label={t("library.filters")}>
          {#each filters as item (item.id)}
            <Chip
              variant="filter"
              label={t(item.key)}
              count={countFor(item.id)}
              testid={`library-filter-${item.id}`}
              pressed={ui.filter === item.id}
              onclick={() => (ui.filter = item.id)}
            />
          {/each}
          <Chip
            variant="filter"
            label={t("tags.favourites")}
            icon={ui.favouritesOnly ? "starFilled" : "star"}
            count={countFor("favourites")}
            testid="library-filter-favourites"
            pressed={ui.favouritesOnly}
            onclick={() => (ui.favouritesOnly = !ui.favouritesOnly)}
          />
        </div>
      </div>

      {#if activeFilters.length}
        <div class="active" role="group" aria-label={t("libraryToolbar.active")}>
          {#each activeFilters as filter (filter.id)}
            <button
              type="button"
              class="active-chip"
              data-testid="library-active-filter"
              aria-label={t("libraryToolbar.remove", { filter: filter.label })}
              onclick={filter.remove}
            >
              {filter.label}
              <Icon name="close" size={14} />
            </button>
          {/each}
          <button
            type="button"
            class="clear"
            data-testid="library-clear-filters"
            onclick={clearFilters}>{t("libraryToolbar.clear")}</button
          >
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
          <span data-testid="library-selected"
            >{t("tags.selected", { count: selected.length })}</span
          >
          <button
            type="button"
            data-testid="library-select-all"
            onclick={() => (selected = ui.songs.map((song) => song.id))}
            >{t("tags.selectAll")}</button
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
          <div class="skeleton">
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
        {#if activeFilters.length || ui.favouritesOnly}
          <button
            data-testid="library-clear-tags"
            onclick={() => {
              clearFilters();
              ui.favouritesOnly = false;
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
          <SongCard
            {song}
            readOnly={ui.demoMode}
            {selecting}
            selected={selected.includes(song.id)}
            onselect={() => toggleSelected(song.id)}
            onstar={() => void toggleStar(song)}
            onsetlist={() => (pickerSong = { id: song.id, title: song.title })}
            ondelete={() => void remove(song)}
          />
        {/each}
      </div>
      <div class="load-more" data-testid="library-end">
        {#if paged}
          <p class="muted" data-testid="library-showing">
            {t("library.showing", { shown: ui.songs.length, total: ui.total })}
          </p>
        {/if}
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
</Page>

<ManageTagsSheet open={managingTags} onclose={() => (managingTags = false)} />

<style>
  .toolbar {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    margin-bottom: var(--sp-3);
  }

  .search {
    position: relative;
    flex: 1;
    max-width: 520px;
    min-width: 0;
  }

  .search :global(.icon) {
    position: absolute;
    left: var(--sp-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-3);
    pointer-events: none;
  }

  .search input {
    min-height: 44px;
    padding-left: var(--sp-6);
    border-radius: var(--r-sm);
    background: var(--surface);
  }

  .sort select {
    width: auto;
    max-width: 14rem;
    min-height: 44px;
    border-radius: var(--r-sm);
    text-overflow: ellipsis;
  }

  .select-toggle {
    margin-left: auto;
  }

  /* Chip rows scroll sideways; the right edge fades out so a clipped chip reads as "more". */
  .chip-line {
    margin-bottom: var(--sp-4);
  }

  .chips {
    display: flex;
    gap: var(--sp-2);
    margin: 0 calc(-1 * var(--pad));
    padding: 2px var(--pad);
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - var(--pad)), transparent);
    mask-image: linear-gradient(to right, #000 calc(100% - var(--pad)), transparent);
  }

  .chips::-webkit-scrollbar {
    display: none;
  }

  .active {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
    margin-bottom: var(--sp-4);
  }

  .active-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    min-height: 32px;
    padding: 0 var(--sp-3);
    border: 1px solid var(--accent-ring);
    border-radius: var(--r-pill);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: var(--fs-sm);
  }

  .clear {
    min-height: 32px;
    padding: 0 var(--sp-2);
    border: 0;
    background: transparent;
    color: var(--accent-text);
    font-size: var(--fs-sm);
    text-decoration: underline;
  }

  .bulk-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    margin: 0 0 var(--sp-5);
    padding: var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
  }

  .bulk-bar input[type="text"] {
    flex: 1 1 160px;
    min-width: 0;
  }

  .song-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: var(--sp-5) var(--sp-4);
  }

  .load-more {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-3);
    margin: var(--sp-5) 0 var(--sp-2);
  }

  .skeleton .cover {
    border-radius: var(--r-md);
    background: var(--surface-2);
  }

  .skeleton .cover::after {
    display: none;
  }

  .skeleton span {
    display: block;
    height: 12px;
    margin: var(--sp-3) 0 0;
    border-radius: var(--r-xs);
    background: var(--surface-2);
  }

  .skeleton span:last-child {
    width: 55%;
    margin-top: var(--sp-2);
  }

  @media (max-width: 767px) {
    .toolbar {
      flex-wrap: wrap;
    }

    .search {
      flex-basis: 100%;
      max-width: none;
    }

    .sort {
      flex: 1;
      min-width: 0;
    }

    .sort select {
      width: 100%;
      max-width: none;
    }

    .select-toggle {
      margin-left: 0;
    }

    /* Songs become a list of rows. */
    .song-grid {
      grid-template-columns: 1fr;
      gap: 0;
    }

    .skeleton {
      display: none;
    }
  }
</style>
