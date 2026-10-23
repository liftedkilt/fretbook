<script lang="ts">
  import Sheet from "./Sheet.svelte";
  import { t } from "../lib/i18n.svelte";
  import { SHORTCUTS } from "../lib/shortcuts";

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();
</script>

<Sheet {open} title={t("shortcuts.title")} testid="shortcut-help" {onclose}>
  <dl class="shortcut-list">
    {#each SHORTCUTS as item (item.action)}
      <div>
        <dt><kbd>{item.label}</kbd></dt>
        <dd>{t(item.labelKey)}</dd>
      </div>
    {/each}
  </dl>
</Sheet>
