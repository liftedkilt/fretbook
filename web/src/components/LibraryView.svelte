<script lang="ts">
  import Cover from "./Cover.svelte";
  import Icon from "./Icon.svelte";
  import { deleteSong } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { instrumentLabel } from "../lib/instruments";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { SongSummary } from "../lib/types";
  import { countFor, matchesFilter, openSheet, refreshSongs, ui, type LibraryFilter } from "../lib/ui.svelte";

  type Sort = "recent" | "title" | "artist";

  let error = $state("");
  let sort = $state<Sort>("recent");

  const filters: { id: LibraryFilter; key: string }[] = [
    { id: "all", key: "library.filterAll" },
    { id: "bass", key: "library.filterBass" },
    { id: "electric", key: "library.filterElectric" },
    { id: "acoustic", key: "library.filterAcoustic" },
    { id: "chords", key: "library.filterChords" },
  ];

  const visible = $derived.by(() => {
    const query = ui.search.trim().toLocaleLowerCase();
    const list = ui.songs.filter(
      (song) =>
        matchesFilter(song, ui.filter) &&
        (!query || song.title.toLocaleLowerCase().includes(query) || song.artist.toLocaleLowerCase().includes(query)),
    );
    if (sort === "title") return [...list].sort((a, b) => a.title.localeCompare(b.title));
    if (sort === "artist") return [...list].sort((a, b) => (a.artist || "~").localeCompare(b.artist || "~") || a.title.localeCompare(b.title));
    return [...list].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  });

  const heading = $derived(t(filters.find((item) => item.id === ui.filter)?.key ?? "library.filterAll"));

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
    return song.content_kind === "chords" ? t("library.chordSheet") : instrumentLabel(song.preferred_instrument);
  }
</script>

<section class="library">
  <header class="page-hero">
    <div>
      <p class="eyebrow">{t("library.heading")}</p>
      <h1 class="display hero-title">{ui.filter === "all" ? t("library.welcome") : heading}</h1>
      <p class="muted" data-testid="library-count">{t("library.count", { count: countFor(ui.filter) })}</p>
    </div>
    <button class="primary hero-add" data-testid="add-song-hero" onclick={() => openSheet("add")}><Icon name="plus" />{t("add.button")}</button>
  </header>

  {#if ui.songs.length > 0}
    <div class="toolbar">
      <label class="search">
        <Icon name="search" size={18} />
        <input type="search" data-testid="library-search" bind:value={ui.search} placeholder={t("library.search")} aria-label={t("library.search")} />
      </label>
      <label class="sort">
        <span class="visually-hidden">{t("library.sort")}</span>
        <select bind:value={sort} aria-label={t("library.sort")}>
          <option value="recent">{t("library.sortRecent")}</option>
          <option value="title">{t("library.sortTitle")}</option>
          <option value="artist">{t("library.sortArtist")}</option>
        </select>
      </label>
    </div>

    <div class="chips" role="group" aria-label={t("library.filters")}>
      {#each filters as item (item.id)}
        <button class="chip" data-testid={`library-filter-${item.id}`} aria-pressed={ui.filter === item.id} onclick={() => (ui.filter = item.id)}>
          {t(item.key)}<span class="chip-count">{countFor(item.id)}</span>
        </button>
      {/each}
    </div>
  {/if}

  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

  {#if !ui.loaded}
    <div class="song-grid" aria-busy="true">
      {#each [0, 1, 2, 3, 4, 5] as index (index)}
        <div class="song-card skeleton"><div class="cover cover-md"></div><span></span><span></span></div>
      {/each}
    </div>
  {:else if ui.songs.length === 0}
    <div class="empty-state" data-testid="library-empty">
      <span class="empty-art"><Icon name="sparkle" size={34} /></span>
      <h2 class="display">{t("library.emptyTitle")}</h2>
      <p class="muted">{t("library.empty")}</p>
      <div class="empty-actions">
        <button class="primary" onclick={() => openSheet("add")}><Icon name="plus" />{t("add.button")}</button>
      </div>
    </div>
  {:else if visible.length === 0}
    <div class="empty-state compact" data-testid="library-filter-empty">
      <span class="empty-art"><Icon name="search" size={30} /></span>
      <p class="muted">{t("library.filterEmpty")}</p>
    </div>
  {:else}
    <div class="song-grid">
      {#each visible as song (song.id)}
        <article class="song-card" data-testid="song-card">
          <a class="song-link" data-testid="song-link" href={hrefFor(`/songs/${song.id}`)} onclick={(event) => followLink(event, `/songs/${song.id}`)}>
            <span class="song-art">
              <Cover id={song.id} title={song.title} kind={song.content_kind} strings={song.string_count} />
              <span class="song-kind">
                <Icon name={song.content_kind === "chords" ? "chords" : "tab"} size={14} />{kindLabel(song)}
              </span>
              {#if song.has_audio}
                <span class="song-audio" title={t("library.audio")}><Icon name="waveform" size={14} /></span>
              {/if}
              <span class="song-play" aria-hidden="true"><Icon name="play" size={20} /></span>
            </span>
            <span class="song-text">
              <strong class="song-title" data-testid="song-title">{song.title}</strong>
              <span class="song-artist">{song.artist || "—"}</span>
              {#if song.content_kind === "tab"}
                <span class="song-meta">
                  {t("library.strings", { count: song.string_count })} · {t("library.measures", { count: song.measure_count })} · {t("library.tempo", { bpm: song.bpm })}
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
            <button class="icon-button glass" data-testid="song-delete" onclick={() => void remove(song)} aria-label={`${t("library.delete")}: ${song.title}`} title={t("library.delete")}>
              <Icon name="trash" size={16} />
            </button>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</section>
