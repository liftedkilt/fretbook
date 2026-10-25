<script lang="ts">
  import { untrack } from "svelte";

  import { t } from "../lib/i18n.svelte";
  import { DIRECTIONS } from "../lib/playback";
  import type { Bar, DirectionKind } from "../lib/types";

  // Repeat signs, voltas and jumps for one bar. The parent lays these out in the bar grid.
  let { bar }: { bar: Bar } = $props();

  let start = $state(untrack(() => bar.repeat_start ?? false));
  let repeatEnd = $state(untrack(() => bar.repeat_end ?? 0));
  let voltas = $state<number[]>(untrack(() => bar.alternate_endings ?? []));
  let directions = $state<DirectionKind[]>(untrack(() => bar.directions ?? []));

  $effect(() => {
    start = bar.repeat_start ?? false;
    repeatEnd = bar.repeat_end ?? 0;
    voltas = bar.alternate_endings ?? [];
    directions = bar.directions ?? [];
  });

  const available = $derived(DIRECTIONS.filter((kind) => !directions.includes(kind)));

  function toggleStart(checked: boolean) {
    start = checked;
    bar.repeat_start = checked;
  }

  function setPlays(raw: string) {
    const value = Math.trunc(Number(raw));
    const count = raw.trim() && value >= 2 ? Math.min(value, 32) : 0;
    repeatEnd = count;
    bar.repeat_end = count;
  }

  function setVolta(raw: string) {
    const passes = raw
      .split(/[\s,]+/)
      .map(Number)
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 31);
    const sorted = [...new Set(passes)].sort((a, b) => a - b);
    voltas = sorted;
    bar.alternate_endings = sorted;
  }

  function addDirection(kind: string) {
    if (kind) {
      const next = [...directions, kind as DirectionKind];
      directions = next;
      bar.directions = next;
    }
  }

  function removeDirection(kind: DirectionKind) {
    const next = directions.filter((item) => item !== kind);
    directions = next;
    bar.directions = next;
  }
</script>

<label class="switch">
  <input
    type="checkbox"
    data-testid="repeat-start"
    checked={start}
    onchange={(event) => toggleStart(event.currentTarget.checked)}
  />
  <span class="switch-track" aria-hidden="true"></span>
  <span>{t("repeats.start")}</span>
</label>
<label class="field">
  <span>{t("repeats.plays")}</span>
  <input
    type="number"
    min="2"
    max="32"
    placeholder="—"
    data-testid="repeat-end"
    value={repeatEnd ? repeatEnd : ""}
    onchange={(event) => setPlays(event.currentTarget.value)}
  />
</label>
<label class="field">
  <span>{t("repeats.volta")}</span>
  <input
    placeholder="1, 2"
    data-testid="repeat-volta"
    value={voltas.join(", ")}
    onchange={(event) => {
      setVolta(event.currentTarget.value);
      event.currentTarget.value = voltas.join(", ");
    }}
  />
</label>
<div class="field span-2">
  <span>{t("repeats.directions")}</span>
  <div class="direction-list">
    {#each directions as kind (kind)}
      <button
        class="pill pill-accent"
        type="button"
        title={t("repeats.remove")}
        aria-label={`${t("repeats.remove")}: ${t(`repeats.direction.${kind}`)}`}
        onclick={() => removeDirection(kind)}>{t(`repeats.direction.${kind}`)} ×</button
      >
    {/each}
    <select
      data-testid="repeat-direction"
      aria-label={t("repeats.addDirection")}
      value=""
      onchange={(event) => {
        addDirection(event.currentTarget.value);
        event.currentTarget.value = "";
      }}
    >
      <option value="">{t("repeats.addDirection")}</option>
      {#each available as kind (kind)}
        <option value={kind}>{t(`repeats.direction.${kind}`)}</option>
      {/each}
    </select>
  </div>
</div>

<style>
  .direction-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
    align-items: center;
  }

  .direction-list .pill {
    cursor: pointer;
  }

  .direction-list select {
    flex: 1 1 100%;
    min-width: 0;
  }
</style>
