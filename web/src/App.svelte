<script lang="ts">
  import AddSheet from "./components/AddSheet.svelte";
  import AdminView from "./components/AdminView.svelte";
  import BandsView from "./components/BandsView.svelte";
  import CalibrationSheet from "./components/CalibrationSheet.svelte";
  import ChordLibraryView from "./components/ChordLibraryView.svelte";
  import EditorView from "./components/EditorView.svelte";
  import ExercisesView from "./components/ExercisesView.svelte";
  import Icon from "./components/Icon.svelte";
  import IconButton from "./components/ui/IconButton.svelte";
  import LessonsRoute from "./components/LessonsRoute.svelte";
  import LibraryView from "./components/LibraryView.svelte";
  import SideNav from "./components/shell/SideNav.svelte";
  import TabBar from "./components/shell/TabBar.svelte";
  import OfflineStatus from "./components/OfflineStatus.svelte";
  import PracticeView from "./components/PracticeView.svelte";
  import SetlistPlayView from "./components/SetlistPlayView.svelte";
  import SetlistsView from "./components/SetlistsView.svelte";
  import SetlistView from "./components/SetlistView.svelte";
  import SettingsView from "./components/SettingsView.svelte";
  import ShareView from "./components/ShareView.svelte";
  import SongView from "./components/SongView.svelte";
  import RhythmTrainerView from "./components/RhythmTrainerView.svelte";
  import StandaloneMetronomeView from "./components/StandaloneMetronomeView.svelte";
  import StandaloneTunerView from "./components/StandaloneTunerView.svelte";
  import ToolsView from "./components/ToolsView.svelte";
  import TrainerView from "./components/TrainerView.svelte";
  import TunerSheet from "./components/TunerSheet.svelte";
  import { isOfflineError } from "./lib/api";
  import { t } from "./lib/i18n.svelte";
  import { followLink, hrefFor, routePath } from "./lib/router.svelte";
  import { loadMeta, openSheet, openTuner, refreshSongs, ui } from "./lib/ui.svelte";

  const path = $derived(routePath());
  const shareMatch = $derived(path.match(/^\/share\/([^/]+)\/?$/));
  const shareToken = $derived(shareMatch ? decodeURIComponent(shareMatch[1]) : "");
  const edit = $derived(path.match(/^\/songs\/([^/]+)\/edit\/?$/));
  const play = $derived(path.match(/^\/songs\/([^/]+)\/?$/));
  const setlistPlay = $derived(path.match(/^\/setlists\/([^/]+)\/play(?:\/([^/]+))?\/?$/));
  const setlistPage = $derived(path.match(/^\/setlists\/([^/]+)\/?$/));
  const isSetlists = $derived(path === "/setlists" || path === "/setlists/");
  const isBands = $derived(path === "/bands" || path === "/bands/");
  const isLessons = $derived(path === "/lessons" || path.startsWith("/lessons/"));
  const isLessonsHome = $derived(path === "/lessons" || path === "/lessons/");
  const isPractice = $derived(path === "/practice" || path === "/practice/");
  const isTools = $derived(path === "/tools" || path === "/tools/");
  const isToolsTuner = $derived(path === "/tools/tuner" || path === "/tools/tuner/");
  const isToolsMetronome = $derived(path === "/tools/metronome" || path === "/tools/metronome/");
  const isToolsRhythm = $derived(path === "/tools/rhythm" || path === "/tools/rhythm/");
  const isToolsChords = $derived(path === "/tools/chords" || path === "/tools/chords/");
  const isToolsTrainer = $derived(path === "/tools/trainer" || path === "/tools/trainer/");
  const isToolsExercises = $derived(path === "/tools/exercises" || path === "/tools/exercises/");
  const isLibrary = $derived(path === "/");
  const isAdmin = $derived(ui.me?.role === "admin");
  const isSettings = $derived(path === "/settings" || path === "/settings/");

  $effect(() => {
    // A public share page must not call the signed-in API: a 401 would send the visitor to log in.
    if (shareToken) return;
    // Offline is not an error: the banner above says so, and what is saved on the device still opens.
    const show = (err: unknown) => {
      if (isOfflineError(err)) return;
      ui.error = err instanceof Error ? err.message : t("error.generic");
    };
    loadMeta().catch(show);
    refreshSongs().catch(show);
  });

  // Scroll to the top when the page changes, as a full navigation would.
  $effect(() => {
    void path;
    const id = location.hash.replace(/^#/, "");
    const target = id ? document.getElementById(id) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo({ top: 0 });
  });

  // The phone tab bar carries the + button, so the top bar only adds one where there is no tab bar.
  const hasTabbar = $derived(isLibrary || isTools || isSetlists || isPractice || isLessonsHome);
</script>

{#if shareToken}
  <ShareView token={shareToken} />
{:else}
  <div class="shell" class:shell-library={hasTabbar}>
    <SideNav />

    <header class="topbar">
      <a class="brand" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>
        <img src="favicon.svg" alt={t("app.title")} width="30" height="30" />
        <span class="wordmark" aria-hidden="true">Fret<em>book</em></span>
      </a>
      <div class="topbar-actions">
        <IconButton
          class="ghost"
          icon="tuningFork"
          label={t("tuner.heading")}
          testid="open-tuner-topbar"
          onclick={() => openTuner()}
        />
        <IconButton
          class="ghost"
          icon="settings"
          label={t("settings.heading")}
          testid="open-settings-topbar"
          onclick={() => openSheet("settings")}
        />
        {#if !ui.demoMode && !hasTabbar}
          <IconButton
            class="primary"
            icon="plus"
            label={t("add.button")}
            testid="add-song-topbar"
            onclick={() => openSheet("add")}
          />
        {/if}
      </div>
    </header>

    <main class="content">
      <OfflineStatus />
      {#if ui.demoMode}<p class="notice" role="status" data-testid="demo-banner">
          <Icon name="info" size={18} />{t("demo.banner")}
        </p>{/if}
      {#if ui.error}<p class="alert" role="alert"><Icon name="alert" size={18} />{ui.error}</p>{/if}
      {#if isLibrary}
        <LibraryView />
      {:else if isTools}
        <ToolsView />
      {:else if isToolsTuner}
        <StandaloneTunerView />
      {:else if isToolsMetronome}
        <StandaloneMetronomeView />
      {:else if isToolsTrainer}
        <TrainerView />
      {:else if isToolsRhythm}
        <RhythmTrainerView />
      {:else if isToolsChords}
        <ChordLibraryView />
      {:else if isToolsExercises}
        <ExercisesView />
      {:else if isSettings}
        <SettingsView />
      {:else if path === "/admin" && isAdmin && ui.me}
        <AdminView self={ui.me.user_id} />
      {:else if path === "/admin" && !ui.me}
        <p class="muted">{t("app.loading")}</p>
      {:else if isPractice}
        <PracticeView />
      {:else if isLessons}
        <LessonsRoute {path} />
      {:else if isSetlists}
        <SetlistsView />
      {:else if isBands}
        <BandsView />
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

    {#if hasTabbar}
      <TabBar />
    {/if}
  </div>

  <AddSheet />
  <TunerSheet />
  <CalibrationSheet />
{/if}
