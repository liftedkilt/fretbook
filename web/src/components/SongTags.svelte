<script lang="ts">
  import { tick } from "svelte";

  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import { ui } from "../lib/ui.svelte";

  // A song's tags as small chips, and a "+ Tag" chip that opens an inline input.
  let {
    tags,
    locked = false,
    busy = false,
    onadd,
    onremove,
  }: {
    tags: string[];
    locked?: boolean;
    busy?: boolean;
    onadd: (tag: string) => void | Promise<void>;
    onremove: (tag: string) => void | Promise<void>;
  } = $props();

  let adding = $state(false);
  let draft = $state("");
  let input = $state<HTMLInputElement | null>(null);

  const suggestions = $derived(
    ui.tagList
      .map((item) => item.tag)
      .filter((tag) => !tags.some((own) => own.toLowerCase() === tag.toLowerCase())),
  );

  async function open() {
    adding = true;
    await tick();
    input?.focus();
  }

  function close() {
    adding = false;
    draft = "";
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    draft = "";
    await onadd(text);
    // Stay open so several tags can be typed in a row.
    input?.focus();
  }
</script>

{#if !locked || tags.length}
  <div class="song-tags" data-testid="song-tags">
    <ul class="tag-list" aria-label={t("tags.heading")}>
      {#each tags as tag (tag)}
        <li class="tag-chip" data-testid="song-tag">
          <Icon name="tag" size={12} />{tag}
          {#if !locked}<button
              type="button"
              class="tag-remove"
              data-testid="song-tag-remove"
              aria-label={t("tags.remove", { tag })}
              disabled={busy}
              onclick={() => void onremove(tag)}><Icon name="close" size={12} /></button
            >{/if}
        </li>
      {/each}
    </ul>
    {#if !locked}
      {#if adding}
        <form class="tag-add" onsubmit={(event) => void submit(event)}>
          <input
            bind:this={input}
            type="text"
            data-testid="song-tag-input"
            list="song-tag-suggestions"
            maxlength="40"
            bind:value={draft}
            placeholder={t("tags.addPlaceholder")}
            aria-label={t("tags.add")}
            onkeydown={(event) => {
              if (event.key === "Escape") close();
            }}
          />
          <datalist id="song-tag-suggestions">
            {#each suggestions as tag (tag)}<option value={tag}></option>{/each}
          </datalist>
          <button type="submit" class="tag-save" disabled={busy || !draft.trim()}
            >{t("tags.add")}</button
          >
          <button type="button" class="tag-cancel" onclick={close}>{t("songPage.cancelTag")}</button
          >
        </form>
      {:else}
        <button
          type="button"
          class="tag-new"
          data-testid="song-tag-new"
          onclick={() => void open()}
        >
          <Icon name="plus" size={12} />{t("songPage.addTag")}
        </button>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .song-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-1);
    min-width: 0;
  }

  .tag-list {
    display: contents;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .tag-chip,
  .tag-new {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    min-height: 24px;
    padding: 0 var(--sp-2);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--text-2);
    font-size: var(--fs-xs);
    line-height: 1.4;
  }

  .tag-chip {
    padding-right: var(--sp-1);
  }

  .tag-new {
    border-style: dashed;
    cursor: pointer;
  }

  .tag-new:hover {
    border-color: var(--line-strong);
    background: var(--surface-2);
    color: var(--text);
  }

  .tag-remove {
    display: grid;
    place-items: center;
    width: 20px;
    min-width: 20px;
    height: 20px;
    min-height: 20px;
    padding: 0;
    border: 0;
    border-radius: var(--r-pill);
    background: transparent;
    color: inherit;
  }

  .tag-add {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-1);
  }

  .tag-add input {
    width: 11rem;
    min-height: 32px;
  }

  .tag-save,
  .tag-cancel {
    min-height: 32px;
    padding: 0 var(--sp-3);
    font-size: var(--fs-sm);
  }

  /* Touch targets: the remove cross and the chips stay small to read, but not to tap. */
  @media (pointer: coarse) {
    .tag-chip,
    .tag-new {
      min-height: 32px;
    }

    .tag-remove {
      width: 28px;
      height: 28px;
    }
  }
</style>
