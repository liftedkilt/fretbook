<script lang="ts">
  import Sheet from "./Sheet.svelte";
  import { deleteTag, renameTag } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { refreshSongs, ui } from "../lib/ui.svelte";

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  let editing = $state("");
  let name = $state("");
  let deleting = $state("");
  let notice = $state("");
  let error = $state("");
  let busy = $state(false);

  const merges = $derived(
    editing !== "" &&
      name.trim() !== "" &&
      ui.tagList.some(
        (item) =>
          item.tag.toLowerCase() === name.trim().toLowerCase() &&
          item.tag.toLowerCase() !== editing.toLowerCase(),
      ),
  );

  function startRename(tag: string) {
    editing = tag;
    name = tag;
    deleting = "";
    error = "";
  }

  async function run(action: () => Promise<string>) {
    busy = true;
    error = "";
    try {
      notice = await action();
      editing = "";
      deleting = "";
      await refreshSongs();
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    } finally {
      busy = false;
    }
  }

  function save() {
    const tag = editing;
    const next = name.trim();
    if (!next) return;
    void run(async () => {
      const count = await renameTag(tag, next);
      return t("manageTags.renamed", { tag, name: next, count });
    });
  }

  function remove() {
    const tag = deleting;
    void run(async () => {
      const count = await deleteTag(tag);
      return t("manageTags.deleted", { tag, count });
    });
  }

  function countOf(tag: string): number {
    return ui.tagList.find((item) => item.tag === tag)?.count ?? 0;
  }
</script>

<Sheet
  {open}
  title={t("manageTags.title")}
  subtitle={t("manageTags.hint")}
  testid="manage-tags"
  {onclose}
>
  {#if notice}<p class="muted" role="status" data-testid="manage-tags-notice">{notice}</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if ui.tagList.length === 0}
    <p class="muted">{t("manageTags.empty")}</p>
  {:else}
    <ul class="manage-tags" aria-label={t("manageTags.list")}>
      {#each ui.tagList as item (item.tag)}
        <li data-testid="manage-tag">
          {#if editing === item.tag}
            <form
              onsubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <input
                data-testid="manage-tag-name"
                bind:value={name}
                maxlength="40"
                aria-label={t("manageTags.newName", { tag: item.tag })}
              />
              <button class="primary" data-testid="manage-tag-save" disabled={busy || !name.trim()}>
                {t("manageTags.save")}
              </button>
              <button type="button" onclick={() => (editing = "")}>{t("manageTags.cancel")}</button>
              {#if merges}<p class="muted" data-testid="manage-tag-merge">
                  {t("manageTags.mergeHint")}
                </p>{/if}
            </form>
          {:else if deleting === item.tag}
            <span>{t("manageTags.confirmDelete", { tag: item.tag, count: item.count })}</span>
            <button
              class="danger"
              data-testid="manage-tag-confirm"
              disabled={busy}
              onclick={remove}
            >
              {t("manageTags.confirm")}
            </button>
            <button onclick={() => (deleting = "")}>{t("manageTags.cancel")}</button>
          {:else}
            <span class="manage-tag-name">{item.tag}</span>
            <span class="muted">{t("manageTags.songs", { count: countOf(item.tag) })}</span>
            <button
              data-testid="manage-tag-rename"
              aria-label={t("manageTags.renameOrMerge", { tag: item.tag })}
              onclick={() => startRename(item.tag)}>{t("manageTags.rename")}</button
            >
            <button
              data-testid="manage-tag-delete"
              aria-label={t("manageTags.deleteTag", { tag: item.tag })}
              onclick={() => {
                deleting = item.tag;
                editing = "";
                error = "";
              }}>{t("manageTags.delete")}</button
            >
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Sheet>
