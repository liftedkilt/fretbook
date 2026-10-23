<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import { classifyPaste } from "../lib/sniff";

  export type AddInput = { file: File } | { text: string } | { url: string };

  let { busy, onadd }: { busy: boolean; onadd: (input: AddInput) => void } = $props();

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
    ondrop={(event) => {
      event.preventDefault();
      dragging = false;
      const file = event.dataTransfer?.files?.[0];
      if (file && !busy) onadd({ file });
    }}
  >
    <span class="dropzone-icon"><Icon name="upload" size={28} /></span>
    <strong>{t("universal.drop")}</strong>
    <small class="muted">{t("universal.hint")}</small>
    <span class="button">{t("universal.browse")}</span>
    <input
      class="visually-hidden"
      data-testid="any-file-input"
      type="file"
      disabled={busy}
      onchange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file) onadd({ file });
      }}
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
