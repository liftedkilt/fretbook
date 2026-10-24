<script lang="ts">
  import ChordSheetView from "./ChordSheetView.svelte";
  import DifficultyPanel from "./DifficultyPanel.svelte";
  import SongPractice from "./SongPractice.svelte";
  import SongTags from "./SongTags.svelte";
  import TabPlayer from "./TabPlayer.svelte";
  import { getSong, markSongOpened } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import type { SongDetail, TabSong } from "../lib/types";

  let { id, transpose = 0 }: { id: string; transpose?: number } = $props();

  let song = $state<SongDetail | null>(null);
  let error = $state("");

  $effect(() => {
    const songId = id;
    let cancel = false;
    song = null;
    error = "";
    getSong(songId)
      .then((loaded) => {
        if (cancel) return;
        song = loaded;
        // Best effort: a failure only leaves the "last opened" sort a step behind.
        markSongOpened(songId).catch(() => {});
      })
      .catch((err: unknown) => {
        if (!cancel) error = err instanceof Error ? err.message : t("error.generic");
      });
    return () => {
      cancel = true;
    };
  });
</script>

{#if error}<p class="alert" role="alert">{error}</p>{/if}
{#if !song}
  {#if !error}<div class="loading" role="status">
      <span class="spinner"></span>{t("app.loading")}
    </div>{/if}
{:else}
  {#key song.id}
    <SongTags {song} />
  {/key}
  {#if song.content_kind === "chords"}
    <ChordSheetView {song} initialTranspose={transpose} />
    <DifficultyPanel tracks={song.difficulty_tracks} preferredId="chords" chords />
  {:else}
    {#key song.id}
      <TabPlayer song={song as TabSong} />
    {/key}
    <DifficultyPanel tracks={song.difficulty_tracks} preferredId={song.preferred_track_id} />
    <SongPractice songId={song.id} />
  {/if}
{/if}
