<script lang="ts">
  import Icon from "../Icon.svelte";
  import { t } from "../../lib/i18n.svelte";

  let {
    minutes,
    weekly,
    onchange,
  }: {
    minutes: number;
    weekly: boolean;
    /** Called as soon as a value changes: there is no Save button. */
    onchange: (goal: { daily_minutes: number; weekly_summary: boolean }) => void;
  } = $props();

  let open = $state(false);
  let root = $state<HTMLDivElement | null>(null);
  const popoverId = `goal-${Math.random().toString(36).slice(2, 8)}`;

  function close(restore = true) {
    open = false;
    if (restore) queueMicrotask(() => root?.querySelector<HTMLElement>(".chip")?.focus());
  }

  function setMinutes(event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    onchange({
      daily_minutes: Math.max(0, Math.min(720, Math.round(Number.isFinite(value) ? value : 0))),
      weekly_summary: weekly,
    });
  }

  function setWeekly(event: Event) {
    onchange({
      daily_minutes: minutes,
      weekly_summary: (event.currentTarget as HTMLInputElement).checked,
    });
  }

  $effect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (root && !root.contains(event.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  });
</script>

<div
  class="goal"
  bind:this={root}
  role="presentation"
  onkeydown={(event) => {
    if (open && event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  }}
>
  <button
    type="button"
    class="chip"
    data-testid="practice-goal-chip"
    aria-expanded={open}
    aria-controls={popoverId}
    onclick={() => (open = !open)}
  >
    <Icon name="target" size={14} />
    {minutes > 0 ? t("practiceHome.goalChip", { minutes }) : t("practiceHome.goalOff")}
    <Icon name="chevronDown" size={14} />
  </button>
  {#if open}
    <div class="popover" id={popoverId} role="group" aria-label={t("practiceLog.dailyGoal")}>
      <label class="field">
        <span>{t("practiceLog.dailyGoal")}</span>
        <span class="minutes">
          <input
            data-testid="practice-goal-input"
            type="number"
            min="0"
            max="720"
            value={minutes}
            onchange={setMinutes}
          />
          <span class="muted">{t("practiceLog.minutes")}</span>
        </span>
      </label>
      <p class="hint muted">{t("practiceHome.goalHint")}</p>
      <label class="switch">
        <input
          type="checkbox"
          data-testid="practice-weekly-toggle"
          checked={weekly}
          onchange={setWeekly}
        />
        <span class="switch-track"></span>
        {t("practiceLog.weeklySummary")}
      </label>
    </div>
  {/if}
</div>

<style>
  .goal {
    position: relative;
    display: inline-block;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-1);
    min-height: 44px;
    padding: 0 var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--r-pill);
    background: var(--surface-2);
    color: var(--text);
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .popover {
    position: absolute;
    z-index: 20;
    top: calc(100% + var(--sp-2));
    left: 0;
    display: grid;
    gap: var(--sp-3);
    width: min(19rem, calc(100vw - 2 * var(--sp-4)));
    padding: var(--sp-4);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  .field {
    display: grid;
    gap: var(--sp-2);
    font-size: var(--fs-sm);
    font-weight: 600;
  }

  .minutes {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-weight: 400;
  }

  .minutes input {
    width: 6rem;
  }

  .hint {
    margin: 0;
    font-size: var(--fs-xs);
  }
</style>
