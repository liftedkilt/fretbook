<script lang="ts">
  import { handsFree, resetPedals, setPedal, type PedalAction } from "../lib/handsFree.svelte";
  import { t } from "../lib/i18n.svelte";

  // Literal keys, so the catalog test can see every string this section shows.
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

  let open = $state(false);

  const summary = $derived.by(() => {
    const pairs = keys.map((key) => {
      const action = actions.find((item) => item.id === handsFree.pedals[key.id]);
      return t("settingsPage.pedalPair", {
        key: t(key.labelKey),
        action: t(action?.labelKey ?? "handsFree.actions.default"),
      });
    });
    const first = pairs[0] ?? "";
    return pairs.length > 1 ? `${first} · …` : first;
  });
</script>

<section class="pedals" data-testid="pedal-setting">
  <div class="intro">
    <h3 id="pedal-heading">{t("handsFree.pedalTitle")}</h3>
    <p class="hint">{t("handsFree.pedalHint")}</p>
  </div>
  <button
    type="button"
    class="ghost"
    aria-expanded={open}
    aria-controls="pedal-panel"
    data-testid="pedal-toggle"
    onclick={() => (open = !open)}
  >
    {open ? t("settingsPage.hidePedals") : t("settingsPage.showPedals")}
  </button>
  <div id="pedal-panel">
    {#if open}
      <div class="table-scroll">
        <table aria-labelledby="pedal-heading">
          <thead>
            <tr>
              <th scope="col">{t("settingsPage.pedalKey")}</th>
              <th scope="col">{t("settingsPage.pedalAction")}</th>
            </tr>
          </thead>
          <tbody>
            {#each keys as key (key.id)}
              <tr>
                <th scope="row">{t(key.labelKey)}</th>
                <td>
                  <select
                    aria-label={t(key.labelKey)}
                    data-testid={`pedal-${key.id}`}
                    value={handsFree.pedals[key.id]}
                    onchange={(event) => setPedal(key.id, event.currentTarget.value as PedalAction)}
                  >
                    {#each actions as action (action.id)}
                      <option value={action.id}>{t(action.labelKey)}</option>
                    {/each}
                  </select>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <button type="button" data-testid="pedal-reset" onclick={resetPedals}>
        {t("handsFree.reset")}
      </button>
    {:else}
      <p class="summary" data-testid="pedal-summary">{summary}</p>
    {/if}
  </div>
</section>

<style>
  .pedals {
    display: grid;
    gap: var(--sp-3);
  }

  .intro {
    display: grid;
    gap: var(--sp-2);
  }

  h3 {
    margin: 0;
    font-size: var(--fs-h3);
    font-weight: 600;
    line-height: 1.4;
  }

  .hint,
  .summary {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-sm);
    line-height: 1.45;
  }

  .table-scroll {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: var(--sp-2) var(--sp-3);
    border-bottom: 1px solid var(--line);
    text-align: left;
    vertical-align: middle;
  }

  thead th {
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    line-height: 1.4;
  }

  tbody th {
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  td select {
    min-width: calc(var(--sp-8) * 2 + var(--sp-6));
  }
</style>
