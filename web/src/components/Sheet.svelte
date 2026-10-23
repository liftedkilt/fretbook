<script lang="ts">
  import type { Snippet } from "svelte";

  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";

  // A modal panel: centred on wide screens, a bottom sheet on phones. Stays in the DOM while closed,
  // so work started inside it (an import) keeps running.
  let {
    open,
    title,
    subtitle = "",
    testid,
    onclose,
    children,
  }: {
    open: boolean;
    title: string;
    subtitle?: string;
    testid?: string;
    onclose: () => void;
    children: Snippet;
  } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  class="sheet"
  data-testid={testid}
  bind:this={dialog}
  aria-label={title}
  onclose={() => {
    if (open) onclose();
  }}
  onclick={(event) => {
    // A click on the backdrop lands on the dialog itself.
    if (event.target === dialog) onclose();
  }}
>
  <div class="sheet-body">
    <span class="sheet-grabber" aria-hidden="true"></span>
    <header class="sheet-head">
      <div>
        <h2 class="display">{title}</h2>
        {#if subtitle}<p class="muted">{subtitle}</p>{/if}
      </div>
      <button class="icon-button ghost" onclick={onclose} aria-label={t("ui.close")}
        ><Icon name="close" /></button
      >
    </header>
    {@render children()}
  </div>
</dialog>
