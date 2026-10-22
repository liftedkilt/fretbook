<script lang="ts">
  import ChordEditor from "./ChordEditor.svelte";
  import TabEditor from "./TabEditor.svelte";
  import { getMe, getMeta, getSong } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
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

{#if error}<p class="error">{error}</p>{/if}
{#if !song}
  {#if !error}<p class="hint">{t("app.loading")}</p>{/if}
{:else if song.content_kind === "chords"}
  {#key song.id}<ChordEditor {song} />{/key}
{:else}
  {#key song.id}<TabEditor song={song as TabSong} {presets} {defaultPreset} />{/key}
{/if}
