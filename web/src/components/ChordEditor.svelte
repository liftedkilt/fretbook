<script lang="ts">
  import { tick, untrack } from "svelte";

  import ChordSheet from "./ChordSheet.svelte";
  import EditorHeader from "./EditorHeader.svelte";
  import Icon from "./Icon.svelte";
  import SegmentedControl from "./ui/SegmentedControl.svelte";
  import { ApiError, getSong, updateSong } from "../lib/api";
  import { cursorAfterChange, EditHistory } from "../lib/editHistory";
  import { t } from "../lib/i18n.svelte";
  import { editorShortcutFor, ownsUndo } from "../lib/shortcuts";
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

  // --- undo and redo ----------------------------------------------------
  // One history for the title, the artist and the text. Typing is grouped until a pause;
  // a change made any other way is its own step. The text area's own undo is replaced by this one.

  type Snapshot = { title: string; artist: string; text: string };

  let textarea = $state<HTMLTextAreaElement>();
  let canUndo = $state(false);
  let canRedo = $state(false);

  function snapshot(): Snapshot {
    return { title: song.title, artist: song.artist, text };
  }

  const history = untrack(() => new EditHistory<Snapshot>(snapshot(), null));

  function groupKey(): string | null {
    const active = globalThis.document.activeElement;
    if (active === textarea) return "text";
    if (active instanceof HTMLInputElement) return active.dataset.field ?? null;
    return null;
  }

  function syncHistory() {
    canUndo = history.canUndo;
    canRedo = history.canRedo;
  }

  $effect(() => {
    const state = snapshot();
    untrack(() => {
      if (history.record(state, null, { group: groupKey() })) syncHistory();
    });
  });

  async function restore(step: { state: Snapshot } | null) {
    if (!step) return;
    const before = text;
    song.title = step.state.title;
    song.artist = step.state.artist;
    text = step.state.text;
    syncHistory();
    if (before === text || !textarea) return;
    await tick();
    const at = cursorAfterChange(before, text);
    textarea.setSelectionRange(at, at);
  }

  function undo() {
    void restore(history.undo());
  }

  function redo() {
    void restore(history.redo());
  }

  function onkeydown(event: KeyboardEvent) {
    const action = editorShortcutFor(event);
    if (!action || ownsUndo(event.target)) return;
    event.preventDefault();
    if (action === "undo") undo();
    else redo();
  }

  // Undo from the browser's Edit menu or a touch keyboard, in the text area.
  function onbeforeinput(event: InputEvent) {
    if (event.inputType !== "historyUndo" && event.inputType !== "historyRedo") return;
    event.preventDefault();
    if (event.inputType === "historyUndo") undo();
    else redo();
  }

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
      history.replace(snapshot(), null);
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
    history.reset(snapshot(), null);
    syncHistory();
    conflict = false;
    error = "";
  }
</script>

<svelte:window {onkeydown} />

<div class="editor-page">
  <EditorHeader
    songId={song.id}
    title={song.title}
    {dirty}
    {status}
    {canUndo}
    {canRedo}
    onundo={undo}
    onredo={redo}
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
    <label class="field"
      ><span>{t("library.title")}</span><input data-field="title" bind:value={song.title} /></label
    >
    <label class="field"
      ><span>{t("library.artist")}</span><input
        data-field="artist"
        bind:value={song.artist}
      /></label
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
      data-edit-history
      bind:this={textarea}
      bind:value={text}
      {onbeforeinput}
      spellcheck="false"
      rows="24"
      aria-label={t("chords.text")}></textarea>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div class="paper chord-paper" role="region" aria-label={t("chords.preview")} tabindex="0">
      <ChordSheet {text} />
    </div>
  </div>
</div>
