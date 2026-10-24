<script lang="ts">
  import Icon from "./Icon.svelte";
  import { setSongTags } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import type { SongDetail } from "../lib/types";
  import { refreshSongs, starSong, ui } from "../lib/ui.svelte";

  let { song, readOnly = false }: { song: SongDetail; readOnly?: boolean } = $props();
  const locked = $derived(ui.demoMode || readOnly);

  // The page keys this component by song id, so the starting values are the song's.
  // svelte-ignore state_referenced_locally
  let tags = $state<string[]>([...song.tags]);
  // svelte-ignore state_referenced_locally
  let favourite = $state(song.favourite);
  let draft = $state("");
  let error = $state("");
  let busy = $state(false);

  const suggestions = $derived(
    ui.tagList
      .map((item) => item.tag)
      .filter((tag) => !tags.some((own) => own.toLowerCase() === tag.toLowerCase())),
  );

  async function save(next: string[]) {
    busy = true;
    error = "";
    try {
      tags = await setSongTags(song.id, next);
      await refreshSongs().catch(() => undefined); // offline: the change is queued
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    } finally {
      busy = false;
    }
  }

  async function add() {
    const text = draft.trim();
    if (!text) return;
    draft = "";
    await save([...tags, text]);
  }

  async function toggleStar() {
    const next = !favourite;
    error = "";
    try {
      await starSong(song.id, next);
      favourite = next;
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }
</script>

{#if !locked || tags.length}
  <div class="song-tags" data-testid="song-tags">
    {#if !locked}<button
        class="icon-button glass song-star"
        class:on={favourite}
        data-testid="song-favourite"
        aria-pressed={favourite}
        aria-label={favourite ? t("tags.unfavourite") : t("tags.favourite")}
        title={favourite ? t("tags.unfavourite") : t("tags.favourite")}
        onclick={() => void toggleStar()}
      >
        <Icon name={favourite ? "starFilled" : "star"} size={18} />
      </button>{/if}
    <ul class="tag-list" aria-label={t("tags.heading")}>
      {#each tags as tag (tag)}
        <li class="tag-pill" data-testid="song-tag">
          <Icon name="tag" size={13} />{tag}
          {#if !locked}<button
              class="tag-remove"
              data-testid="song-tag-remove"
              aria-label={t("tags.remove", { tag })}
              disabled={busy}
              onclick={() => void save(tags.filter((own) => own !== tag))}
              ><Icon name="close" size={12} /></button
            >{/if}
        </li>
      {/each}
    </ul>
    {#if !locked}<form
        class="tag-add"
        onsubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <input
          type="text"
          data-testid="song-tag-input"
          list="song-tag-suggestions"
          maxlength="40"
          bind:value={draft}
          placeholder={t("tags.addPlaceholder")}
          aria-label={t("tags.add")}
        />
        <datalist id="song-tag-suggestions">
          {#each suggestions as tag (tag)}<option value={tag}></option>{/each}
        </datalist>
        <button type="submit" disabled={busy || !draft.trim()}>{t("tags.add")}</button>
      </form>{/if}
    {#if error}<p class="alert" role="alert">{error}</p>{/if}
  </div>
{/if}
