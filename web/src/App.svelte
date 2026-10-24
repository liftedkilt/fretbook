<script lang="ts">
  import AddSheet from "./components/AddSheet.svelte";
  import AdminView from "./components/AdminView.svelte";
  import CalibrationSheet from "./components/CalibrationSheet.svelte";
  import ChordLibraryView from "./components/ChordLibraryView.svelte";
  import Cover from "./components/Cover.svelte";
  import EditorView from "./components/EditorView.svelte";
  import Icon from "./components/Icon.svelte";
  import LibraryView from "./components/LibraryView.svelte";
  import SetlistPlayView from "./components/SetlistPlayView.svelte";
  import SetlistsView from "./components/SetlistsView.svelte";
  import SetlistView from "./components/SetlistView.svelte";
  import SettingsSheet from "./components/SettingsSheet.svelte";
  import SongView from "./components/SongView.svelte";
  import StandaloneMetronomeView from "./components/StandaloneMetronomeView.svelte";
  import StandaloneTunerView from "./components/StandaloneTunerView.svelte";
  import ToolsView from "./components/ToolsView.svelte";
  import TunerSheet from "./components/TunerSheet.svelte";
  import { t } from "./lib/i18n.svelte";
  import { followLink, hrefFor, navigate, routePath } from "./lib/router.svelte";
  import {
    countFor,
    loadMeta,
    openSheet,
    openTuner,
    refreshSongs,
    ui,
    type LibraryFilter,
  } from "./lib/ui.svelte";

  const path = $derived(routePath());
  const edit = $derived(path.match(/^\/songs\/([^/]+)\/edit\/?$/));
  const play = $derived(path.match(/^\/songs\/([^/]+)\/?$/));
  const setlistPlay = $derived(path.match(/^\/setlists\/([^/]+)\/play(?:\/([^/]+))?\/?$/));
  const setlistPage = $derived(path.match(/^\/setlists\/([^/]+)\/?$/));
  const isSetlists = $derived(path === "/setlists" || path === "/setlists/");
  const isTools = $derived(path === "/tools" || path === "/tools/");
  const isToolsTuner = $derived(path === "/tools/tuner" || path === "/tools/tuner/");
  const isToolsMetronome = $derived(path === "/tools/metronome" || path === "/tools/metronome/");
  const isToolsChords = $derived(path === "/tools/chords" || path === "/tools/chords/");
  const isToolsActive = $derived(path.startsWith("/tools"));
  const isLibrary = $derived(path === "/");
  const isAdmin = $derived(ui.me?.role === "admin");

  const sections: { id: LibraryFilter; icon: string; key: string }[] = [
    { id: "all", icon: "library", key: "library.filterAll" },
    { id: "bass", icon: "bass", key: "library.filterBass" },
    { id: "electric", icon: "guitar", key: "library.filterElectric" },
    { id: "acoustic", icon: "acoustic", key: "library.filterAcoustic" },
    { id: "chords", icon: "chords", key: "library.filterChords" },
  ];

  const recent = $derived(ui.recent);
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

<div class="shell" class:shell-library={isLibrary || isTools || isSetlists}>
  <aside class="sidebar">
    <a class="brand" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>
      <img src="favicon.svg" alt={t("app.title")} width="36" height="36" />
      <span class="brand-text">
        <span class="wordmark" aria-hidden="true">Fret<em>book</em></span>
        <small>{t("app.edition")}</small>
      </span>
    </a>

    <button
      class="primary new-button"
      data-testid="add-song"
      onclick={() => openSheet("add")}
      aria-label={t("add.button")}
      title={t("add.button")}
    >
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

    <a
      class="side-link"
      data-testid="nav-setlists"
      href={hrefFor("/setlists")}
      aria-current={path.startsWith("/setlists") ? "page" : undefined}
      onclick={(event) => followLink(event, "/setlists")}
      title={t("setlists.nav")}
    >
      <Icon name="list" size={19} /><span class="rail-hide">{t("setlists.nav")}</span>
    </a>

    <a
      class="side-link"
      data-testid="nav-tools"
      href={hrefFor("/tools")}
      aria-current={isToolsActive ? "page" : undefined}
      onclick={(event) => followLink(event, "/tools")}
      title={t("tools.nav")}
    >
      <Icon name="wrench" size={19} /><span class="rail-hide">{t("tools.nav")}</span>
    </a>

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
            <Cover
              id={song.id}
              title={song.title}
              kind={song.content_kind}
              strings={song.string_count}
              size="sm"
            />
            <span>
              <strong>{song.title}</strong>
              <small>{song.artist || "—"}</small>
            </span>
          </a>
        {/each}
      </nav>
    {/if}

    {#if ui.favourites.length}
      <nav
        class="side-recent rail-hide"
        aria-label={t("tags.favourites")}
        data-testid="side-favourites"
      >
        <p class="side-label">{t("tags.favourites")}</p>
        {#each ui.favourites as song (song.id)}
          <a
            class="recent-link"
            aria-current={activeSong === song.id ? "page" : undefined}
            href={hrefFor(`/songs/${song.id}`)}
            onclick={(event) => followLink(event, `/songs/${song.id}`)}
          >
            <Cover
              id={song.id}
              title={song.title}
              kind={song.content_kind}
              strings={song.string_count}
              size="sm"
            />
            <span>
              <strong>{song.title}</strong>
              <small>{song.artist || "—"}</small>
            </span>
          </a>
        {/each}
      </nav>
    {/if}

    {#if isAdmin}
      <a
        class="side-link side-users"
        href={hrefFor("/admin")}
        aria-current={path === "/admin" ? "page" : undefined}
        onclick={(event) => followLink(event, "/admin")}
        title={t("account.admin")}
      >
        <Icon name="users" size={19} /><span class="rail-hide">{t("account.admin")}</span>
      </a>
    {/if}

    <button
      class="side-link side-settings"
      data-testid="open-settings"
      onclick={() => openSheet("settings")}
      title={t("settings.heading")}
    >
      <Icon name="settings" size={19} /><span class="rail-hide">{t("settings.heading")}</span>
    </button>
  </aside>

  <header class="topbar">
    <a class="brand" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>
      <img src="favicon.svg" alt={t("app.title")} width="30" height="30" />
      <span class="wordmark" aria-hidden="true">Fret<em>book</em></span>
    </a>
    <div class="topbar-actions">
      <button
        class="icon-button ghost"
        data-testid="open-tuner-topbar"
        onclick={() => openTuner()}
        aria-label={t("tuner.heading")}
      >
        <Icon name="tuner" />
      </button>
      <button
        class="icon-button ghost"
        data-testid="open-settings-topbar"
        onclick={() => openSheet("settings")}
        aria-label={t("settings.heading")}
      >
        <Icon name="settings" />
      </button>
      <button
        class="icon-button primary"
        data-testid="add-song-topbar"
        onclick={() => openSheet("add")}
        aria-label={t("add.button")}
      >
        <Icon name="plus" />
      </button>
    </div>
  </header>

  <main class="content">
    {#if ui.error}<p class="alert" role="alert"><Icon name="alert" size={18} />{ui.error}</p>{/if}
    {#if isLibrary}
      <LibraryView />
    {:else if isTools}
      <ToolsView />
    {:else if isToolsTuner}
      <StandaloneTunerView />
    {:else if isToolsMetronome}
      <StandaloneMetronomeView />
    {:else if isToolsChords}
      <ChordLibraryView />
    {:else if path === "/admin" && isAdmin && ui.me}
      <AdminView self={ui.me.user_id} />
    {:else if path === "/admin" && !ui.me}
      <p class="muted">{t("app.loading")}</p>
    {:else if isSetlists}
      <SetlistsView />
    {:else if setlistPlay}
      <SetlistPlayView id={setlistPlay[1]} position={setlistPlay[2]} />
    {:else if setlistPage}
      <SetlistView id={setlistPage[1]} />
    {:else if edit}
      <EditorView id={edit[1]} />
    {:else if play}
      <SongView id={play[1]} />
    {:else}
      <div class="empty-state">
        <span class="empty-art"><Icon name="library" size={34} /></span>
        <h1 class="display">{t("app.notFound")}</h1>
        <a class="button" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}
          >{t("app.back")}</a
        >
      </div>
    {/if}
  </main>

  {#if isLibrary || isTools || isSetlists}
    <nav class="tabbar" aria-label={t("nav.main")}>
      <a
        class="tab-item"
        data-testid="tab-library"
        href={hrefFor("/")}
        aria-current={isLibrary ? "page" : undefined}
        onclick={(event) => followLink(event, "/")}
      >
        <Icon name="library" /><span>{t("library.heading")}</span>
      </a>
      <a
        class="tab-item"
        data-testid="tab-setlists"
        href={hrefFor("/setlists")}
        aria-current={path.startsWith("/setlists") ? "page" : undefined}
        onclick={(event) => followLink(event, "/setlists")}
      >
        <Icon name="list" /><span>{t("setlists.nav")}</span>
      </a>
      <button
        class="tab-item tab-add"
        onclick={() => openSheet("add")}
        aria-label={t("add.button")}
      >
        <span><Icon name="plus" size={26} /></span>
      </button>
      <a
        class="tab-item"
        data-testid="tab-tools"
        href={hrefFor("/tools")}
        aria-current={isToolsActive ? "page" : undefined}
        onclick={(event) => followLink(event, "/tools")}
      >
        <Icon name="wrench" /><span>{t("tools.heading")}</span>
      </a>
      <button class="tab-item" onclick={() => openSheet("settings")}>
        <Icon name="settings" /><span>{t("settings.heading")}</span>
      </button>
    </nav>
  {/if}
</div>

<AddSheet />
<SettingsSheet />
<TunerSheet />
<CalibrationSheet />
