<script lang="ts">
  import Cover from "../Cover.svelte";
  import Icon from "../Icon.svelte";
  import { t } from "../../lib/i18n.svelte";
  import { followLink, hrefFor, routePath } from "../../lib/router.svelte";
  import { openSheet, ui } from "../../lib/ui.svelte";

  const path = $derived(routePath());
  const isAdmin = $derived(ui.me?.role === "admin");
  const activeSong = $derived(path.match(/^\/songs\/([^/]+)/)?.[1] ?? "");

  // The same five destinations as the tab bar, in the same order.
  const destinations = $derived([
    {
      id: "practice",
      icon: "target",
      label: t("practiceLog.nav"),
      path: "/practice",
      current: path === "/practice" || path === "/practice/",
    },
    {
      id: "library",
      icon: "library",
      label: t("library.heading"),
      path: "/",
      current: path === "/" || path.startsWith("/songs/"),
    },
    {
      id: "lessons",
      icon: "graduation",
      label: t("lessons.nav"),
      path: "/lessons",
      current: path === "/lessons" || path.startsWith("/lessons/"),
    },
    {
      id: "setlists",
      icon: "listMusic",
      label: t("setlists.nav"),
      path: "/setlists",
      current: path.startsWith("/setlists"),
    },
    {
      id: "tools",
      icon: "wrench",
      label: t("tools.nav"),
      path: "/tools",
      current: path.startsWith("/tools"),
    },
  ]);

  const favourites = $derived(ui.favourites.slice(0, 5));
</script>

<aside class="sidebar">
  <a class="brand" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>
    <img src="favicon.svg" alt={t("app.title")} width="36" height="36" />
    <span class="brand-text">
      <span class="wordmark" aria-hidden="true">Fret<em>book</em></span>
      <small>{t("app.edition")}</small>
    </span>
  </a>

  {#if !ui.demoMode}
    <button
      class="primary new-button"
      data-testid="add-song"
      data-tip={t("add.button")}
      onclick={() => openSheet("add")}
      aria-label={t("add.button")}
    >
      <Icon name="plus" /><span class="label">{t("add.button")}</span>
    </button>
  {/if}

  <nav class="group" aria-label={t("nav.main")}>
    {#each destinations as item (item.id)}
      <a
        class="side-link"
        data-testid={`nav-${item.id}`}
        data-tip={item.label}
        href={hrefFor(item.path)}
        aria-label={item.label}
        aria-current={item.current ? "page" : undefined}
        onclick={(event) => followLink(event, item.path)}
      >
        <Icon name={item.icon} size={19} /><span class="label">{item.label}</span>
      </a>
    {/each}
  </nav>

  {#if favourites.length}
    <nav class="group favourites" aria-label={t("tags.favourites")} data-testid="side-favourites">
      <p class="side-label">{t("tags.favourites")}</p>
      {#each favourites as song (song.id)}
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

  <div class="group bottom">
    <a
      class="side-link"
      data-testid="nav-bands"
      data-tip={t("bands.nav")}
      href={hrefFor("/bands")}
      aria-label={t("bands.nav")}
      aria-current={path === "/bands" || path === "/bands/" ? "page" : undefined}
      onclick={(event) => followLink(event, "/bands")}
    >
      <Icon name="users" size={19} /><span class="label">{t("bands.nav")}</span>
    </a>
    {#if isAdmin}
      <a
        class="side-link"
        data-testid="nav-admin"
        data-tip={t("account.admin")}
        href={hrefFor("/admin")}
        aria-label={t("account.admin")}
        aria-current={path === "/admin" ? "page" : undefined}
        onclick={(event) => followLink(event, "/admin")}
      >
        <Icon name="lock" size={19} /><span class="label">{t("account.admin")}</span>
      </a>
    {/if}
    <a
      class="side-link"
      data-testid="open-settings"
      data-tip={t("settings.heading")}
      href={hrefFor("/settings")}
      aria-label={t("settings.heading")}
      aria-current={path === "/settings" || path === "/settings/" ? "page" : undefined}
      onclick={(event) => followLink(event, "/settings")}
    >
      <Icon name="settings" size={19} /><span class="label">{t("settings.heading")}</span>
    </a>
  </div>
</aside>

<style>
  .group {
    display: grid;
    gap: var(--sp-1);
  }

  .favourites {
    padding-top: var(--sp-4);
    border-top: 1px solid var(--line);
  }

  .bottom {
    margin-top: auto;
  }

  .new-button {
    width: 100%;
    min-height: 44px;
  }

  .side-label {
    margin: 0 0 var(--sp-1);
    padding: 0 var(--sp-3);
    font-size: var(--fs-xs);
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-3);
  }

  .side-link {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--sp-3);
    width: 100%;
    min-height: 40px;
    padding: 0 var(--sp-3);
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-2);
    font-weight: 550;
    text-decoration: none;
  }

  .side-link:hover:not(:disabled) {
    background: var(--surface);
    color: var(--text);
  }

  .side-link[aria-current="page"] {
    background: var(--surface-2);
    color: var(--text);
  }

  .side-link[aria-current="page"] :global(.icon) {
    color: var(--accent);
  }

  .recent-link {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-1) var(--sp-2);
    border-radius: var(--r-sm);
    color: inherit;
    text-decoration: none;
    transition: background 0.15s var(--ease);
  }

  .recent-link:hover,
  .recent-link[aria-current="page"] {
    background: var(--surface);
  }

  .recent-link > span:last-child {
    display: grid;
    min-width: 0;
    line-height: 1.25;
  }

  .recent-link strong,
  .recent-link small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-link strong {
    font-size: 0.86rem;
    font-weight: 600;
  }

  .recent-link small {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }

  /* Tablet: an icon rail. The label becomes a tooltip on hover and keyboard focus. */
  @media (max-width: 1099px) {
    .label,
    .favourites,
    .brand-text {
      display: none;
    }

    .group {
      justify-items: center;
      width: 100%;
    }

    .new-button {
      width: 48px;
      min-height: 48px;
      padding: 0;
      border-radius: var(--r-md);
    }

    .side-link {
      justify-content: center;
      position: relative;
      width: 52px;
      min-height: 48px;
      padding: 0;
    }

    .side-link::after,
    .new-button::after {
      content: attr(data-tip);
      position: absolute;
      left: calc(100% + var(--sp-2));
      top: 50%;
      z-index: 70;
      padding: var(--sp-1) var(--sp-2);
      border: 1px solid var(--line-strong);
      border-radius: var(--r-sm);
      background: var(--surface);
      box-shadow: var(--shadow-md);
      color: var(--text);
      font-size: var(--fs-xs);
      font-weight: 600;
      line-height: 1.4;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transform: translateY(-50%);
    }

    .side-link:hover::after,
    .side-link:focus-visible::after,
    .new-button:hover::after,
    .new-button:focus-visible::after {
      opacity: 1;
    }

    .new-button {
      position: relative;
    }
  }
</style>
