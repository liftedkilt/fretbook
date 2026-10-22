<script lang="ts">
  import AddSheet from "./components/AddSheet.svelte";
  import Cover from "./components/Cover.svelte";
  import EditorView from "./components/EditorView.svelte";
  import Icon from "./components/Icon.svelte";
  import LibraryView from "./components/LibraryView.svelte";
  import SettingsSheet from "./components/SettingsSheet.svelte";
  import SongView from "./components/SongView.svelte";
  import { t } from "./lib/i18n.svelte";
  import { followLink, hrefFor, navigate, routePath } from "./lib/router.svelte";
  import { countFor, loadMeta, openSheet, refreshSongs, ui, type LibraryFilter } from "./lib/ui.svelte";

  const path = $derived(routePath());
  const edit = $derived(path.match(/^\/songs\/([^/]+)\/edit\/?$/));
  const play = $derived(path.match(/^\/songs\/([^/]+)\/?$/));
  const isLibrary = $derived(path === "/");

  const sections: { id: LibraryFilter; icon: string; key: string }[] = [
    { id: "all", icon: "library", key: "library.filterAll" },
    { id: "bass", icon: "bass", key: "library.filterBass" },
    { id: "electric", icon: "guitar", key: "library.filterElectric" },
    { id: "acoustic", icon: "acoustic", key: "library.filterAcoustic" },
    { id: "chords", icon: "chords", key: "library.filterChords" },
  ];

  const recent = $derived([...ui.songs].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 5));
  const activeSong = $derived(edit?.[1] ?? play?.[1] ?? "");

  $effect(() => {
    loadMeta().catch((err: unknown) => {
      ui.error = err instanceof Error ? err.message : t("error.generic");
    });
    refreshSongs().catch((err: unknown) => {
      ui.error = err instanceof Error ? err.message : t("error.generic");
    });
  });

  // Scroll to the top when the page changes, as a full navigation would.
  $effect(() => {
    void path;
    window.scrollTo({ top: 0 });
  });

  function pickSection(id: LibraryFilter) {
    ui.filter = id;
    if (!isLibrary) navigate("/");
  }
</script>

<div class="shell" class:shell-library={isLibrary}>
  <aside class="sidebar">
    <a class="brand" href={hrefFor("/")} onclick={(event) => followLink(event, "/")} aria-label={t("app.title")}>
      <img src="favicon.svg" alt="" width="36" height="36" />
      <span class="brand-text">
        <span class="wordmark">Fret<em>book</em></span>
        <small>{t("app.edition")}</small>
      </span>
    </a>

    <button class="primary new-button" onclick={() => openSheet("add")}>
      <Icon name="plus" /><span class="rail-hide">{t("add.button")}</span>
    </button>

    <nav class="side-nav" aria-label={t("library.filters")}>
      <p class="side-label rail-hide">{t("library.heading")}</p>
      {#each sections as item (item.id)}
        <button
          class="side-link"
          aria-current={isLibrary && ui.filter === item.id ? "page" : undefined}
          onclick={() => pickSection(item.id)}
          title={t(item.key)}
        >
          <Icon name={item.icon} size={19} />
          <span class="rail-hide">{t(item.key)}</span>
          <span class="side-count rail-hide">{countFor(item.id)}</span>
        </button>
      {/each}
    </nav>

    {#if recent.length}
      <nav class="side-recent rail-hide" aria-label={t("nav.recent")}>
        <p class="side-label">{t("nav.recent")}</p>
        {#each recent as song (song.id)}
          <a
            class="recent-link"
            aria-current={activeSong === song.id ? "page" : undefined}
            href={hrefFor(`/songs/${song.id}`)}
            onclick={(event) => followLink(event, `/songs/${song.id}`)}
          >
            <Cover id={song.id} title={song.title} kind={song.content_kind} strings={song.string_count} size="sm" />
            <span>
              <strong>{song.title}</strong>
              <small>{song.artist || "—"}</small>
            </span>
          </a>
        {/each}
      </nav>
    {/if}

    <button class="side-link side-settings" onclick={() => openSheet("settings")} title={t("settings.heading")}>
      <Icon name="settings" size={19} /><span class="rail-hide">{t("settings.heading")}</span>
    </button>
  </aside>

  <header class="topbar">
    <a class="brand" href={hrefFor("/")} onclick={(event) => followLink(event, "/")} aria-label={t("app.title")}>
      <img src="favicon.svg" alt="" width="30" height="30" />
      <span class="wordmark">Fret<em>book</em></span>
    </a>
    <div class="topbar-actions">
      <button class="icon-button ghost" onclick={() => openSheet("settings")} aria-label={t("settings.heading")}>
        <Icon name="settings" />
      </button>
      <button class="icon-button primary" onclick={() => openSheet("add")} aria-label={t("add.button")}>
        <Icon name="plus" />
      </button>
    </div>
  </header>

  <main class="content">
    {#if ui.error}<p class="alert" role="alert"><Icon name="alert" size={18} />{ui.error}</p>{/if}
    {#if isLibrary}
      <LibraryView />
    {:else if edit}
      <EditorView id={edit[1]} />
    {:else if play}
      <SongView id={play[1]} />
    {:else}
      <div class="empty-state">
        <span class="empty-art"><Icon name="library" size={34} /></span>
        <h1 class="display">{t("app.notFound")}</h1>
        <a class="button" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>{t("app.back")}</a>
      </div>
    {/if}
  </main>

  {#if isLibrary}
    <nav class="tabbar" aria-label={t("nav.main")}>
      <button class="tab-item" aria-current="page" onclick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
        <Icon name="library" /><span>{t("library.heading")}</span>
      </button>
      <button class="tab-item tab-add" onclick={() => openSheet("add")} aria-label={t("add.button")}>
        <span><Icon name="plus" size={26} /></span>
      </button>
      <button class="tab-item" onclick={() => openSheet("settings")}>
        <Icon name="settings" /><span>{t("settings.heading")}</span>
      </button>
    </nav>
  {/if}
</div>

<AddSheet />
<SettingsSheet />
