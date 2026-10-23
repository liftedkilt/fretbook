<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import { classifyPaste } from "../lib/sniff";
  import { extractDroppedFiles } from "../lib/bulkImport";
  import type { DuplicateAction } from "../lib/types";

  export type AddInput =
    | { file: File; duplicates?: DuplicateAction; tags?: string }
    | { files: File[]; duplicates?: DuplicateAction; tags?: string }
    | { text: string }
    | { url: string };

  let { busy, onadd }: { busy: boolean; onadd: (input: AddInput) => void } = $props();

  let value = $state("");
  let dragging = $state(false);
  let empty = $state(false);
  let duplicates = $state<DuplicateAction>("skip");

  function submit() {
    const found = classifyPaste(value);
    empty = !found;
    if (found) onadd(found);
  }

  function pasted(event: ClipboardEvent) {
    const file = event.clipboardData?.files?.[0];
    if (!file || busy) return;
    event.preventDefault();
    onadd({ file });
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    dragging = false;
    if (busy || !event.dataTransfer) return;
    const files = await extractDroppedFiles(event.dataTransfer);
    if (files.length === 0) return;
    if (files.length === 1 && !files[0].name.toLowerCase().endsWith(".zip")) {
      onadd({ file: files[0] });
    } else {
      onadd({ files, duplicates });
    }
  }

  function handleFileSelect(event: Event & { currentTarget: HTMLInputElement }) {
    const fileList = event.currentTarget.files;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    event.currentTarget.value = "";
    if (files.length === 1 && !files[0].name.toLowerCase().endsWith(".zip")) {
      onadd({ file: files[0] });
    } else {
      onadd({ files, duplicates });
    }
  }
</script>

<form
  class="form-grid"
  onsubmit={(event) => {
    event.preventDefault();
    submit();
  }}
>
  <label
    class="dropzone span-2"
    class:dragging
    ondragover={(event) => {
      event.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={handleDrop}
  >
    <span class="dropzone-icon"><Icon name="upload" size={28} /></span>
    <strong>{t("universal.drop")}</strong>
    <small class="muted">{t("bulk.dropHint")}</small>
    <span class="button">{t("universal.browse")}</span>
    <input
      class="visually-hidden"
      data-testid="any-file-input"
      type="file"
      multiple
      disabled={busy}
      onchange={handleFileSelect}
    />
  </label>

  <div class="span-2 duplicate-bar">
    <span class="duplicate-label">{t("bulk.duplicates")}:</span>
    <div class="duplicate-radios">
      <label class="radio-label">
        <input type="radio" bind:group={duplicates} value="skip" data-testid="dup-skip" />
        <span>{t("bulk.skip")}</span>
      </label>
      <label class="radio-label">
        <input type="radio" bind:group={duplicates} value="keep_both" data-testid="dup-keep" />
        <span>{t("bulk.keepBoth")}</span>
      </label>
      <label class="radio-label">
        <input type="radio" bind:group={duplicates} value="replace" data-testid="dup-replace" />
        <span>{t("bulk.replace")}</span>
      </label>
    </div>
  </div>

  <label class="field span-2">
    <span>{t("universal.heading")}</span>
    <textarea
      data-testid="any-text"
      bind:value
      rows="6"
      spellcheck="false"
      placeholder={t("universal.placeholder")}
      onpaste={pasted}
      oninput={() => (empty = false)}></textarea>
  </label>
  <p class="muted span-2" data-testid="any-supported">{t("universal.supported")}</p>
  {#if empty}<p class="alert span-2" role="alert" data-testid="any-empty">
      <Icon name="alert" size={18} />{t("universal.empty")}
    </p>{/if}
  <div class="span-2 form-actions">
    <button class="primary" type="submit" data-testid="any-submit" disabled={busy}>
      <Icon name="check" size={18} />{t("universal.submit")}
    </button>
  </div>
</form>

<style>
  .duplicate-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0.75rem;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    font-size: 0.875rem;
  }

  .duplicate-label {
    font-weight: 500;
    color: var(--muted);
  }

  .duplicate-radios {
    display: flex;
    gap: 1rem;
  }

  .radio-label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    cursor: pointer;
  }
</style>
