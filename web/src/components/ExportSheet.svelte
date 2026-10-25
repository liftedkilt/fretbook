<script lang="ts">
  import Icon from "./Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import { t } from "../lib/i18n.svelte";

  export type ExportItem = {
    id: string;
    label: string;
    icon: string;
    testid?: string;
    /** A download link. Without one the row is a button that runs `onclick`. */
    href?: string;
    disabled?: boolean;
    onclick?: () => void;
  };

  // The formats a song can be exported in, in a sheet so the overflow menu stays short.
  let {
    open,
    subtitle = "",
    items,
    onclose,
  }: { open: boolean; subtitle?: string; items: ExportItem[]; onclose: () => void } = $props();
</script>

<Sheet {open} title={t("songPage.exportTitle")} {subtitle} testid="export-sheet" {onclose}>
  <ul class="export-list">
    {#each items as item (item.id)}
      <li>
        {#if item.href}
          <a class="row" data-testid={item.testid} href={item.href} onclick={onclose}>
            <Icon name={item.icon} size={18} />{item.label}
          </a>
        {:else}
          <button
            type="button"
            class="row"
            data-testid={item.testid}
            disabled={item.disabled}
            onclick={() => {
              onclose();
              item.onclick?.();
            }}
          >
            <Icon name={item.icon} size={18} />{item.label}
          </button>
        {/if}
      </li>
    {/each}
  </ul>
</Sheet>

<style>
  .export-list {
    display: grid;
    gap: var(--sp-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: var(--sp-3);
    width: 100%;
    min-height: 48px;
    padding: 0 var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
    background: var(--surface-2);
    color: var(--text);
    font-size: var(--fs-body);
    text-align: left;
    text-decoration: none;
  }

  .row:hover:not(:disabled) {
    background: var(--surface-3);
  }
</style>
