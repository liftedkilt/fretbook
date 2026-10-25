<script lang="ts">
  import { untrack, type Snippet } from "svelte";

  import Cover from "./Cover.svelte";
  import Icon from "./Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import { deleteCover, lookupMetadata, updateSongMetadata, uploadCover } from "../lib/api";
  import { coverSrc } from "../lib/cover";
  import { t } from "../lib/i18n.svelte";
  import { KEYS, keyLabel } from "../lib/keys";
  import type { SongDetail } from "../lib/types";
  import { refreshSongs, ui } from "../lib/ui.svelte";

  // The sheet that edits a song's key, genre, album, year, personal notes and cover art.
  // `onchange` gets the song as saved. The page shows the saved details in its Details section.
  // `extra` is shown first: on a phone it holds the tags and facts the header leaves out.
  let {
    song,
    onchange,
    open = $bindable(false),
    readOnly = false,
    extra,
  }: {
    song: SongDetail;
    onchange: (song: SongDetail) => void;
    open?: boolean;
    readOnly?: boolean;
    extra?: Snippet;
  } = $props();
  const locked = $derived(ui.demoMode || readOnly);

  let key = $state("");
  let genre = $state("");
  let album = $state("");
  let year = $state("");
  let notes = $state("");
  let busy = $state(false);
  let notice = $state("");
  let error = $state("");
  let fileInput = $state<HTMLInputElement>();

  // The key the person chose; a detected key only shows in the select's first option.
  const ownKey = $derived(song.key && !song.key_detected ? song.key : "");

  // Fill the form from the song each time the sheet opens.
  $effect(() => {
    if (open) untrack(start);
  });

  function start() {
    key = ownKey;
    genre = song.genre;
    album = song.album;
    year = song.year === null ? "" : String(song.year);
    notes = song.notes;
    error = "";
    notice = "";
  }

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : t("error.generic");
  }

  async function run(work: () => Promise<SongDetail>): Promise<SongDetail | null> {
    busy = true;
    error = "";
    notice = "";
    try {
      const saved = await work();
      onchange(saved);
      // The library cards and filters show the same details.
      await refreshSongs().catch(() => undefined);
      return saved;
    } catch (err) {
      fail(err);
      return null;
    } finally {
      busy = false;
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    const trimmedYear = year.trim();
    if (trimmedYear && !/^\d{4}$/.test(trimmedYear)) {
      error = t("errors.metadata.invalid");
      return;
    }
    const saved = await run(() =>
      updateSongMetadata(song.id, {
        key,
        genre,
        album,
        year: trimmedYear ? Number(trimmedYear) : null,
        notes,
      }),
    );
    if (saved) open = false;
  }

  async function pickCover(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) await run(() => uploadCover(song.id, file));
  }

  async function lookup() {
    const saved = await run(() => lookupMetadata(song.id));
    if (!saved) return;
    // Fill what the lookup found into fields that are still empty in the form.
    if (!album.trim()) album = saved.album;
    if (!year.trim() && saved.year !== null) year = String(saved.year);
    notice = t("metadata.lookupDone");
  }
</script>

<Sheet
  {open}
  title={t("metadata.editTitle")}
  subtitle={song.title}
  testid="metadata-sheet"
  onclose={() => (open = false)}
>
  {#if extra}<div class="metadata-extra">{@render extra()}</div>{/if}
  {#if !locked}
    <form class="metadata-form" onsubmit={save}>
      {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
      {#if notice}<p class="muted" role="status" data-testid="metadata-notice">{notice}</p>{/if}

      <div class="metadata-cover">
        <div class="metadata-cover-art">
          <Cover
            id={song.id}
            title={song.title}
            kind={song.content_kind}
            size="md"
            src={coverSrc(song.cover_url)}
          />
        </div>
        <div class="metadata-cover-actions">
          <span class="field-label">{t("metadata.cover")}</span>
          <input
            bind:this={fileInput}
            class="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            data-testid="metadata-cover-input"
            aria-label={t("metadata.coverUpload")}
            onchange={pickCover}
          />
          <div class="row-actions">
            <button type="button" disabled={busy} onclick={() => fileInput?.click()}>
              <Icon name="upload" size={16} />{t("metadata.coverUpload")}
            </button>
            {#if song.cover_url}
              <button
                type="button"
                data-testid="metadata-cover-remove"
                disabled={busy}
                onclick={() => void run(() => deleteCover(song.id))}
              >
                <Icon name="trash" size={16} />{t("metadata.coverRemove")}
              </button>
            {/if}
            {#if ui.lookupEnabled}
              <button
                type="button"
                data-testid="metadata-lookup"
                disabled={busy}
                onclick={() => void lookup()}
              >
                <Icon name="search" size={16} />{t("metadata.lookup")}
              </button>
            {/if}
          </div>
          <p class="muted small">{t("metadata.coverHint")}</p>
          {#if ui.lookupEnabled}<p class="muted small">{t("metadata.lookupHint")}</p>{/if}
        </div>
      </div>

      <div class="form-grid">
        <label class="field">
          <span>{t("metadata.key")}</span>
          <select data-testid="metadata-key" bind:value={key}>
            <option value="">
              {song.key_detected && song.key
                ? t("metadata.keyDetected", { key: keyLabel(song.key, t) })
                : t("metadata.keyAutoNone")}
            </option>
            {#each KEYS as item (item)}<option value={item}>{keyLabel(item, t)}</option>{/each}
          </select>
        </label>
        <label class="field">
          <span>{t("metadata.year")}</span>
          <input
            type="text"
            inputmode="numeric"
            maxlength="4"
            data-testid="metadata-year"
            bind:value={year}
          />
        </label>
        <label class="field">
          <span>{t("metadata.genre")}</span>
          <input
            type="text"
            maxlength="80"
            list="metadata-genres"
            data-testid="metadata-genre"
            placeholder={t("metadata.genreHint")}
            bind:value={genre}
          />
          <datalist id="metadata-genres">
            {#each ui.facets.genres as item (item.name)}<option value={item.name}></option>{/each}
          </datalist>
        </label>
        <label class="field">
          <span>{t("metadata.album")}</span>
          <input type="text" maxlength="200" data-testid="metadata-album" bind:value={album} />
        </label>
        <label class="field span-2">
          <span>{t("metadata.notes")}</span>
          <textarea rows="6" maxlength="20000" data-testid="metadata-notes" bind:value={notes}
          ></textarea>
          <span class="muted small">{t("metadata.notesHint")}</span>
        </label>
      </div>

      <div class="form-actions">
        <button type="button" onclick={() => (open = false)}>{t("metadata.cancel")}</button>
        <button class="primary" type="submit" data-testid="metadata-save" disabled={busy}>
          {busy ? t("metadata.saving") : t("metadata.save")}
        </button>
      </div>
    </form>
  {/if}
</Sheet>

<style>
  .metadata-extra {
    display: grid;
    gap: var(--sp-3);
    margin-bottom: var(--sp-4);
  }
</style>
