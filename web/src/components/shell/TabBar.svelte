<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../../lib/i18n.svelte";
  import { followLink, hrefFor, routePath } from "../../lib/router.svelte";
  import { openSheet, ui } from "../../lib/ui.svelte";

  const path = $derived(routePath());

  // Practice · Library · (+) · Lessons · Tools. Setlists sits under Library on a phone.
  const current = $derived({
    practice: path === "/practice" || path === "/practice/",
    library: path === "/" || path.startsWith("/setlists") || path.startsWith("/songs/"),
    lessons: path === "/lessons" || path.startsWith("/lessons/"),
    tools: path.startsWith("/tools"),
  });
</script>

{#snippet tab(id: string, icon: string, label: string, to: string, active: boolean)}
  <a
    class="tab-item"
    data-testid={`tab-${id}`}
    href={hrefFor(to)}
    aria-current={active ? "page" : undefined}
    onclick={(event) => followLink(event, to)}
  >
    <Icon name={icon} /><span>{label}</span>
  </a>
{/snippet}

<nav class="tabbar" class:no-add={ui.demoMode} aria-label={t("nav.main")}>
  {@render tab("practice", "target", t("practiceLog.nav"), "/practice", current.practice)}
  {@render tab("library", "library", t("library.heading"), "/", current.library)}
  {#if !ui.demoMode}
    <button
      class="tab-add"
      data-testid="tab-add"
      onclick={() => openSheet("add")}
      aria-label={t("add.button")}
    >
      <span><Icon name="plus" size={26} /></span>
    </button>
  {/if}
  {@render tab("lessons", "graduation", t("lessons.nav"), "/lessons", current.lessons)}
  {@render tab("tools", "wrench", t("tools.nav"), "/tools", current.tools)}
</nav>

<style>
  .tabbar {
    display: none;
  }

  @media (max-width: 767px) {
    .tabbar {
      position: fixed;
      left: var(--sp-3);
      right: var(--sp-3);
      bottom: calc(10px + var(--safe-b));
      z-index: 30;
      display: grid;
      /* Equal outer columns keep the + exactly on the centre line. */
      grid-template-columns: 1fr 1fr 64px 1fr 1fr;
      align-items: center;
      height: 64px;
      padding: 0 var(--sp-2);
      border-radius: var(--r-lg);
      background: var(--glass);
      border: 1px solid var(--glass-line);
      box-shadow: var(--shadow-lg);
      backdrop-filter: blur(24px) saturate(1.7);
      -webkit-backdrop-filter: blur(24px) saturate(1.7);
    }

    .tabbar.no-add {
      grid-template-columns: repeat(4, 1fr);
    }

    .tab-item,
    .tab-add {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      height: 100%;
      min-height: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--text-3);
      font-size: 0.68rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
    }

    .tab-item:hover {
      color: var(--text);
    }

    .tab-item[aria-current="page"] {
      color: var(--accent-text);
    }

    .tab-add span {
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      margin-top: -26px;
      border-radius: 50%;
      background: var(--grad);
      color: #fff;
      box-shadow:
        var(--glow),
        0 0 0 5px var(--bg);
    }
  }
</style>
