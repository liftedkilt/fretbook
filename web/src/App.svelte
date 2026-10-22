<script lang="ts">
  import EditorView from "./components/EditorView.svelte";
  import LibraryView from "./components/LibraryView.svelte";
  import SongView from "./components/SongView.svelte";
  import { t } from "./lib/i18n.svelte";
  import { followLink, hrefFor, routePath } from "./lib/router.svelte";

  const path = $derived(routePath());
  const edit = $derived(path.match(/^\/songs\/([^/]+)\/edit\/?$/));
  const play = $derived(path.match(/^\/songs\/([^/]+)\/?$/));
</script>

<header class="app-header">
  <a class="brand" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>
    <img src="favicon.svg" alt="" width="42" height="42" />
    <span>
      <h1>{t("app.title")}</h1>
      <p>{t("app.tagline")}</p>
    </span>
  </a>
</header>

<main>
  {#if path === "/"}
    <LibraryView />
  {:else if edit}
    <EditorView id={edit[1]} />
  {:else if play}
    <SongView id={play[1]} />
  {:else}
    <p>{t("app.notFound")}</p>
  {/if}
</main>
