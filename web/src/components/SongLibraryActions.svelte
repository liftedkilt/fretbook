<script lang="ts">
  import Sheet from "./Sheet.svelte";
  import {
    copySongTo,
    createShare,
    listLibraries,
    listShares,
    moveSongTo,
    revokeShare,
  } from "../lib/api";
  import { sharePath, transferDestinations } from "../lib/bands";
  import { t } from "../lib/i18n.svelte";
  import { hrefFor, navigate } from "../lib/router.svelte";
  import type { LibraryInfo, ShareLink } from "../lib/types";
  import { refreshSongs, setActiveLibrary, ui } from "../lib/ui.svelte";

  // The share and copy-or-move sheets for a song. The song page's overflow menu opens them.
  let {
    songId,
    libraryId = "",
    shareOpen = $bindable(false),
    moveOpen = $bindable(false),
  }: { songId: string; libraryId?: string; shareOpen?: boolean; moveOpen?: boolean } = $props();

  let libraries = $state<LibraryInfo[]>([]);
  let shares = $state<ShareLink[]>([]);
  let days = $state("");
  let fresh = $state("");
  let destination = $state("");
  let error = $state("");
  let notice = $state("");
  let busy = $state(false);

  $effect(() => {
    if (!shareOpen) return;
    fresh = "";
    void loadShares().catch((err: unknown) => {
      error = err instanceof Error ? err.message : t("error.generic");
    });
  });

  $effect(() => {
    if (!moveOpen) return;
    const current = libraryId;
    void loadLibraries(current).catch((err: unknown) => {
      error = err instanceof Error ? err.message : t("error.generic");
    });
  });

  const destinations = $derived(transferDestinations(libraries, libraryId));

  async function loadShares() {
    if (!ui.shareLinks) return;
    shares = await listShares(songId);
  }

  async function loadLibraries(current: string | undefined) {
    const listed = await listLibraries();
    const choices = transferDestinations(listed, current);
    libraries = listed;
    if (!choices.some((item) => item.id === destination)) destination = choices[0]?.id ?? "";
  }

  async function makeLink() {
    busy = true;
    error = "";
    notice = "";
    try {
      const parsed = days.trim() ? Number(days) : null;
      const created = await createShare(songId, parsed);
      fresh = created.token ? `${location.origin}${hrefFor(sharePath(created.token))}` : "";
      notice = t("sharing.created");
      await loadShares();
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    } finally {
      busy = false;
    }
  }

  async function revoke(id: string) {
    busy = true;
    error = "";
    try {
      await revokeShare(songId, id);
      if (fresh) fresh = "";
      await loadShares();
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    } finally {
      busy = false;
    }
  }

  async function transfer(kind: "copy" | "move") {
    if (!destination) return;
    busy = true;
    error = "";
    try {
      const song =
        kind === "copy"
          ? await copySongTo(songId, destination)
          : await moveSongTo(songId, destination);
      const personal = libraries.find((item) => item.kind === "personal");
      setActiveLibrary(destination === personal?.id ? "" : destination);
      await refreshSongs();
      moveOpen = false;
      navigate(`/songs/${song.id}`);
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    } finally {
      busy = false;
    }
  }
</script>

<Sheet
  open={shareOpen}
  title={t("sharing.heading")}
  subtitle={t("sharing.hint")}
  testid="share-sheet"
  onclose={() => (shareOpen = false)}
>
  {#if error}<p class="alert" role="alert">{error}</p>{/if}
  {#if notice}<p class="muted" role="status">{notice}</p>{/if}
  {#if fresh}
    <p>
      <input data-testid="share-url" readonly value={fresh} aria-label={t("sharing.share")} />
      <button
        type="button"
        data-testid="share-copy"
        onclick={() =>
          void navigator.clipboard.writeText(fresh).then(() => (notice = t("sharing.copied")))}
      >
        {t("sharing.copy")}
      </button>
    </p>
  {/if}
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void makeLink();
    }}
  >
    <label>
      {t("sharing.expiry")}
      <input data-testid="share-days" inputmode="numeric" bind:value={days} />
    </label>
    <button class="primary" type="submit" data-testid="share-create" disabled={busy}
      >{t("sharing.create")}</button
    >
  </form>
  {#if shares.length === 0}
    <p class="muted">{t("sharing.none")}</p>
  {:else}
    <ul>
      {#each shares as share (share.id)}
        <li>
          <code>{share.prefix}…</code>
          {#if share.expires_at}<span>{share.expires_at}</span>{/if}
          <button type="button" disabled={busy} onclick={() => void revoke(share.id)}
            >{t("sharing.revoke")}</button
          >
        </li>
      {/each}
    </ul>
  {/if}
</Sheet>

<Sheet
  open={moveOpen}
  title={t("sharing.move")}
  subtitle={t("sharing.moveHint")}
  testid="move-sheet"
  onclose={() => (moveOpen = false)}
>
  {#if error}<p class="alert" role="alert">{error}</p>{/if}
  <label>
    {t("sharing.destination")}
    <select
      data-testid="move-destination"
      value={destination}
      onchange={(event) => {
        destination = event.currentTarget.value;
      }}
    >
      {#each destinations as library (library.id)}
        <option value={library.id}>
          {library.kind === "personal" ? t("bands.yours") : library.name}
        </option>
      {/each}
    </select>
  </label>
  <p class="button-row">
    <button
      type="button"
      data-testid="move-copy"
      disabled={busy || !destination}
      onclick={() => void transfer("copy")}
    >
      {t("sharing.copySong")}
    </button>
    <button
      type="button"
      data-testid="move-move"
      disabled={busy || !destination}
      onclick={() => void transfer("move")}
    >
      {t("sharing.moveSong")}
    </button>
  </p>
</Sheet>
