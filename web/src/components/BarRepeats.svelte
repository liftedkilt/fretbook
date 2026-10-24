<script lang="ts">
  import { untrack } from "svelte";

  import { t } from "../lib/i18n.svelte";
  import { DIRECTIONS } from "../lib/playback";
  import type { Bar, DirectionKind } from "../lib/types";

  // Repeat signs, voltas and navigation marks of one bar. It edits the bar in place.
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

<fieldset class="repeats" data-testid="bar-repeats">
  <legend>{t("repeats.heading")}</legend>
  <label class="field checkbox-field">
    <input
      type="checkbox"
      data-testid="repeat-start"
      checked={start}
      onchange={(event) => toggleStart(event.currentTarget.checked)}
    />
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
  <div class="field">
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
</fieldset>

<style>
  .repeats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem 1rem;
    align-items: flex-end;
    border: 1px solid var(--line, #8884);
    border-radius: var(--r-sm);
    padding: 0.5rem 0.75rem;
    margin: 0;
  }
  .repeats legend {
    font-size: 0.8rem;
    padding: 0 0.25rem;
  }
  .checkbox-field {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
  }
  .direction-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    align-items: center;
  }
  .direction-list .pill {
    cursor: pointer;
  }
</style>
