<script lang="ts">
  import Cover from "../Cover.svelte";
  import Icon from "../Icon.svelte";
  import Sheet from "../Sheet.svelte";
  import { listSongs } from "../../lib/api";
  import { coverSrc } from "../../lib/cover";
  import { t } from "../../lib/i18n.svelte";
  import type { SongSummary } from "../../lib/types";

  let {
    open,
    added,
    onadd,
    onclose,
  }: {
    open: boolean;
    /** Ids of songs already in the setlist; they show a check and cannot be picked again. */
    added: ReadonlySet<string>;
    onadd: (songs: SongSummary[]) => void;
    onclose: () => void;
  } = $props();

  let query = $state("");
  let results = $state<SongSummary[]>([]);
  let searched = $state(false);
  let failed = $state(false);
  let picked = $state<SongSummary[]>([]);

  // Start fresh each time the sheet opens.
  $effect(() => {
    if (open) {
      query = "";
      picked = [];
    }
  });

  // With no search text the most recently opened songs come first.
  $effect(() => {
    if (!open) return;
    const text = query.trim();
    let cancel = false;
    const timer = setTimeout(
      () => {
        listSongs({
          q: text,
          limit: 50,
          sort: text ? undefined : "opened",
          order: text ? undefined : "desc",
        })
          .then((page) => {
            if (cancel) return;
            results = page.items;
            searched = true;
            failed = false;
          })
          .catch(() => {
            if (!cancel) failed = true;
          });
      },
      text ? 200 : 0,
    );
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  });

  const isPicked = (song: SongSummary) => picked.some((item) => item.id === song.id);

  function toggle(song: SongSummary) {
    if (added.has(song.id)) return;
    picked = isPicked(song) ? picked.filter((item) => item.id !== song.id) : [...picked, song];
  }

  function confirm() {
    if (picked.length === 0) return;
    onadd(picked);
    picked = [];
    onclose();
  }
</script>

<Sheet {open} title={t("setlists.pickerTitle")} testid="setlist-song-picker" {onclose}>
  <label class="search">
    <Icon name="search" size={18} />
    <input
      type="search"
      data-testid="setlist-add-search"
      bind:value={query}
      placeholder={t("setlists.addSearch")}
      aria-label={t("setlists.addSearch")}
    />
  </label>
  {#if failed}
    <p class="alert" role="alert"><Icon name="alert" size={18} />{t("error.generic")}</p>
  {:else if searched && results.length === 0}
    <p class="muted">{t("setlists.addEmpty")}</p>
  {:else}
    {#if !query.trim() && results.length > 0}
      <p class="eyebrow">{t("setlists.pickerRecent")}</p>
    {/if}
    <ul class="results">
      {#each results as song (song.id)}
        {@const done = added.has(song.id)}
        {@const on = done || isPicked(song)}
        <li>
          <button
            type="button"
            class="result"
            class:on
            data-testid="setlist-result"
            aria-pressed={on}
            aria-disabled={done}
            onclick={() => toggle(song)}
          >
            <Cover
              id={song.id}
              title={song.title}
              kind={song.content_kind}
              strings={song.string_count}
              size="sm"
              src={coverSrc(song.cover_url)}
            />
            <span class="result-text">
              <strong>{song.title}</strong>
              <span class="muted">{song.artist || "—"}</span>
              {#if done}<span class="visually-hidden">{t("setlists.pickerAlready")}</span>{/if}
            </span>
            <span class="check" aria-hidden="true">
              {#if on}<Icon name="check" size={18} />{/if}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="footer">
    <button
      class="primary"
      data-testid="setlist-picker-add"
      disabled={picked.length === 0}
      onclick={confirm}
    >
      {picked.length
        ? t("setlists.pickerAdd", { count: picked.length })
        : t("setlists.pickerAddNone")}
    </button>
  </div>
</Sheet>

<style>
  .search {
    position: relative;
    display: block;
  }
  .search :global(.icon) {
    position: absolute;
    left: var(--sp-3);
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-3);
    pointer-events: none;
  }
  .search input {
    width: 100%;
    padding-left: calc(var(--sp-3) + 18px + var(--sp-2));
  }
  .results {
    list-style: none;
    margin: var(--sp-3) 0;
    padding: 0;
    display: grid;
    gap: var(--sp-1);
    max-height: 50vh;
    overflow-y: auto;
  }
  .result {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    width: 100%;
    min-height: 48px;
    padding: var(--sp-2) var(--sp-3);
    text-align: left;
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
  }
  .result.on {
    border-color: var(--accent);
  }
  .result[aria-disabled="true"] {
    opacity: 0.6;
    cursor: default;
  }
  .result-text {
    flex: 1;
    display: grid;
    min-width: 0;
  }
  .result-text > * {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .check {
    width: 18px;
    color: var(--accent);
  }
  .footer {
    display: flex;
    justify-content: flex-end;
  }
</style>
