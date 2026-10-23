<script lang="ts">
  import { tick, untrack } from "svelte";

  import Icon from "./Icon.svelte";
  import {
    deleteSetlist,
    getSetlist,
    getSong,
    listSongs,
    renameSetlist,
    saveSetlistEntries,
  } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor, navigate } from "../lib/router.svelte";
  import {
    clampTranspose,
    moveItem,
    playPath,
    reorderKey,
    toDrafts,
    transposeLabel,
  } from "../lib/setlists";
  import type { SetlistEntry, SongSummary } from "../lib/types";

  let { id }: { id: string } = $props();

  // Rows carry a local `uid` so they keep their place (and focus) while the server renumbers its own ids.
  type Row = SetlistEntry & { uid: number };

  let name = $state("");
  let rows = $state<Row[]>([]);
  let loaded = $state(false);
  let error = $state("");
  let announcement = $state("");
  let exporting = $state(false);

  let nextUid = 0;
  const withUid = (entries: SetlistEntry[]): Row[] =>
    entries.map((entry) => ({ ...entry, uid: nextUid++ }));

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : t("error.generic");
  }

  $effect(() => {
    const setlistId = id;
    let cancel = false;
    loaded = false;
    error = "";
    getSetlist(setlistId)
      .then((setlist) => {
        if (cancel) return;
        name = setlist.name;
        rows = withUid(setlist.entries);
        loaded = true;
      })
      .catch((err: unknown) => {
        if (!cancel) fail(err);
      });
    return () => {
      cancel = true;
    };
  });

  // Saves send the latest list, one at a time, so quick moves cannot land out of order.
  let saving = false;
  let dirty = false;
  async function save() {
    dirty = true;
    if (saving) return;
    saving = true;
    try {
      while (dirty) {
        dirty = false;
        await saveSetlistEntries(id, toDrafts(untrack(() => rows)));
      }
      error = "";
    } catch (err) {
      fail(err);
    } finally {
      saving = false;
    }
  }

  async function commitName() {
    const next = name.trim();
    if (!next) return;
    try {
      const saved = await renameSetlist(id, next);
      name = saved.name;
    } catch (err) {
      fail(err);
    }
  }

  async function moveTo(from: number, to: number, focus?: "up" | "down") {
    const target = Math.max(0, Math.min(rows.length - 1, to));
    if (from === target || from < 0 || from >= rows.length) return;
    const moved = rows[from];
    rows = moveItem(rows, from, target);
    announcement = t("setlists.moved", {
      title: moved.title,
      position: target + 1,
      total: rows.length,
    });
    void save();
    if (focus) {
      await tick();
      // Keep the keyboard where it was, on the same row. At the end of the list use the other button.
      const row = document.querySelector<HTMLElement>(`[data-uid="${moved.uid}"]`);
      const wanted = row?.querySelector<HTMLButtonElement>(`[data-move="${focus}"]:not(:disabled)`);
      (wanted ?? row?.querySelector<HTMLButtonElement>("[data-move]:not(:disabled)"))?.focus();
    }
  }

  function remove(index: number) {
    rows = rows.filter((_, at) => at !== index);
    void save();
  }

  function setTranspose(row: Row, value: number) {
    row.transpose = clampTranspose(value);
    void save();
  }

  function onRowKey(event: KeyboardEvent, index: number) {
    const step = reorderKey(event);
    if (!step) return;
    event.preventDefault();
    void moveTo(index, index + step, step > 0 ? "down" : "up");
  }

  // Drag and drop (the buttons and Alt+arrows above do the same for keyboards and touch).
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);

  function onDrop(event: DragEvent, index: number) {
    event.preventDefault();
    const from = dragFrom;
    dragFrom = null;
    dragOver = null;
    if (from !== null) void moveTo(from, index);
  }

  // Adding songs: search the library and append.
  let query = $state("");
  let results = $state<SongSummary[]>([]);
  let searched = $state(false);

  $effect(() => {
    const text = query.trim();
    let cancel = false;
    const timer = setTimeout(
      () => {
        listSongs({ q: text, limit: 20, sort: text ? undefined : "title" })
          .then((page) => {
            if (cancel) return;
            results = page.items;
            searched = true;
          })
          .catch((err: unknown) => {
            if (!cancel) fail(err);
          });
      },
      text ? 200 : 0,
    );
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  });

  function addSong(song: SongSummary) {
    rows = [
      ...rows,
      ...withUid([
        {
          id: "",
          song_id: song.id,
          note: "",
          transpose: 0,
          title: song.title,
          artist: song.artist,
          content_kind: song.content_kind,
          preferred_instrument: song.preferred_instrument,
          string_count: song.string_count,
        },
      ]),
    ];
    announcement = t("setlists.added", { title: song.title, position: rows.length });
    void save();
  }

  async function exportPdf() {
    exporting = true;
    error = "";
    try {
      const unique = [...new Set(rows.map((row) => row.song_id))];
      const songs = new Map(
        await Promise.all(unique.map(async (songId) => [songId, await getSong(songId)] as const)),
      );
      const { downloadSetlistPdf } = await import("../lib/export/setlistPdf");
      await downloadSetlistPdf({
        name,
        entries: rows.map((row) => ({
          song: songs.get(row.song_id)!,
          note: row.note,
          transpose: row.transpose,
        })),
        labels: {
          contents: t("setlists.pdfContents"),
          transpose: (semitones) =>
            t("setlists.pdfTranspose", { semitones: transposeLabel(semitones) }),
        },
        capoLabel: (fret) => t("player.capo", { fret }),
      });
    } catch {
      error = t("setlists.exportFailed");
    } finally {
      exporting = false;
    }
  }

  async function removeSetlist() {
    if (!confirm(t("setlists.confirmDelete", { name }))) return;
    try {
      await deleteSetlist(id);
      navigate("/setlists");
    } catch (err) {
      fail(err);
    }
  }
</script>

<section class="setlist-page">
  <a
    class="back-link"
    href={hrefFor("/setlists")}
    onclick={(event) => followLink(event, "/setlists")}
    ><Icon name="back" size={18} />{t("setlists.back")}</a
  >

  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

  {#if loaded}
    <header class="setlist-head">
      <label class="visually-hidden" for="setlist-name">{t("setlists.rename")}</label>
      <input
        id="setlist-name"
        class="setlist-name display"
        data-testid="setlist-name"
        bind:value={name}
        maxlength="200"
        onchange={() => void commitName()}
        onkeydown={(event) => event.key === "Enter" && event.currentTarget.blur()}
      />
      <p class="muted">{t("setlists.count", { count: rows.length })}</p>
      <div class="setlist-actions">
        <a
          class="button primary"
          data-testid="setlist-play"
          aria-disabled={rows.length === 0}
          class:disabled={rows.length === 0}
          href={hrefFor(playPath(id, 0))}
          onclick={(event) =>
            rows.length ? followLink(event, playPath(id, 0)) : event.preventDefault()}
        >
          <Icon name="play" size={18} />{t("setlists.play")}
        </a>
        <button
          data-testid="setlist-export-pdf"
          disabled={exporting || rows.length === 0}
          onclick={() => void exportPdf()}
        >
          <Icon name="file" size={18} />{exporting
            ? t("setlists.exportingPdf")
            : t("setlists.exportPdf")}
        </button>
        <button data-testid="setlist-delete" onclick={() => void removeSetlist()}>
          <Icon name="trash" size={18} />{t("setlists.delete")}
        </button>
      </div>
    </header>

    <h2 class="section-title">{t("setlists.entries")}</h2>
    {#if rows.length === 0}
      <p class="muted" data-testid="setlist-entries-empty">{t("setlists.entriesEmpty")}</p>
    {:else}
      <p class="muted hint">{t("setlists.reorderHint")}</p>
      <ol class="entries" data-testid="setlist-entries">
        {#each rows as row, index (row.uid)}
          <!-- Alt+arrows bubble up from the row\'s own buttons and fields. -->
          <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
          <li
            class="entry"
            class:drag-over={dragOver === index && dragFrom !== index}
            class:dragging={dragFrom === index}
            data-testid="setlist-entry"
            data-uid={row.uid}
            draggable="true"
            ondragstart={(event) => {
              dragFrom = index;
              event.dataTransfer?.setData("text/plain", String(index));
              if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
            }}
            ondragover={(event) => {
              if (dragFrom === null) return;
              event.preventDefault();
              dragOver = index;
            }}
            ondrop={(event) => onDrop(event, index)}
            ondragend={() => {
              dragFrom = null;
              dragOver = null;
            }}
            onkeydown={(event) => onRowKey(event, index)}
          >
            <span
              class="grip"
              title={t("setlists.dragHandle", { title: row.title })}
              aria-hidden="true"><Icon name="grip" size={18} /></span
            >
            <span class="position">{index + 1}</span>
            <div class="entry-main">
              <strong class="entry-title" data-testid="setlist-entry-title">{row.title}</strong>
              <span class="muted entry-artist">{row.artist || "—"}</span>
              <input
                class="entry-note"
                data-testid="setlist-entry-note"
                bind:value={row.note}
                maxlength="500"
                placeholder={t("setlists.notePlaceholder")}
                aria-label={t("setlists.note", { title: row.title })}
                onchange={() => void save()}
              />
            </div>
            {#if row.content_kind === "chords"}
              <div
                class="transpose"
                role="group"
                aria-label={t("setlists.transposeFor", { title: row.title })}
              >
                <button
                  class="icon-button ghost"
                  data-testid="setlist-transpose-down"
                  disabled={row.transpose <= -11}
                  onclick={() => setTranspose(row, row.transpose - 1)}
                  aria-label={t("setlists.transposeDown")}
                  title={t("setlists.transposeDown")}><Icon name="minus" size={16} /></button
                >
                <span class="transpose-value" data-testid="setlist-transpose-value"
                  >{transposeLabel(row.transpose)}</span
                >
                <button
                  class="icon-button ghost"
                  data-testid="setlist-transpose-up"
                  disabled={row.transpose >= 11}
                  onclick={() => setTranspose(row, row.transpose + 1)}
                  aria-label={t("setlists.transposeUp")}
                  title={t("setlists.transposeUp")}><Icon name="plus" size={16} /></button
                >
              </div>
            {/if}
            <div class="entry-buttons">
              <button
                class="icon-button ghost"
                data-testid="setlist-move-up"
                data-move="up"
                disabled={index === 0}
                onclick={() => void moveTo(index, index - 1, "up")}
                aria-label={t("setlists.moveUp", { title: row.title })}
                title={t("setlists.moveUp", { title: row.title })}
                ><Icon name="chevronUp" size={18} /></button
              >
              <button
                class="icon-button ghost"
                data-testid="setlist-move-down"
                data-move="down"
                disabled={index === rows.length - 1}
                onclick={() => void moveTo(index, index + 1, "down")}
                aria-label={t("setlists.moveDown", { title: row.title })}
                title={t("setlists.moveDown", { title: row.title })}
                ><Icon name="chevronDown" size={18} /></button
              >
              <button
                class="icon-button ghost"
                data-testid="setlist-remove"
                onclick={() => remove(index)}
                aria-label={t("setlists.remove", { title: row.title })}
                title={t("setlists.remove", { title: row.title })}
                ><Icon name="close" size={18} /></button
              >
            </div>
          </li>
        {/each}
      </ol>
    {/if}
    <p class="visually-hidden" role="status" aria-live="polite" data-testid="setlist-announce">
      {announcement}
    </p>

    <h2 class="section-title">{t("setlists.addHeading")}</h2>
    <label class="search">
      <Icon name="search" size={18} />
      <input
        type="search"
        data-testid="setlist-add-search"
        bind:value={query}
        placeholder={t("setlists.addSearch")}
        aria-label={t("setlists.addSearch")}
      />
    </label>
    {#if searched && results.length === 0}
      <p class="muted">{t("setlists.addEmpty")}</p>
    {:else}
      <ul class="results">
        {#each results as song (song.id)}
          <li class="result" data-testid="setlist-result">
            <span class="result-text">
              <strong>{song.title}</strong>
              <span class="muted">{song.artist || "—"}</span>
            </span>
            <button
              data-testid="setlist-add"
              onclick={() => addSong(song)}
              aria-label={t("setlists.addButton", { title: song.title })}
            >
              <Icon name="plus" size={16} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if !error}
    <p class="muted" role="status">{t("app.loading")}</p>
  {/if}
</section>

<style>
  .setlist-head {
    margin: 0.75rem 0 1.25rem;
  }
  .setlist-name {
    width: 100%;
    font-size: 2rem;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    padding: 0.2rem 0.4rem;
    margin-left: -0.4rem;
  }
  .setlist-name:hover,
  .setlist-name:focus {
    border-color: var(--line-strong);
  }
  .setlist-actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.75rem;
  }
  .setlist-actions .disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .section-title {
    font-size: 1rem;
    margin: 1.5rem 0 0.5rem;
  }
  .entries,
  .results {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .entry {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.7rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
  }
  .entry.dragging {
    opacity: 0.45;
  }
  .entry.drag-over {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-ring);
  }
  .grip {
    cursor: grab;
    color: var(--text-3);
    display: inline-flex;
  }
  .position {
    min-width: 1.5rem;
    text-align: right;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .entry-main {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 0.15rem;
  }
  .entry-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entry-note {
    margin-top: 0.25rem;
    font-size: 0.85rem;
  }
  .transpose,
  .entry-buttons {
    display: flex;
    align-items: center;
    gap: 0.15rem;
  }
  .transpose-value {
    min-width: 2rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .result {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: var(--r-md);
  }
  .result-text {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    min-width: 0;
    flex-wrap: wrap;
  }
  @media (max-width: 640px) {
    .entry {
      flex-wrap: wrap;
    }
  }
</style>
