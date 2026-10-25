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

  let {
    busy,
    onadd,
    duplicates = "skip",
  }: { busy: boolean; onadd: (input: AddInput) => void; duplicates?: DuplicateAction } = $props();

  let value = $state("");
  let dragging = $state(false);
  let empty = $state(false);

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
    <span class="button primary">{t("universal.browse")}</span>
    <input
      class="visually-hidden"
      data-testid="any-file-input"
      type="file"
      multiple
      disabled={busy}
      onchange={handleFileSelect}
    />
  </label>

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
