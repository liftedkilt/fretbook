<script lang="ts">
  import type { Snippet } from "svelte";

  import Cover from "./Cover.svelte";
  import ExportSheet, { type ExportItem } from "./ExportSheet.svelte";
  import Icon from "./Icon.svelte";
  import SongLibraryActions from "./SongLibraryActions.svelte";
  import SongMetadata from "./SongMetadata.svelte";
  import SongTags from "./SongTags.svelte";
  import Chip from "./ui/Chip.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import OverflowMenu, { type OverflowItem } from "./ui/OverflowMenu.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import { deleteSong, setSongTags } from "../lib/api";
  import { coverSrc } from "../lib/cover";
  import { levelOf } from "../lib/difficulty";
  import { t } from "../lib/i18n.svelte";
  import { keyLabel } from "../lib/keys";
  import { isSongSaved, removeSongOffline, saveSongOffline } from "../lib/offline/offline.svelte";
  import { offlineSupported } from "../lib/offline/store";
  import { followLink, hrefFor, navigate } from "../lib/router.svelte";
  import type { SongDetail } from "../lib/types";
  import { refreshSongs, starSong, ui } from "../lib/ui.svelte";

  export type Fact = {
    label: string;
    testid?: string;
    title?: string;
    accent?: boolean;
    icon?: string;
  };

  // The header shared by the tab player and the chord sheet: back link, cover, eyebrow, title, one
  // row of facts and tags, and the actions. Everything else lives in the "⋯" menu. On a phone the
  // header shrinks to a back link, the star and "⋯", then a small cover beside the title and one
  // line of facts; the tags and facts move into the Song details sheet.
  let {
    song,
    readOnly = false,
    eyebrow,
    strings = 6,
    facts = [],
    factsAfter = [],
    onretune,
    ontuner,
    onsetlist,
    exportItems,
    afterFacts,
  }: {
    song: SongDetail;
    readOnly?: boolean;
    /** The instrument or "Chord sheet", shown before the artist. */
    eyebrow: string;
    strings?: number;
    /** Facts before the key (tuning, capo, tempo) and after it (bars, audio). */
    facts?: Fact[];
    factsAfter?: Fact[];
    /** Only a tab can be transposed or retuned. */
    onretune?: () => void;
    ontuner?: () => void;
    onsetlist: () => void;
    exportItems: ExportItem[];
    /** Rendered under the facts, for example the song's saved loops. */
    afterFacts?: Snippet;
  } = $props();

  const locked = $derived(ui.demoMode || readOnly);

  // The page keys this component by song id, so the starting values are the song's.
  // svelte-ignore state_referenced_locally
  let tags = $state<string[]>([...(song.tags ?? [])]);
  // svelte-ignore state_referenced_locally
  let favourite = $state(Boolean(song.favourite));
  let busy = $state(false);
  let error = $state("");
  let detailsOpen = $state(false);
  let exportOpen = $state(false);
  let shareOpen = $state(false);
  let moveOpen = $state(false);

  const PHONE_QUERY = "(max-width: 767px), (max-height: 500px) and (pointer: coarse)";
  let phone = $state(typeof matchMedia !== "undefined" && matchMedia(PHONE_QUERY).matches);
  $effect(() => {
    if (typeof matchMedia === "undefined") return;
    const query = matchMedia(PHONE_QUERY);
    const update = () => (phone = query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  });

  const saved = $derived(isSongSaved(song.id));
  const track = $derived(
    (song.difficulty_tracks ?? []).find(
      (item) =>
        item.track_id === (song.content_kind === "chords" ? "chords" : song.preferred_track_id),
    ),
  );
  const keyFact = $derived<Fact | null>(
    song.key
      ? {
          label: keyLabel(song.key, t),
          testid: "song-key",
          accent: true,
          title: song.key_detected
            ? t("metadata.keyDetected", { key: keyLabel(song.key, t) })
            : undefined,
        }
      : null,
  );
  const levelFact = $derived<Fact | null>(
    track
      ? { label: t("songPage.level", { level: levelOf(track.level) }), testid: "song-level" }
      : null,
  );
  const allFacts = $derived<Fact[]>([
    ...facts,
    ...(keyFact ? [keyFact] : []),
    ...factsAfter,
    ...(levelFact ? [levelFact] : []),
  ]);
  const savedFact = $derived<Fact | null>(
    saved ? { label: t("offline.saved"), testid: "offline-saved", icon: "cloudCheck" } : null,
  );

  function fail(err: unknown) {
    error = err instanceof Error ? err.message : t("error.generic");
  }

  async function saveTags(next: string[]) {
    busy = true;
    error = "";
    try {
      tags = await setSongTags(song.id, next);
      await refreshSongs().catch(() => undefined); // offline: the change is queued
    } catch (err) {
      fail(err);
    } finally {
      busy = false;
    }
  }

  async function toggleStar() {
    const next = !favourite;
    error = "";
    try {
      await starSong(song.id, next);
      favourite = next;
    } catch (err) {
      fail(err);
    }
  }

  async function toggleOffline() {
    busy = true;
    error = "";
    try {
      if (saved) await removeSongOffline(song.id);
      else await saveSongOffline(song.id, song.title);
    } catch (err) {
      error = saved || !(err instanceof Error) ? t("offline.failed") : t("offline.saveFailed");
    } finally {
      busy = false;
    }
  }

  async function remove() {
    if (!confirm(t("library.confirmDelete", { title: song.title }))) return;
    try {
      await deleteSong(song.id);
      await refreshSongs().catch(() => undefined);
      navigate("/");
    } catch (err) {
      fail(err);
    }
  }

  const editHref = $derived(`/songs/${song.id}/edit`);
  const canEdit = $derived(!ui.demoMode && !readOnly);

  const items = $derived.by<OverflowItem[]>(() => {
    const list: OverflowItem[] = [];
    if (phone && onretune && !readOnly)
      list.push({
        id: "transpose",
        label: t("songPage.transpose"),
        icon: "sliders",
        testid: "song-retune",
        onclick: onretune,
      });
    if (phone && canEdit)
      list.push({
        id: "edit",
        label: t("player.edit"),
        icon: "edit",
        href: hrefFor(editHref),
        testid: "song-edit-link",
        onclick: () => navigate(editHref),
      });
    if (!readOnly && offlineSupported())
      list.push({
        id: "offline",
        label: saved ? t("songPage.removeFromDevice") : t("songPage.keepOnDevice"),
        icon: saved ? "cloudCheck" : "cloudDownload",
        testid: "offline-toggle",
        disabled: busy,
        onclick: () => void toggleOffline(),
      });
    if (!readOnly)
      list.push({
        id: "export",
        label: t("songPage.export"),
        icon: "download",
        testid: "export-open",
        onclick: () => (exportOpen = true),
      });
    if (!readOnly && !ui.demoMode)
      list.push({
        id: "setlist",
        label: t("setlists.addToSetlist"),
        icon: "listMusic",
        testid: "song-add-to-setlist",
        onclick: onsetlist,
      });
    if (ontuner)
      list.push({
        id: "tuner",
        label: t("tuner.open"),
        icon: "tuningFork",
        testid: "song-tuner",
        onclick: ontuner,
      });
    if (!readOnly && ui.shareLinks)
      list.push({
        id: "share",
        label: t("sharing.share"),
        icon: "link",
        testid: "song-share",
        onclick: () => (shareOpen = true),
      });
    if (!readOnly)
      list.push({
        id: "move",
        label: t("sharing.move"),
        icon: "library",
        testid: "song-move",
        onclick: () => (moveOpen = true),
      });
    if (!locked || phone)
      list.push({
        id: "details",
        label: t("songPage.songDetails"),
        icon: "info",
        testid: "song-metadata-edit",
        onclick: () => (detailsOpen = true),
      });
    if (!locked)
      list.push({
        id: "delete",
        label: t("songPage.delete"),
        icon: "trash",
        testid: "song-delete",
        danger: true,
        onclick: () => void remove(),
      });
    return list;
  });

  const artistLine = $derived(
    phone
      ? [eyebrow, song.artist, ...allFacts.map((fact) => fact.label)].filter(Boolean).join(" · ")
      : "",
  );
</script>

<PageHeader
  class="song-header"
  title={song.title}
  titleTestId="song-heading"
  titleClass="song-heading"
  eyebrow={phone ? "" : [eyebrow, song.artist].filter(Boolean).join(" · ")}
  subtitle={artistLine}
  backHref={readOnly ? "" : "/"}
  backLabel={readOnly ? "" : t("app.back")}
>
  {#snippet leading()}
    <Cover
      id={song.id}
      title={song.title}
      kind={song.content_kind === "chords" ? "chords" : "tab"}
      {strings}
      size="lg"
      src={coverSrc(song.cover_url)}
    />
  {/snippet}
  {#snippet actions()}
    <div class="header-actions">
      {#if !locked}
        <IconButton
          class={favourite ? "song-star on" : "song-star"}
          icon={favourite ? "starFilled" : "star"}
          label={favourite ? t("tags.unfavourite") : t("tags.favourite")}
          testid="song-favourite"
          pressed={favourite}
          onclick={() => void toggleStar()}
        />
      {/if}
      {#if !phone && onretune && !readOnly}
        <button type="button" class="button" data-testid="song-retune" onclick={onretune}>
          {t("songPage.transpose")}
        </button>
      {/if}
      {#if !phone && canEdit}
        <a
          class="button"
          data-testid="song-edit-link"
          href={hrefFor(editHref)}
          onclick={(event) => followLink(event, editHref)}
        >
          <Icon name="edit" size={18} /><span>{t("player.edit")}</span>
        </a>
      {/if}
      {#if items.length > 0}
        <OverflowMenu label={t("primitives.more")} {items} testid="song-more" />
      {/if}
    </div>
  {/snippet}
  {#snippet below()}
    {#if !phone}
      <div class="facts">
        {#each allFacts as fact (fact.label)}
          <Chip
            variant="meta"
            label={fact.label}
            testid={fact.testid}
            title={fact.title}
            accent={fact.accent}
            icon={fact.icon}
          />
        {/each}
        {#if savedFact}
          <Chip
            variant="meta"
            accent
            label={savedFact.label}
            icon={savedFact.icon}
            testid={savedFact.testid}
          />
        {/if}
        <SongTags
          {tags}
          {locked}
          {busy}
          onadd={(tag) => saveTags([...tags, tag])}
          onremove={(tag) => saveTags(tags.filter((own) => own !== tag))}
        />
      </div>
    {/if}
    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
    {#if afterFacts}{@render afterFacts()}{/if}
  {/snippet}
</PageHeader>

<SongMetadata
  {song}
  {readOnly}
  bind:open={detailsOpen}
  onchange={(next) => {
    Object.assign(song, {
      key: next.key,
      key_detected: next.key_detected,
      genre: next.genre,
      album: next.album,
      year: next.year,
      notes: next.notes,
      cover_url: next.cover_url,
    });
  }}
>
  {#snippet extra()}
    {#if phone}
      <div class="facts">
        {#each allFacts as fact (fact.label)}
          <Chip
            variant="meta"
            label={fact.label}
            title={fact.title}
            accent={fact.accent}
            icon={fact.icon}
          />
        {/each}
      </div>
      <SongTags
        {tags}
        {locked}
        {busy}
        onadd={(tag) => saveTags([...tags, tag])}
        onremove={(tag) => saveTags(tags.filter((own) => own !== tag))}
      />
    {/if}
  {/snippet}
</SongMetadata>

{#if !readOnly}
  <SongLibraryActions
    songId={song.id}
    libraryId={song.library_id ?? ""}
    bind:shareOpen
    bind:moveOpen
  />
  <ExportSheet
    open={exportOpen}
    subtitle={song.title}
    items={exportItems}
    onclose={() => (exportOpen = false)}
  />
{/if}

<style>
  .header-actions {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .facts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-2);
    min-width: 0;
  }

  /* The header is a compact block here: tight under the back link, and the cover is a thumbnail
     beside the title instead of the hero art. */
  :global(.page-header.song-header) {
    margin-bottom: var(--sp-4);
  }

  :global(.page-header.song-header .back) {
    min-height: 40px;
  }

  :global(.page-header.song-header .cover) {
    width: 120px;
    border-radius: var(--r-md);
  }

  :global(.page-header.song-header .eyebrow) {
    margin: 0;
  }

  @media (max-width: 767px), (max-height: 500px) and (pointer: coarse) {
    :global(.page-header.song-header) {
      position: relative;
      gap: var(--sp-1);
      margin-bottom: var(--sp-3);
    }

    :global(.page-header.song-header .row) {
      flex-wrap: nowrap;
    }

    :global(.page-header.song-header .identity) {
      flex-wrap: nowrap;
      align-items: center;
      gap: var(--sp-3);
      min-width: 0;
    }

    /* The actions sit on the back link's row, at the right. */
    :global(.page-header.song-header .actions) {
      position: absolute;
      top: 0;
      right: 0;
      width: auto;
    }

    :global(.page-header.song-header .cover) {
      width: 48px;
      border-radius: var(--r-sm);
    }

    :global(.page-header.song-header .cover-mono) {
      inset: 0;
      display: grid;
      place-items: center;
      font-size: 1.05rem;
    }

    :global(.page-header.song-header .cover-art) {
      display: none;
    }

    :global(.page-header.song-header h1) {
      overflow: hidden;
      font-size: var(--fs-title);
      line-height: 1.1;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    :global(.page-header.song-header .subtitle) {
      overflow: hidden;
      font-size: var(--fs-sm);
      line-height: 1.45;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  /* Full screen keeps only the score and the dock. */
  :global(:root[data-fullscreen]) .header-actions {
    display: none;
  }
</style>
