<script lang="ts">
  import Sheet from "./Sheet.svelte";
  import { t } from "../lib/i18n.svelte";
  import { EDITOR_SHORTCUTS, SHORTCUTS } from "../lib/shortcuts";

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
  <h3 class="field-label">{t("editHistory.inEditor")}</h3>
  <dl class="shortcut-list" data-testid="editor-shortcuts">
    {#each EDITOR_SHORTCUTS as item (item.action)}
      <div>
        <dt><kbd>{item.label}</kbd></dt>
        <dd>{t(item.labelKey)}</dd>
      </div>
    {/each}
  </dl>
</Sheet>
