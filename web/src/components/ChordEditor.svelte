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
  let viewMode = $state<"split" | "write" | "preview">("split");

  async function save() {
    status = t("editor.saving");
    error = "";
    conflict = false;
    try {
      song = await updateSong(song.id, {
        title: song.title.trim() || t("library.untitled"),
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

<div class="page-header">
  <div class="page-title-group">
    <h2>{t("chords.editHeading")}</h2>
    <p class="hint" style="margin:0.25rem 0 0">{t("chords.editHint")}</p>
  </div>
  <div class="actions">
    {#if status}<span class="badge subtle">{status}</span>{/if}
    <div class="segmented" role="group" aria-label={t("chords.view")}>
      <button type="button" aria-pressed={viewMode === "split"} onclick={() => (viewMode = "split")}>
        {t("chords.editTabSplit")}
      </button>
      <button type="button" aria-pressed={viewMode === "write"} onclick={() => (viewMode = "write")}>
        {t("chords.editTabWrite")}
      </button>
      <button type="button" aria-pressed={viewMode === "preview"} onclick={() => (viewMode = "preview")}>
        {t("chords.editTabPreview")}
      </button>
    </div>
    <a class="button" href={hrefFor("/")} onclick={(event) => followLink(event, "/")}>
      {t("app.back")}
    </a>
    <a class="button" href={hrefFor(`/songs/${song.id}`)} onclick={(event) => followLink(event, `/songs/${song.id}`)}>
      {t("chords.view")}
    </a>
    <button class="primary" onclick={() => void save()}>{t("editor.save")}</button>
  </div>
</div>

<section class="panel" style="margin-bottom:1rem">
  <div class="form-grid" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr))">
    <label class="field">{t("library.title")}<input bind:value={song.title} /></label>
    <label class="field">{t("library.artist")}<input bind:value={song.artist} /></label>
  </div>
</section>

<div class="chord-editor mode-{viewMode}">
  {#if viewMode !== "preview"}
    <textarea bind:value={text} spellcheck="false" rows="24" aria-label={t("chords.text")}></textarea>
  {/if}
  {#if viewMode !== "write"}
    <div class="paper chord-paper"><ChordSheet {text} /></div>
  {/if}
</div>
