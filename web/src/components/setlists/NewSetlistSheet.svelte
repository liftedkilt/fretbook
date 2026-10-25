<script lang="ts">
  import Icon from "../Icon.svelte";
  import Sheet from "../Sheet.svelte";
  import { t } from "../../lib/i18n.svelte";

  let {
    open,
    error = "",
    onsubmit,
    onclose,
  }: {
    open: boolean;
    error?: string;
    onsubmit: (name: string) => void;
    onclose: () => void;
  } = $props();

  let name = $state("");

  $effect(() => {
    if (open) name = "";
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    const next = name.trim();
    if (next) onsubmit(next);
  }
</script>

<Sheet {open} title={t("setlists.newTitle")} testid="setlist-new-sheet" {onclose}>
  <form class="new" onsubmit={submit}>
    <label class="visually-hidden" for="new-setlist">{t("setlists.newLabel")}</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      id="new-setlist"
      data-testid="setlist-new-name"
      bind:value={name}
      maxlength="200"
      placeholder={t("setlists.newPlaceholder")}
      autofocus
    />
    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
    <div class="footer">
      <button type="button" onclick={onclose}>{t("setlists.cancel")}</button>
      <button class="primary" type="submit" data-testid="setlist-create" disabled={!name.trim()}>
        {t("setlists.create")}
      </button>
    </div>
  </form>
</Sheet>

<style>
  .new {
    display: grid;
    gap: var(--sp-3);
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-2);
  }
</style>
