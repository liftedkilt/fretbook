<script lang="ts">
  import Icon from "./Icon.svelte";
  import SongView from "./SongView.svelte";
  import { getSetlist } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor, navigate } from "../lib/router.svelte";
  import {
    neighbour,
    playIndex,
    playPath,
    setlistPath,
    stepForKey,
    transposeLabel,
  } from "../lib/setlists";
  import type { SetlistDetail } from "../lib/types";

  let { id, position }: { id: string; position?: string } = $props();

  let setlist = $state<SetlistDetail | null>(null);
  let error = $state("");

  $effect(() => {
    const setlistId = id;
    let cancel = false;
    setlist = null;
    error = "";
    getSetlist(setlistId)
      .then((loaded) => {
        if (!cancel) setlist = loaded;
      })
      .catch((err: unknown) => {
        if (!cancel) error = err instanceof Error ? err.message : t("error.generic");
      });
    return () => {
      cancel = true;
    };
  });

  const total = $derived(setlist?.entries.length ?? 0);
  const index = $derived(playIndex(position, total));
  const entry = $derived(setlist?.entries[index] ?? null);
  const previous = $derived(neighbour(index, total, -1));
  const next = $derived(neighbour(index, total, 1));

  function go(target: number | null) {
    if (target !== null) navigate(playPath(id, target));
  }

  function onKeydown(event: KeyboardEvent) {
    const step = stepForKey(event);
    if (!step) return;
    event.preventDefault();
    go(step > 0 ? next : previous);
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
{#if setlist && !entry}
  <div class="empty-state compact" data-testid="setlist-play-empty">
    <p class="muted">{t("setlists.playEmpty")}</p>
    <a
      class="button"
      href={hrefFor(setlistPath(id))}
      onclick={(event) => followLink(event, setlistPath(id))}>{t("setlists.back")}</a
    >
  </div>
{:else if setlist && entry}
  <nav class="play-bar no-print" aria-label={t("setlists.playNav")} data-testid="setlist-play-bar">
    <a
      class="back-link"
      href={hrefFor(setlistPath(id))}
      onclick={(event) => followLink(event, setlistPath(id))}
      ><Icon name="back" size={18} />{setlist.name}</a
    >
    <div class="play-steps">
      <button
        data-testid="setlist-prev"
        disabled={previous === null}
        onclick={() => go(previous)}
        aria-keyshortcuts="Alt+ArrowLeft"
      >
        <Icon name="prev" size={16} />{t("setlists.previous")}
      </button>
      <span class="play-position" data-testid="setlist-position" aria-live="polite">
        {t("setlists.position", { position: index + 1, total })}
      </span>
      {#if next !== null}
        <button
          class="primary"
          data-testid="setlist-next"
          onclick={() => go(next)}
          aria-keyshortcuts="Alt+ArrowRight"
        >
          {t("setlists.next")}<Icon name="next" size={16} />
        </button>
      {:else}
        <a
          class="button"
          data-testid="setlist-finish"
          href={hrefFor(setlistPath(id))}
          onclick={(event) => followLink(event, setlistPath(id))}>{t("setlists.finish")}</a
        >
      {/if}
    </div>
    {#if entry.note.trim() || (entry.transpose && entry.content_kind === "chords")}
      <p class="play-note" data-testid="setlist-play-note">
        {#if entry.note.trim()}<strong>{t("setlists.playNote")}:</strong> {entry.note}{/if}
        {#if entry.transpose && entry.content_kind === "chords"}
          <span class="muted"
            >{t("setlists.playTranspose", { semitones: transposeLabel(entry.transpose) })}</span
          >
        {/if}
      </p>
    {/if}
    <p class="muted hint">{t("setlists.keysHint")}</p>
  </nav>
  {#key `${index}:${entry.song_id}`}
    <SongView id={entry.song_id} transpose={entry.transpose} />
  {/key}
{:else if !error}
  <p class="muted" role="status">{t("app.loading")}</p>
{/if}

<style>
  .play-bar {
    display: grid;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
  }
  .play-steps {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .play-position {
    font-variant-numeric: tabular-nums;
    color: var(--text-2);
  }
  .play-note {
    margin: 0;
    font-size: 1.05rem;
  }
  .hint {
    margin: 0;
    font-size: 0.8rem;
  }
</style>
