<script lang="ts">
  import type { Snippet } from "svelte";
  import ChordPractice from "./ChordPractice.svelte";
  import ChordSheetView from "./ChordSheetView.svelte";
  import SongDetails from "./SongDetails.svelte";
  import TabPlayer from "./TabPlayer.svelte";
  import Page from "./ui/Page.svelte";
  import { getSong, markSongOpened } from "../lib/api";
  import { canEdit } from "../lib/bands";
  import { t } from "../lib/i18n.svelte";
  import type { SongDetail, TabSong } from "../lib/types";
  import { songVersion } from "../lib/songUpdates.svelte";

  let {
    id,
    transpose = 0,
    belowHeader,
  }: { id: string; transpose?: number; belowHeader?: Snippet } = $props();

  let song = $state<SongDetail | null>(null);
  let error = $state("");
  // Bumped when a chord-sheet practice session is saved, so the history below reloads.
  let logged = $state(0);

  $effect(() => {
    const songId = id;
    void songVersion(songId);
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
  {@const editable = canEdit(song.library_role)}
  <Page width="wide">
    {#if song.content_kind === "chords"}
      <ChordSheetView {song} initialTranspose={transpose} readOnly={!editable} {belowHeader} />
      <!-- The same width and left edge as the sheet above. -->
      <div class="chords-lower">
        {#key song.id}
          <ChordPractice songId={song.id} onlogged={() => (logged += 1)} />
        {/key}
        <SongDetails {song} reload={logged} />
      </div>
    {:else}
      {#key song.id}
        <TabPlayer song={song as TabSong} readOnly={!editable} {belowHeader} />
      {/key}
      <SongDetails {song} />
    {/if}
  </Page>
{/if}

<style>
  .chords-lower {
    max-width: 920px;
  }
</style>
