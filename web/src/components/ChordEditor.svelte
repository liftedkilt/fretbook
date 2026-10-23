<script lang="ts">
  import { untrack } from "svelte";

  import ChordSheet from "./ChordSheet.svelte";
  import Icon from "./Icon.svelte";
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
  let pane = $state<"write" | "preview">("write");

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

<div class="editor-page">
  <header class="editor-bar">
    <a class="back-link" href={hrefFor(`/songs/${song.id}`)} onclick={(event) => followLink(event, `/songs/${song.id}`)}>
      <Icon name="back" size={18} />{t("chords.view")}
    </a>
    <h1 class="editor-title">{t("chords.editHeading")}</h1>
    <div class="editor-actions">
      {#if status}<span class="save-status" role="status" data-testid="editor-status"><Icon name="check" size={16} />{status}</span>{/if}
      <button class="primary" data-testid="editor-save" onclick={() => void save()}><Icon name="save" size={18} />{t("editor.save")}</button>
    </div>
  </header>

  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
  {#if conflict}
    <div class="alert alert-action" role="alert">
      <span>{t("editor.conflict")}</span>
      <button onclick={() => void reload()}>{t("editor.reload")}</button>
    </div>
  {/if}

  <section class="card form-grid">
    <label class="field"><span>{t("library.title")}</span><input bind:value={song.title} /></label>
    <label class="field"><span>{t("library.artist")}</span><input bind:value={song.artist} /></label>
    <p class="muted small span-2">{t("chords.editHint")}</p>
  </section>

  <div class="segmented pane-switch" role="tablist" aria-label={t("chords.editHeading")}>
    <button role="tab" aria-selected={pane === "write"} onclick={() => (pane = "write")}><Icon name="edit" size={16} />{t("chords.write")}</button>
    <button role="tab" aria-selected={pane === "preview"} onclick={() => (pane = "preview")}><Icon name="eye" size={16} />{t("chords.preview")}</button>
  </div>

  <div class="chord-editor" data-pane={pane}>
    <textarea class="code-input" data-testid="chord-text" bind:value={text} spellcheck="false" rows="24" aria-label={t("chords.text")}></textarea>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="paper chord-paper" role="region" aria-label={t("chords.preview")} tabindex="0"><ChordSheet {text} /></div>
  </div>
</div>
