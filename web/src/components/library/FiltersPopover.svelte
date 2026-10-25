<script lang="ts">
  import { tick } from "svelte";

  import Icon from "../Icon.svelte";
  import Chip from "../ui/Chip.svelte";
  import { t } from "../../lib/i18n.svelte";
  import { keyLabel } from "../../lib/keys";
  import { toggleTagFilter, ui } from "../../lib/ui.svelte";
  import type { LibraryLevel } from "../../lib/types";

  let {
    count,
    onmanagetags,
  }: {
    /** How many filters inside the popover are on. */
    count: number;
    onmanagetags?: () => void;
  } = $props();

  const levels: { id: LibraryLevel; key: string }[] = [
    { id: "all", key: "difficulty.levelAll" },
    { id: "easy", key: "difficulty.levelEasy" },
    { id: "medium", key: "difficulty.levelMedium" },
    { id: "hard", key: "difficulty.levelHard" },
  ];

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  let panel = $state<HTMLDivElement | null>(null);
  let button = $state<HTMLButtonElement | null>(null);
  const panelId = `library-filters-${Math.random().toString(36).slice(2, 8)}`;

  async function toggle() {
    open = !open;
    if (!open) return;
    await tick();
    panel?.querySelector<HTMLElement>("button, select, input")?.focus();
  }

  function close(restore: boolean) {
    open = false;
    if (restore) button?.focus();
  }

  $effect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) close(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  });

  function tagOn(tag: string): boolean {
    return ui.tags.some((item) => item.toLowerCase() === tag.toLowerCase());
  }
</script>

<div class="filters" bind:this={root}>
  <button
    type="button"
    class="trigger"
    class:active={count > 0}
    data-testid="library-filters"
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={open ? panelId : undefined}
    bind:this={button}
    onclick={() => void toggle()}
  >
    <Icon name="filter" size={16} />
    {t("libraryToolbar.filters")}
    {#if count > 0}<span class="badge" data-testid="library-filters-count">{count}</span>{/if}
  </button>
  {#if open}
    <div
      class="panel"
      id={panelId}
      role="dialog"
      aria-label={t("libraryToolbar.filters")}
      bind:this={panel}
    >
      <div class="group" role="group" aria-label={t("difficulty.filters")}>
        <span class="heading">{t("libraryToolbar.level")}</span>
        <div class="chip-row">
          {#each levels as item (item.id)}
            <Chip
              variant="filter"
              label={t(item.key)}
              testid={`library-level-${item.id}`}
              pressed={ui.level === item.id}
              onclick={() => (ui.level = item.id)}
            />
          {/each}
        </div>
      </div>

      {#if ui.facets.keys.length || ui.facets.genres.length}
        <div class="selects" role="group" aria-label={t("metadata.filters")}>
          {#if ui.facets.keys.length}
            <label class="facet">
              <span class="heading">{t("metadata.filterKey")}</span>
              <select data-testid="library-key-filter" bind:value={ui.keyFilter}>
                <option value="">{t("metadata.filterAny")}</option>
                {#each ui.facets.keys as item (item.name)}
                  <option value={item.name}>{keyLabel(item.name, t)} ({item.count})</option>
                {/each}
              </select>
            </label>
          {/if}
          {#if ui.facets.genres.length}
            <label class="facet">
              <span class="heading">{t("metadata.filterGenre")}</span>
              <select data-testid="library-genre-filter" bind:value={ui.genreFilter}>
                <option value="">{t("metadata.filterAny")}</option>
                {#each ui.facets.genres as item (item.name)}
                  <option value={item.name}>{item.name} ({item.count})</option>
                {/each}
              </select>
            </label>
          {/if}
        </div>
      {/if}

      {#if ui.tagList.length}
        <div class="group" role="group" aria-label={t("tags.filters")}>
          <span class="heading">{t("libraryToolbar.tags")}</span>
          <div class="chip-row">
            {#each ui.tagList as item (item.tag)}
              <Chip
                variant="tag"
                label={item.tag}
                count={item.count}
                testid="library-tag"
                pressed={tagOn(item.tag)}
                onclick={() => toggleTagFilter(item.tag)}
              />
            {/each}
          </div>
          {#if onmanagetags}
            <button
              type="button"
              class="button ghost manage"
              data-testid="library-manage-tags"
              onclick={() => {
                close(false);
                onmanagetags();
              }}
            >
              {t("manageTags.open")}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .filters {
    position: relative;
    flex: none;
  }

  .trigger {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    min-height: 44px;
    padding: 0 var(--sp-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-sm);
    background: var(--surface);
    color: var(--text);
    font-size: var(--fs-sm);
  }

  .trigger:hover {
    background: var(--surface-2);
  }

  .trigger.active {
    border-color: var(--accent-ring);
  }

  .badge {
    min-width: 20px;
    padding: 0 var(--sp-1);
    border-radius: var(--r-pill);
    background: var(--accent-soft);
    color: var(--accent-text);
    font-size: var(--fs-xs);
    line-height: 20px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  .panel {
    position: absolute;
    top: calc(100% + var(--sp-2));
    right: 0;
    z-index: 40;
    display: grid;
    gap: var(--sp-4);
    width: min(420px, calc(100vw - 2 * var(--pad)));
    max-height: min(70vh, 520px);
    padding: var(--sp-4);
    overflow-y: auto;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  .group,
  .facet {
    display: grid;
    gap: var(--sp-2);
  }

  .selects {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--sp-3);
  }

  .heading {
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
  }

  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }

  .manage {
    justify-self: start;
  }

  /* Phones: the popover spans the toolbar, not the button. */
  @media (max-width: 767px) {
    .filters {
      position: static;
    }

    .panel {
      left: 0;
      right: 0;
      width: auto;
    }
  }
</style>
