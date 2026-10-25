<script lang="ts">
  import Icon from "./Icon.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";

  // The one editor header: back to the song, the title, unsaved changes, and Save.
  // Play (tab) and Preview (chord sheet) are labelled buttons beside Save.
  let {
    songId,
    title,
    dirty,
    status,
    playHref = "",
    onPreview,
    previewPressed = false,
    onsave,
  }: {
    songId: string;
    title: string;
    dirty: boolean;
    status: string;
    /** Tab editor: a labelled Play link to the song. */
    playHref?: string;
    /** Chord editor: a labelled Preview button. */
    onPreview?: () => void;
    previewPressed?: boolean;
    onsave: () => void;
  } = $props();

  const saving = $derived(status === t("editor.saving"));
</script>

<div class="chrome">
  <PageHeader
    class="editor-header"
    title={title || t("editor.heading")}
    titleSize="title"
    titleTestId="editor-title"
    backHref={`/songs/${songId}`}
    backLabel={t("editor.backToSong")}
    backTestId="editor-back"
  >
    {#snippet actions()}
      {#if saving || (!dirty && status)}
        <span class="save-status" role="status" data-testid="editor-status">
          {#if !saving}<Icon name="check" size={16} />{/if}{status}
        </span>
      {:else if dirty}
        <span class="unsaved" role="status" data-testid="editor-unsaved">{t("editor.unsaved")}</span
        >
      {/if}
      {#if playHref}
        <a
          class="button secondary"
          data-testid="editor-play"
          href={hrefFor(playHref)}
          onclick={(event) => followLink(event, playHref)}
        >
          <Icon name="play" size={18} />{t("editor.play")}
        </a>
      {/if}
      {#if onPreview}
        <button
          type="button"
          class="secondary"
          data-testid="editor-preview"
          aria-pressed={previewPressed}
          onclick={onPreview}
        >
          <Icon name="eye" size={18} />{t("chords.preview")}
        </button>
      {/if}
      <button
        type="button"
        class="primary save"
        data-testid="editor-save"
        disabled={saving}
        onclick={onsave}
      >
        <Icon name="save" size={18} />{t("editor.save")}
      </button>
    {/snippet}
  </PageHeader>
</div>

<style>
  .chrome {
    position: sticky;
    top: var(--sp-3);
    z-index: 20;
    margin-bottom: var(--sp-2);
    padding: var(--sp-2) 0;
    background: var(--bg);
  }

  /* Clears the phone top bar (web/src/app.css .topbar). */
  @media (max-width: 767px) {
    .chrome {
      top: calc(58px + env(safe-area-inset-top, 0px));
    }
  }

  :global(.editor-header) {
    margin-bottom: 0;
  }

  .unsaved {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    color: var(--warn);
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
  }

  .unsaved::before {
    content: "";
    width: var(--sp-2);
    height: var(--sp-2);
    border-radius: 50%;
    background: var(--warn);
  }

  @media (max-width: 767px) {
    .save {
      margin-left: auto;
    }
  }

  .save-status {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    color: var(--success);
    font-size: var(--fs-sm);
    font-weight: 600;
    white-space: nowrap;
  }
</style>
