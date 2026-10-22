<script lang="ts">
  import { untrack } from "svelte";

  import ChordSheet from "./ChordSheet.svelte";
  import { ApiError, getSong, updateSong } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { SongDetail } from "../lib/types";

  let { song: initial }: { song: SongDetail } = $props();

  let song = $state(untrack(() => ({ ...initial })));
  let text = $state(untrack(() => initial.chordpro ?? ""));
  let error = $state("");
  let conflict = $state(false);
  let status = $state("");

  async function save() {
    status = t("editor.saving");
    error = "";
    conflict = false;
    try {
      song = await updateSong(song.id, {
        title: song.title.trim() || "Untitled",
        artist: song.artist.trim(),
        revision: song.revision,
        chordpro: text,
      });
      text = song.chordpro ?? text;
      status = t("editor.saved");
    } catch (err) {
      status = "";
      conflict = err instanceof ApiError && err.status === 409;
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }

  async function reload() {
    song = await getSong(song.id);
    text = song.chordpro ?? "";
    conflict = false;
    error = "";
  }
</script>

{#if error}<p class="error">{error}</p>{/if}
{#if conflict}
  <p class="error">{t("editor.conflict")} <button onclick={() => void reload()}>{t("editor.reload")}</button></p>
{/if}

<div class="row" style="justify-content:space-between">
  <h2 style="margin:0">{t("chords.editHeading")}</h2>
  <div class="actions">
    <a class="button" href={hrefFor(`/songs/${song.id}`)} onclick={(event) => followLink(event, `/songs/${song.id}`)}>{t("chords.view")}</a>
    <button class="primary" onclick={() => void save()}>{t("editor.save")}</button>
    {#if status}<span class="hint">{status}</span>{/if}
  </div>
</div>

<div class="row" style="margin:0.8rem 0">
  <label class="field">{t("library.title")}<input bind:value={song.title} /></label>
  <label class="field">{t("library.artist")}<input bind:value={song.artist} /></label>
</div>
<p class="hint">{t("chords.editHint")}</p>
<div class="chord-editor">
  <textarea bind:value={text} spellcheck="false" rows="24" aria-label={t("chords.text")}></textarea>
  <div class="paper chord-paper"><ChordSheet {text} /></div>
</div>
