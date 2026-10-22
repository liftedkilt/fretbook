<script lang="ts">
  import EditorView from "./components/EditorView.svelte";
  import LibraryView from "./components/LibraryView.svelte";
  import SongView from "./components/SongView.svelte";
  import { currentLocale, locales, setLocale, t } from "./lib/i18n.svelte";
  import { followLink, hrefFor, routePath } from "./lib/router.svelte";

  const path = $derived(routePath());
  const edit = $derived(path.match(/^\/songs\/([^/]+)\/edit\/?$/));
  const play = $derived(path.match(/^\/songs\/([^/]+)\/?$/));

  let header: HTMLElement;

  // Sticky elements below the header (e.g. the editor bar nav) offset by its height, which changes when it wraps.
  $effect(() => {
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty("--app-header-height", `${header.offsetHeight}px`);
    });
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--app-header-height");
    };
  });
</script>

<header class="app-header" bind:this={header}>
  <div class="header-inner">
    <a class="brand" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>
      <img src="favicon.svg" alt="" width="40" height="40" />
      <span class="brand-text">
        <span class="brand-title-row">
          <h1>{t("app.title")}</h1>
          <span class="brand-pill">{t("app.edition")}</span>
        </span>
        <p>{t("app.tagline")}</p>
      </span>
    </a>
    <nav class="actions">
      <label class="locale-switch">
        <span>{t("language.label")}</span>
        <select
          aria-label={t("language.label")}
          value={currentLocale()}
          onchange={(event) => setLocale(event.currentTarget.value)}
        >
          {#each locales as item (item.id)}
            <option value={item.id}>{t(item.labelKey)}</option>
          {/each}
        </select>
      </label>
    </nav>
  </div>
</header>

<main>
  {#if path === "/"}
    <LibraryView />
  {:else if edit}
    <EditorView id={edit[1]} />
  {:else if play}
    <SongView id={play[1]} />
  {:else}
    <div class="panel">
      <p style="margin:0">{t("app.notFound")}</p>
    </div>
  {/if}
</main>
