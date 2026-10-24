<script lang="ts">
  import Icon from "./Icon.svelte";
  import { handsFree, resetPedals, setPedal, type PedalAction } from "../lib/handsFree.svelte";
  import { t } from "../lib/i18n.svelte";

  // Literal keys, so the catalog test can see every string this sheet shows.
  const keys = [
    { id: "PageDown", labelKey: "handsFree.keys.PageDown" },
    { id: "PageUp", labelKey: "handsFree.keys.PageUp" },
    { id: "ArrowDown", labelKey: "handsFree.keys.ArrowDown" },
    { id: "ArrowUp", labelKey: "handsFree.keys.ArrowUp" },
    { id: "ArrowRight", labelKey: "handsFree.keys.ArrowRight" },
    { id: "ArrowLeft", labelKey: "handsFree.keys.ArrowLeft" },
  ];
  const actions: { id: PedalAction; labelKey: string }[] = [
    { id: "default", labelKey: "handsFree.actions.default" },
    { id: "nextPage", labelKey: "handsFree.actions.nextPage" },
    { id: "previousPage", labelKey: "handsFree.actions.previousPage" },
    { id: "toggle", labelKey: "handsFree.actions.toggle" },
    { id: "loop", labelKey: "handsFree.actions.loop" },
    { id: "nextSong", labelKey: "handsFree.actions.nextSong" },
    { id: "previousSong", labelKey: "handsFree.actions.previousSong" },
  ];
</script>

<section class="setting setting-stacked" data-testid="pedal-setting">
  <div class="setting-label">
    <span class="setting-icon"><Icon name="follow" /></span>
    <div>
      <strong>{t("handsFree.pedalTitle")}</strong>
      <p class="muted">{t("handsFree.pedalHint")}</p>
    </div>
  </div>
  <div class="pedal-grid">
    {#each keys as key (key.id)}
      <label class="pedal-row">
        <span>{t(key.labelKey)}</span>
        <select
          data-testid={`pedal-${key.id}`}
          value={handsFree.pedals[key.id]}
          onchange={(event) => setPedal(key.id, event.currentTarget.value as PedalAction)}
        >
          {#each actions as action (action.id)}
            <option value={action.id}>{t(action.labelKey)}</option>
          {/each}
        </select>
      </label>
    {/each}
    <button data-testid="pedal-reset" onclick={resetPedals}>{t("handsFree.reset")}</button>
  </div>
</section>

<style>
  .pedal-grid {
    display: grid;
    gap: 0.5rem;
  }

  .pedal-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(160px, 220px);
    align-items: center;
    gap: 1rem;
  }
</style>
