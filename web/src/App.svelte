<script lang="ts">
  import AdminView from "./components/AdminView.svelte";
  import EditorView from "./components/EditorView.svelte";
  import LibraryView from "./components/LibraryView.svelte";
  import SongView from "./components/SongView.svelte";
  import { apiUrl, getMe } from "./lib/api";
  import { t } from "./lib/i18n.svelte";
  import { followLink, hrefFor, routePath } from "./lib/router.svelte";
  import type { Me } from "./lib/types";

  const path = $derived(routePath());
  const edit = $derived(path.match(/^\/songs\/([^/]+)\/edit\/?$/));
  const play = $derived(path.match(/^\/songs\/([^/]+)\/?$/));

  let me = $state<Me | null>(null);

  $effect(() => {
    getMe()
      .then((value) => {
        me = value;
      })
      .catch(() => {
        /* a 401 already redirects to sign-in */
      });
  });
</script>

<header class="app-header">
  <a class="brand" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>
    <img src="favicon.svg" alt="" width="42" height="42" />
    <span>
      <h1>{t("app.title")}</h1>
      <p>{t("app.tagline")}</p>
    </span>
  </a>
  {#if me?.authenticated}
    <div class="account">
      <span class="hint" title={me.email}>{me.display_name}</span>
      {#if me.role === "admin"}
        <a class="button" href={hrefFor("/admin")} onclick={(event) => followLink(event, "/admin")}>{t("account.admin")}</a>
      {/if}
      <form method="post" action={apiUrl("/auth/logout")}>
        <button type="submit">{t("account.signOut")}</button>
      </form>
    </div>
  {/if}
</header>

<main>
  {#if path === "/"}
    <LibraryView />
  {:else if path === "/admin" && me?.role === "admin"}
    <AdminView self={me.user_id} />
  {:else if edit}
    <EditorView id={edit[1]} />
  {:else if play}
    <SongView id={play[1]} />
  {:else if path === "/admin" && !me}
    <p>{t("app.loading")}</p>
  {:else}
    <p>{t("app.notFound")}</p>
  {/if}
</main>
