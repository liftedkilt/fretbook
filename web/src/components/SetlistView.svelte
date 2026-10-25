<script lang="ts">
  import { tick, untrack } from "svelte";

  import Icon from "./Icon.svelte";
  import Cover from "./Cover.svelte";
  import SongPickerSheet from "./setlists/SongPickerSheet.svelte";
  import OverflowMenu from "./ui/OverflowMenu.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import {
    deleteSetlist,
    getSetlist,
    getSong,
    listSongs,
    renameSetlist,
    saveSetlistEntries,
  } from "../lib/api";
  import { coverSrc } from "../lib/cover";
  import { t } from "../lib/i18n.svelte";
  import {
    isSetlistSaved,
    removeSetlistOffline,
    saveSetlistOffline,
  } from "../lib/offline/offline.svelte";
  import { offlineSupported } from "../lib/offline/store";
  import { formatDuration } from "../lib/practiceText";
  import { followLink, hrefFor, navigate } from "../lib/router.svelte";
  import {
    clampTranspose,
    moveItem,
    playPath,
    reorderKey,
    runningSeconds,
    songsById,
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

  async function moveTo(from: number, to: number, focus = false) {
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
      // Keep the keyboard on the same row.
      document
        .querySelector<HTMLElement>(`[data-uid="${moved.uid}"] [data-testid="setlist-entry-menu"]`)
        ?.focus();
    }
  }

  function setTranspose(row: Row, value: number) {
    row.transpose = clampTranspose(value);
    void save();
  }

  function onRowKey(event: KeyboardEvent, index: number) {
    const step = reorderKey(event);
    if (!step) return;
    event.preventDefault();
    void moveTo(index, index + step, true);
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

  // The library's songs by id, for covers and the running time.
  let songs = $state<Map<string, SongSummary>>(new Map());
  $effect(() => {
    let cancel = false;
    songsById((cursor) => listSongs({ limit: 200, sort: "title", cursor }))
      .then((found) => {
        if (!cancel) songs = found;
      })
      .catch(() => {
        // Covers and times are extras; the list works without them.
      });
    return () => {
      cancel = true;
    };
  });

  const seconds = $derived(
    runningSeconds(
      rows.map((row) => row.song_id),
      songs,
    ),
  );
  const subtitle = $derived(
    seconds > 0
      ? t("setlists.countTime", { count: rows.length, time: formatDuration(seconds) })
      : t("setlists.count", { count: rows.length }),
  );

  let picking = $state(false);
  const added = $derived(new Set(rows.map((row) => row.song_id)));

  function addSongs(picked: SongSummary[]) {
    rows = [
      ...rows,
      ...withUid(
        picked.map((song) => ({
          id: "",
          song_id: song.id,
          note: "",
          transpose: 0,
          title: song.title,
          artist: song.artist,
          content_kind: song.content_kind,
          preferred_instrument: song.preferred_instrument,
          string_count: song.string_count,
        })),
      ),
    ];
    announcement =
      picked.length === 1
        ? t("setlists.added", { title: picked[0].title, position: rows.length })
        : t("setlists.addedMany", { count: picked.length });
    void save();
  }

  // Removing a song can be undone for a few seconds.
  let undo = $state<{ row: Row; index: number } | null>(null);
  let undoTimer: ReturnType<typeof setTimeout> | undefined;

  function remove(index: number) {
    const row = rows[index];
    rows = rows.filter((_, at) => at !== index);
    void save();
    undo = { row, index };
    announcement = t("setlists.removed", { title: row.title });
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => (undo = null), 8000);
  }

  function undoRemove() {
    if (!undo) return;
    const { row, index } = undo;
    undo = null;
    clearTimeout(undoTimer);
    const next = [...rows];
    next.splice(Math.min(index, next.length), 0, row);
    rows = next;
    announcement = t("setlists.restored", { title: row.title });
    void save();
  }

  $effect(() => () => clearTimeout(undoTimer));

  // Notes read as text and turn into a field when clicked.
  let editingUid = $state<number | null>(null);
  let noteBefore = "";

  function editNote(row: Row) {
    noteBefore = row.note;
    editingUid = row.uid;
  }

  function endNote(row: Row, keep: boolean) {
    if (editingUid !== row.uid) return;
    editingUid = null;
    if (keep) void save();
    else row.note = noteBefore;
  }

  function focusOnMount(node: HTMLElement) {
    node.focus();
  }

  // Keeping a copy on this device.
  let offlineBusy = $state(false);
  const kept = $derived(isSetlistSaved(id));

  async function toggleOffline() {
    offlineBusy = true;
    error = "";
    try {
      if (kept) await removeSetlistOffline(id);
      else await saveSetlistOffline(id);
    } catch (err) {
      error = kept || !(err instanceof Error) ? t("offline.failed") : t("offline.saveFailed");
    } finally {
      offlineBusy = false;
    }
  }

  function renameFocus() {
    const field = document.getElementById("setlist-name") as HTMLInputElement | null;
    field?.focus();
    field?.select();
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

<Page width="page">
  <section class="setlist-page">
    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

    {#if !loaded}
      <PageHeader
        title={t("setlists.heading")}
        backHref="/setlists"
        backLabel={t("setlists.nav")}
      />
    {/if}

    {#if loaded}
      <PageHeader
        title={name}
        eyebrow={t("setlists.nav")}
        {subtitle}
        subtitleTestId="setlist-subtitle"
        backHref="/setlists"
        backLabel={t("setlists.nav")}
      >
        {#snippet titleContent()}
          <label class="visually-hidden" for="setlist-name">{t("setlists.rename")}</label>
          <input
            id="setlist-name"
            class="setlist-name"
            data-testid="setlist-name"
            bind:value={name}
            maxlength="200"
            onchange={() => void commitName()}
            onkeydown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
        {/snippet}
        {#snippet actions()}
          <OverflowMenu
            label={t("primitives.more")}
            testid="setlist-overflow"
            items={[
              ...(offlineSupported()
                ? [
                    {
                      id: "offline",
                      label: offlineBusy
                        ? t("offline.working")
                        : kept
                          ? t("setlists.keptOffline")
                          : t("setlists.keepOffline"),
                      icon: kept ? "cloudCheck" : "cloudDownload",
                      testid: "setlist-offline",
                      disabled: offlineBusy,
                      onclick: () => void toggleOffline(),
                    },
                  ]
                : []),
              {
                id: "pdf",
                label: exporting ? t("setlists.exportingPdf") : t("setlists.exportPdf"),
                icon: "file",
                testid: "setlist-export-pdf",
                disabled: exporting || rows.length === 0,
                onclick: () => void exportPdf(),
              },
              {
                id: "rename",
                label: t("setlists.renameItem"),
                icon: "edit",
                testid: "setlist-rename",
                onclick: renameFocus,
              },
              {
                id: "delete",
                label: t("setlists.deleteItem"),
                icon: "trash",
                danger: true,
                testid: "setlist-delete",
                onclick: () => void removeSetlist(),
              },
            ]}
          />
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
        {/snippet}
      </PageHeader>

      <div class="section-head">
        <h2 class="section-title">{t("setlists.entries")}</h2>
        <button data-testid="setlist-add-open" onclick={() => (picking = true)}>
          <Icon name="plus" size={18} />{t("setlists.addHeading")}
        </button>
      </div>
      {#if rows.length === 0}
        <p class="muted" data-testid="setlist-entries-empty">{t("setlists.entriesEmpty")}</p>
      {:else}
        <p class="muted hint">{t("setlists.reorderHint")}</p>
        <ol class="entries" data-testid="setlist-entries">
          {#each rows as row, index (row.uid)}
            {@const song = songs.get(row.song_id)}
            <!-- Alt+arrows bubble up from the row's own buttons and fields. -->
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
              <Cover
                id={row.song_id}
                title={row.title}
                kind={row.content_kind}
                strings={row.string_count}
                size="sm"
                src={coverSrc(song?.cover_url)}
              />
              <div class="entry-main">
                <strong class="entry-title" data-testid="setlist-entry-title">{row.title}</strong>
                <span class="muted entry-artist">{row.artist || "—"}</span>
                {#if editingUid === row.uid}
                  <input
                    class="entry-note"
                    data-testid="setlist-entry-note"
                    bind:value={row.note}
                    maxlength="500"
                    placeholder={t("setlists.notePlaceholder")}
                    aria-label={t("setlists.note", { title: row.title })}
                    use:focusOnMount
                    onblur={() => endNote(row, true)}
                    onkeydown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      else if (event.key === "Escape") {
                        event.stopPropagation();
                        endNote(row, false);
                      }
                    }}
                  />
                {:else}
                  <button
                    type="button"
                    class="note-text"
                    class:empty={!row.note}
                    data-testid="setlist-entry-note-text"
                    onclick={() => editNote(row)}
                  >
                    {row.note || t("setlists.addNote")}<span class="visually-hidden">
                      ({row.title})</span
                    >
                  </button>
                {/if}
              </div>
              <div class="transpose-col">
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
              </div>
              <OverflowMenu
                label={t("setlists.rowMenu", { title: row.title })}
                testid="setlist-entry-menu"
                items={[
                  {
                    id: "up",
                    label: t("setlists.moveUpItem"),
                    icon: "chevronUp",
                    testid: "setlist-move-up",
                    disabled: index === 0,
                    onclick: () => void moveTo(index, index - 1, true),
                  },
                  {
                    id: "down",
                    label: t("setlists.moveDownItem"),
                    icon: "chevronDown",
                    testid: "setlist-move-down",
                    disabled: index === rows.length - 1,
                    onclick: () => void moveTo(index, index + 1, true),
                  },
                  {
                    id: "remove",
                    label: t("setlists.removeItem"),
                    icon: "close",
                    testid: "setlist-remove",
                    onclick: () => remove(index),
                  },
                ]}
              />
            </li>
          {/each}
        </ol>
      {/if}
      <p class="visually-hidden" role="status" aria-live="polite" data-testid="setlist-announce">
        {announcement}
      </p>

      <SongPickerSheet open={picking} {added} onadd={addSongs} onclose={() => (picking = false)} />
      {#if undo}
        <div class="toast" role="status" data-testid="setlist-undo-toast">
          <span>{t("setlists.removed", { title: undo.row.title })}</span>
          <button data-testid="setlist-undo" onclick={undoRemove}>{t("setlists.undo")}</button>
        </div>
      {/if}
    {:else if !error}
      <p class="muted" role="status">{t("app.loading")}</p>
    {/if}
  </section>
</Page>

<style>
  .setlist-name {
    width: 100%;
    max-width: 40rem;
    font-family: var(--font-display);
    font-size: var(--fs-display);
    font-weight: 400;
    line-height: 1.02;
    letter-spacing: -0.01em;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    padding: var(--sp-1) var(--sp-2);
    margin-left: calc(-1 * var(--sp-2));
  }
  .setlist-name:hover,
  .setlist-name:focus {
    border-color: var(--line-strong);
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    margin: var(--sp-6) 0 var(--sp-2);
  }
  .section-title {
    font-size: 1rem;
    margin: 0;
  }
  .entries {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--sp-2);
  }
  .entry {
    display: grid;
    grid-template-columns: auto 1.5rem auto minmax(0, 1fr) 7rem auto;
    align-items: center;
    gap: var(--sp-3);
    padding: var(--sp-2) var(--sp-3);
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
    text-align: right;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .entry-main {
    min-width: 0;
    display: grid;
    gap: var(--sp-1);
  }
  .entry-title,
  .entry-artist,
  .note-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .note-text {
    justify-self: start;
    max-width: 100%;
    min-height: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-2);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .note-text.empty {
    color: var(--text-3);
  }
  .note-text:hover {
    text-decoration: underline;
  }
  .entry-note {
    font-size: var(--fs-sm);
  }
  .transpose {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--sp-1);
  }
  .transpose-value {
    min-width: 2rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  @media (max-width: 640px) {
    .entry {
      grid-template-columns: 1.5rem auto minmax(0, 1fr) auto;
    }
    .grip {
      display: none;
    }
    .transpose-col {
      grid-column: 3 / 5;
      grid-row: 2;
    }
    .transpose-col:empty {
      display: none;
    }
    .transpose {
      justify-content: flex-start;
    }
  }
</style>
