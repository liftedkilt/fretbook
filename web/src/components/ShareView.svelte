<script lang="ts">
  import ChordSheetView from "./ChordSheetView.svelte";
  import TabPlayer from "./TabPlayer.svelte";
  import Page from "./ui/Page.svelte";
  import { getSharedSong } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import type { SongDetail, TabSong } from "../lib/types";

  let { token }: { token: string } = $props();

  let song = $state<SongDetail | null>(null);
  let error = $state("");

  $effect(() => {
    const current = token;
    let cancel = false;
    song = null;
    error = "";
    getSharedSong(current)
      .then((loaded) => {
        if (!cancel) song = loaded;
      })
      .catch(() => {
        if (!cancel) error = t("sharing.unavailable");
      });
    return () => {
      cancel = true;
    };
  });
</script>

<main class="share-page" data-testid="share-player">
  {#if error}<p class="alert" role="alert">{error}</p>{/if}
  {#if !song}
    {#if !error}<p class="muted" role="status">{t("app.loading")}</p>{/if}
  {:else}
    <Page width="wide">
      {#if song.content_kind === "chords"}
        <ChordSheetView {song} readOnly />
      {:else}
        <TabPlayer song={song as TabSong} readOnly />
      {/if}
    </Page>
  {/if}
</main>

<style>
  .share-page {
    padding: var(--sp-4);
  }
</style>
