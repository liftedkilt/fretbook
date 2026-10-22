<script lang="ts">
  import ChordSheetView from "./ChordSheetView.svelte";
  import TabPlayer from "./TabPlayer.svelte";
  import { getSong } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import type { SongDetail, TabSong } from "../lib/types";

  let { id }: { id: string } = $props();

  let song = $state<SongDetail | null>(null);
  let error = $state("");

  $effect(() => {
    const songId = id;
    let cancel = false;
    song = null;
    error = "";
    getSong(songId)
      .then((loaded) => {
        if (!cancel) song = loaded;
      })
      .catch((err: unknown) => {
        if (!cancel) error = err instanceof Error ? err.message : t("error.generic");
      });
    return () => {
      cancel = true;
    };
  });
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if !song}
  {#if !error}<p class="hint">{t("app.loading")}</p>{/if}
{:else if song.content_kind === "chords"}
  <ChordSheetView {song} />
{:else}
  {#key song.id}
    <TabPlayer song={song as TabSong} />
  {/key}
{/if}
