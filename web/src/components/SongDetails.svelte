<script lang="ts">
  import DifficultyPanel from "./DifficultyPanel.svelte";
  import SongPractice from "./SongPractice.svelte";
  import Chip from "./ui/Chip.svelte";
  import { t } from "../lib/i18n.svelte";
  import { renderMarkdown } from "../lib/markdown";
  import type { SongDetail } from "../lib/types";

  // The Details section after the score: genre, year and album, the song's notes, how hard it is
  // and the practice history. `reload` refreshes the history after a practice session is saved.
  let { song, reload = 0 }: { song: SongDetail; reload?: number } = $props();

  const notesHtml = $derived(renderMarkdown(song.notes ?? ""));
  // The heading only shows over something. The practice history loads by itself, under its own summary.
  const hasContent = $derived(
    Boolean(
      song.genre ||
      song.year ||
      song.album ||
      song.notes ||
      (song.difficulty_tracks && song.difficulty_tracks.length > 0),
    ),
  );
  const preferredId = $derived(song.content_kind === "chords" ? "chords" : song.preferred_track_id);
</script>

<section
  class="song-details no-print"
  data-testid="song-details"
  aria-label={t("songPage.details")}
>
  {#if hasContent}<h2>{t("songPage.details")}</h2>{/if}
  {#if song.genre || song.year || song.album}
    <div class="facts">
      {#if song.genre}<Chip variant="meta" label={song.genre} testid="song-genre" />{/if}
      {#if song.year}<Chip variant="meta" label={String(song.year)} testid="song-year" />{/if}
      {#if song.album}<Chip variant="meta" label={song.album} testid="song-album" />{/if}
    </div>
  {/if}
  {#if song.notes}
    <div class="song-notes markdown" data-testid="song-notes">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- escaped first by renderMarkdown -->
      {@html notesHtml}
    </div>
  {/if}
  <DifficultyPanel
    tracks={song.difficulty_tracks}
    {preferredId}
    chords={song.content_kind === "chords"}
  />
  <SongPractice songId={song.id} {reload} />
</section>

<style>
  .song-details {
    display: grid;
    gap: var(--sp-3);
    margin-top: var(--sp-6);
    /* The dock floats over the bottom of the page: this is the room it needs, so the score does
       not carry a gap of its own above this section. */
    padding-bottom: calc(var(--dock-space) + var(--sp-5));
  }

  h2 {
    margin: 0;
    font-size: var(--fs-h2);
    font-weight: 600;
    line-height: 1.3;
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }

  /* Full screen keeps only the score and the dock. */
  :global(:root[data-fullscreen]) .song-details {
    display: none;
  }
</style>
