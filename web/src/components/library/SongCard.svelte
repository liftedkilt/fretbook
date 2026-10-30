<script lang="ts">
  import Cover from "../Cover.svelte";
  import Icon from "../Icon.svelte";
  import Chip from "../ui/Chip.svelte";
  import OverflowMenu from "../ui/OverflowMenu.svelte";
  import DifficultyMeter from "./DifficultyMeter.svelte";
  import { coverSrc } from "../../lib/cover";
  import { t } from "../../lib/i18n.svelte";
  import { instrumentLabel } from "../../lib/instruments";
  import { keyLabel } from "../../lib/keys";
  import { snippetParts } from "../../lib/lyricsSnippet";
  import { followLink, hrefFor, navigate } from "../../lib/router.svelte";
  import type { SongSummary } from "../../lib/types";

  let {
    song,
    readOnly = false,
    selecting = false,
    selected = false,
    onselect,
    onstar,
    onsetlist,
    ondelete,
  }: {
    song: SongSummary;
    readOnly?: boolean;
    selecting?: boolean;
    selected?: boolean;
    onselect: () => void;
    onstar: () => void;
    onsetlist: () => void;
    ondelete: () => void;
  } = $props();

  const kind = $derived(
    song.content_kind === "chords"
      ? t("library.chordSheet")
      : instrumentLabel(song.preferred_instrument),
  );
  const showKey = $derived(!!song.key);
  const showTempo = $derived(song.content_kind === "tab");
  const showLevel = $derived(song.content_kind === "tab" && song.difficulty !== null);

  const items = $derived([
    {
      id: "edit",
      label: t("library.edit"),
      icon: "edit",
      testid: "song-edit",
      onclick: () => navigate(`/songs/${song.id}/edit`),
    },
    {
      id: "setlist",
      label: t("setlists.addToSetlist"),
      icon: "listMusic",
      testid: "song-add-to-setlist",
      onclick: onsetlist,
    },
    {
      id: "delete",
      label: t("library.delete"),
      icon: "trash",
      danger: true,
      testid: "song-delete",
      onclick: ondelete,
    },
  ]);
</script>

<article class="song" class:starred={song.favourite} data-testid="song-card">
  <a
    class="link"
    data-testid="song-link"
    href={hrefFor(`/songs/${song.id}`)}
    onclick={(event) => followLink(event, `/songs/${song.id}`)}
  >
    <span class="art">
      <Cover
        id={song.id}
        title={song.title}
        kind={song.content_kind}
        strings={song.string_count}
        src={coverSrc(song.cover_url)}
      />
      {#if song.has_audio}
        <span class="audio" title={t("library.audio")}><Icon name="waveform" size={14} /></span>
      {/if}
      <span class="play" aria-hidden="true"><Icon name="play" size={20} /></span>
    </span>
    <span class="text">
      <strong class="title" data-testid="song-title">{song.title}</strong>
      <span class="artist">{song.artist || "—"}</span>
      <span class="visually-hidden">{kind}</span>
      {#if showKey || showTempo || showLevel}
        <span class="facts">
          {#if showKey}<Chip
              variant="meta"
              label={keyLabel(song.key ?? "", t)}
              testid="song-key"
            />{/if}
          {#if showTempo}<Chip variant="meta" label={t("library.tempo", { bpm: song.bpm })} />{/if}
          {#if showLevel}<DifficultyMeter
              difficulty={song.difficulty ?? 1}
              testid="song-difficulty"
            />{/if}
        </span>
      {/if}
      {#if song.lyrics_snippet}
        <span class="lyrics" data-testid="song-lyrics-snippet" title={t("librarySnippet.label")}
          ><span class="visually-hidden"
            >{t("librarySnippet.label")}:
          </span>{#each snippetParts(song.lyrics_snippet) as part, index (index)}{#if part.hit}<mark
                >{part.text}</mark
              >{:else}{part.text}{/if}{/each}</span
        >
      {/if}
    </span>
  </a>
  {#if selecting}
    <label class="select">
      <input
        type="checkbox"
        data-testid="song-select"
        checked={selected}
        onchange={onselect}
        aria-label={`${t("tags.selectSong")}: ${song.title}`}
      />
    </label>
  {/if}
  {#if !readOnly}
    <div class="actions">
      <button
        type="button"
        class="icon-button glass star"
        class:on={song.favourite}
        data-testid="song-star"
        aria-pressed={song.favourite}
        onclick={onstar}
        aria-label={`${song.favourite ? t("tags.unfavourite") : t("tags.favourite")}: ${song.title}`}
        title={song.favourite ? t("tags.unfavourite") : t("tags.favourite")}
      >
        <Icon name={song.favourite ? "starFilled" : "star"} size={16} />
      </button>
      <span class="more">
        <OverflowMenu
          label={`${t("libraryToolbar.actions")}: ${song.title}`}
          {items}
          testid="song-menu"
        />
      </span>
    </div>
  {/if}
</article>

<style>
  .song {
    position: relative;
    min-width: 0;
  }

  /* A card with its menu open or focused stays above the cards after it. */
  .song:focus-within {
    z-index: 4;
  }

  .link {
    display: grid;
    gap: var(--sp-3);
    color: inherit;
    text-decoration: none;
  }

  .art {
    position: relative;
    display: block;
    border-radius: var(--r-md);
    box-shadow: var(--shadow-sm);
  }

  .art :global(.cover) {
    border-radius: var(--r-md);
  }

  .audio,
  .play {
    position: absolute;
    z-index: 2;
    display: grid;
    place-items: center;
    border-radius: 50%;
  }

  .audio {
    left: var(--sp-2);
    bottom: var(--sp-2);
    width: 26px;
    height: 26px;
    background: rgba(12, 10, 16, 0.45);
    color: #fff;
  }

  .play {
    right: var(--sp-2);
    bottom: var(--sp-2);
    width: 44px;
    height: 44px;
    padding-left: 2px;
    background: var(--grad);
    color: #fff;
    box-shadow: var(--glow);
    opacity: 0;
    transform: translateY(6px) scale(0.9);
    transition:
      opacity 0.25s var(--ease),
      transform 0.25s var(--ease);
  }

  .link:hover .play,
  .link:focus-visible .play {
    opacity: 1;
    transform: none;
  }

  .text {
    display: grid;
    gap: var(--sp-1);
    min-width: 0;
  }

  .title,
  .artist {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-size: var(--fs-h3);
    font-weight: 600;
    line-height: 1.3;
  }

  .artist {
    color: var(--text-2);
    font-size: var(--fs-sm);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-1);
    margin-top: var(--sp-1);
  }

  /* Why a lyric-only search match was found: the matching words, at most two lines. */
  .lyrics {
    display: -webkit-box;
    overflow: hidden;
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-style: italic;
    line-height: 1.4;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .lyrics mark {
    background: none;
    color: var(--text);
    font-style: normal;
    font-weight: 600;
  }

  .select {
    position: absolute;
    z-index: 3;
    top: var(--sp-2);
    left: var(--sp-2);
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: var(--r-sm);
    background: var(--surface);
  }

  .select input {
    width: 18px;
    height: 18px;
  }

  .actions {
    position: absolute;
    z-index: 3;
    top: var(--sp-2);
    right: var(--sp-2);
    display: flex;
    gap: var(--sp-1);
    opacity: 0;
    transition: opacity 0.2s var(--ease);
  }

  .actions :global(.icon-button) {
    width: 34px;
    min-width: 34px;
    height: 34px;
    min-height: 34px;
    border-radius: var(--r-sm);
  }

  .more {
    display: inline-flex;
  }

  .song:hover .actions,
  .song:focus-within .actions,
  .song.starred .star {
    opacity: 1;
  }

  /* A starred song keeps its star; the menu waits for hover or focus. */
  .song.starred:not(:hover):not(:focus-within) .more {
    display: none;
  }

  .star.on {
    color: var(--accent);
  }

  @media (hover: none) {
    .actions {
      opacity: 1;
    }

    .play {
      display: none;
    }
  }

  /* Phones: a list row (cover, title, meta, star, menu). Nothing destructive is one tap away. */
  @media (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    .song {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--sp-2);
      padding: var(--sp-2) 0;
    }

    .link {
      grid-template-columns: 56px minmax(0, 1fr);
      align-items: center;
      gap: var(--sp-3);
      min-height: 56px;
    }

    .art {
      box-shadow: none;
      border-radius: var(--r-sm);
    }

    .art :global(.cover) {
      width: 56px;
      border-radius: var(--r-sm);
    }

    .audio,
    .play {
      display: none;
    }

    .actions {
      position: static;
      opacity: 1;
    }

    .actions :global(.icon-button) {
      width: 44px;
      min-width: 44px;
      height: 44px;
      min-height: 44px;
    }

    .song.starred:not(:hover):not(:focus-within) .more {
      display: inline-flex;
    }

    .select {
      top: 50%;
      left: 0;
      transform: translateY(-50%);
    }

    .song:has(.select) .link {
      padding-left: 40px;
    }
  }
</style>
