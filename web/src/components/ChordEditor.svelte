<script lang="ts">
  import { untrack } from "svelte";

  import ChordSheet from "./ChordSheet.svelte";
  import EditorHeader from "./EditorHeader.svelte";
  import Icon from "./Icon.svelte";
  import SegmentedControl from "./ui/SegmentedControl.svelte";
  import { ApiError, getSong, updateSong } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import type { SongDetail } from "../lib/types";

  let { song: initial }: { song: SongDetail } = $props();

  let song = $state(untrack(() => ({ ...initial })));
  let text = $state(untrack(() => initial.chordpro ?? ""));
  let error = $state("");
  let conflict = $state(false);
  let status = $state("");
  let pane = $state<"write" | "preview">("write");
  let savedTitle = $state(untrack(() => initial.title));
  let savedArtist = $state(untrack(() => initial.artist));
  let savedText = $state(untrack(() => initial.chordpro ?? ""));

  const dirty = $derived(
    song.title !== savedTitle || song.artist !== savedArtist || text !== savedText,
  );

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
      savedTitle = song.title;
      savedArtist = song.artist;
      savedText = text;
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
    savedTitle = song.title;
    savedArtist = song.artist;
    savedText = text;
    conflict = false;
    error = "";
  }
</script>

<div class="editor-page">
  <EditorHeader
    songId={song.id}
    title={song.title}
    {dirty}
    {status}
    onPreview={() => {
      pane = "preview";
    }}
    previewPressed={pane === "preview"}
    onsave={() => void save()}
  />

  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
  {#if conflict}
    <div class="alert alert-action" role="alert">
      <span>{t("editor.conflict")}</span>
      <button onclick={() => void reload()}>{t("editor.reload")}</button>
    </div>
  {/if}

  <section class="card form-grid">
    <label class="field"><span>{t("library.title")}</span><input bind:value={song.title} /></label>
    <label class="field"><span>{t("library.artist")}</span><input bind:value={song.artist} /></label
    >
    <p class="muted small span-2">{t("chords.editHint")}</p>
  </section>

  <div class="pane-switch">
    <SegmentedControl
      label={t("chords.editHeading")}
      role="tablist"
      value={pane}
      testid="chord-pane"
      onchange={(next) => (pane = next as "write" | "preview")}
      options={[
        { value: "write", label: t("chords.write"), icon: "edit", testid: "chord-write" },
        { value: "preview", label: t("chords.preview"), icon: "eye", testid: "chord-preview-tab" },
      ]}
    />
  </div>

  <div class="chord-editor" data-pane={pane}>
    <textarea
      class="code-input"
      data-testid="chord-text"
      bind:value={text}
      spellcheck="false"
      rows="24"
      aria-label={t("chords.text")}></textarea>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="paper chord-paper" role="region" aria-label={t("chords.preview")} tabindex="0">
      <ChordSheet {text} />
    </div>
  </div>
</div>
