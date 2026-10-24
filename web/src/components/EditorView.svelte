<script lang="ts">
  import ChordEditor from "./ChordEditor.svelte";
  import TabEditor from "./TabEditor.svelte";
  import Page from "./ui/Page.svelte";
  import { getMe, getMeta, getSong } from "../lib/api";
  import { canEdit } from "../lib/bands";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { InstrumentPreset, SongDetail, TabSong } from "../lib/types";

  let { id }: { id: string } = $props();

  let song = $state<SongDetail | null>(null);
  let presets = $state<InstrumentPreset[]>([]);
  let defaultPreset = $state("bass-4");
  let error = $state("");

  $effect(() => {
    const songId = id;
    let cancel = false;
    song = null;
    error = "";
    Promise.all([getSong(songId), getMeta(), getMe()])
      .then(([loaded, meta, me]) => {
        if (cancel) return;
        presets = meta.instruments;
        defaultPreset = me.settings.default_instrument;
        song = loaded;
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
{:else if !canEdit(song.library_role)}
  {@const songId = song.id}
  <p class="alert" role="alert">{t("errors.library.readOnly")}</p>
  <a
    class="button"
    href={hrefFor(`/songs/${songId}`)}
    onclick={(event) => followLink(event, `/songs/${songId}`)}>{t("app.back")}</a
  >
{:else}
  <Page width="wide">
    {#if song.content_kind === "chords"}
      {#key song.id}<ChordEditor {song} />{/key}
    {:else}
      {#key song.id}<TabEditor song={song as TabSong} {presets} {defaultPreset} />{/key}
    {/if}
  </Page>
{/if}
