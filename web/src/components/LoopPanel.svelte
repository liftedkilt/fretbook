<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import type { PracticeSettings, SavedLoop } from "../lib/practice";

  let {
    practice,
    loopA,
    loopB,
    activeLoopId = null,
    speedTrainerRunning = false,
    speedTrainerPercent = 100,
    speedTrainerPass = 1,
    speedTrainerCompleted = false,
    onsetloop,
    onclearloop,
    onchange,
    onjump,
  }: {
    practice: PracticeSettings;
    loopA: number | null;
    loopB: number | null;
    activeLoopId?: string | null;
    speedTrainerRunning?: boolean;
    speedTrainerPercent?: number;
    speedTrainerPass?: number;
    speedTrainerCompleted?: boolean;
    onsetloop: (which: "a" | "b") => void;
    onclearloop: () => void;
    onchange: () => void;
    onjump: (loop: SavedLoop) => void;
  } = $props();

  let newLoopName = $state("");

  function saveCurrentLoop() {
    if (loopA == null || loopB == null) return;
    const name =
      newLoopName.trim() || t("speedTrainer.defaultLoopName", { a: loopA + 1, b: loopB + 1 });
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `loop-${Date.now()}`;
    const loop: SavedLoop = {
      id,
      name,
      a: loopA,
      b: loopB,
    };
    practice.loops = [...practice.loops, loop];
    newLoopName = "";
    onchange();
    onjump(loop);
  }

  function deleteLoop(id: string) {
    practice.loops = practice.loops.filter((item) => item.id !== id);
    onchange();
  }

  function formatSpeed(speed: number | undefined): string {
    if (speed == null) return "";
    const pct = speed <= 3 ? Math.round(speed * 100) : Math.round(speed);
    return `${pct}%`;
  }
</script>

<div class="panel-group" data-testid="loop-panel">
  <h3>{t("player.loop")}</h3>
  <div class="button-row">
    <button data-testid="player-loop-a" onclick={() => onsetloop("a")}>
      <Icon name="repeat" size={16} />{t("player.loopA")}
    </button>
    <button data-testid="player-loop-b" onclick={() => onsetloop("b")}>
      {t("player.loopB")}
    </button>
    <button data-testid="player-clear-loop" onclick={onclearloop} disabled={loopA == null}>
      {t("player.clearLoop")}
    </button>
    {#if loopA != null && loopB != null}
      <span class="pill pill-accent" data-testid="current-loop-range">
        {t("player.loopRange", { a: loopA + 1, b: loopB + 1 })}
      </span>
    {/if}
  </div>

  {#if loopA != null && loopB != null}
    <div class="loop-save-row" data-testid="loop-save-row">
      <input
        type="text"
        class="input loop-name-input"
        data-testid="save-loop-name"
        placeholder={t("speedTrainer.loopNamePlaceholder")}
        bind:value={newLoopName}
        onkeydown={(event) => {
          if (event.key === "Enter") saveCurrentLoop();
        }}
      />
      <button class="button" data-testid="save-loop-button" onclick={saveCurrentLoop}>
        <Icon name="plus" size={16} />{t("speedTrainer.saveLoop")}
      </button>
    </div>
  {/if}

  {#if practice.loops.length > 0}
    <div class="saved-loops-list" data-testid="saved-loops-list">
      <p class="muted small">{t("speedTrainer.savedLoops")}</p>
      <div class="saved-loops-items">
        {#each practice.loops as loop (loop.id)}
          <div
            class="saved-loop-item"
            class:active={activeLoopId === loop.id || (loopA === loop.a && loopB === loop.b)}
            data-testid={`saved-loop-${loop.id}`}
          >
            <button
              class="saved-loop-jump"
              data-testid={`jump-loop-${loop.id}`}
              onclick={() => onjump(loop)}
              title={t("speedTrainer.jumpToLoop", {
                name: loop.name,
                a: loop.a + 1,
                b: loop.b + 1,
              })}
            >
              <span class="saved-loop-name">{loop.name}</span>
              <span class="saved-loop-bars">
                {t("player.loopRange", { a: loop.a + 1, b: loop.b + 1 })}
              </span>
              {#if loop.highestSpeed != null}
                <span
                  class="pill pill-accent loop-speed-badge"
                  data-testid={`saved-loop-speed-${loop.id}`}
                >
                  {formatSpeed(loop.highestSpeed)}
                </span>
              {/if}
            </button>
            <button
              class="icon-button ghost small danger-text"
              data-testid={`delete-loop-${loop.id}`}
              onclick={() => deleteLoop(loop.id)}
              aria-label={t("speedTrainer.deleteLoop")}
              title={t("speedTrainer.deleteLoop")}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<div class="panel-group" data-testid="speed-trainer-panel">
  <h3>{t("speedTrainer.title")}</h3>
  <div class="mix-row">
    <label class="check">
      <input
        type="checkbox"
        data-testid="speed-trainer-toggle"
        checked={practice.speedTrainer.enabled}
        onchange={(event) => {
          practice.speedTrainer.enabled = event.currentTarget.checked;
          onchange();
        }}
      />
      {t("speedTrainer.enable")}
    </label>
  </div>

  {#if practice.speedTrainer.enabled}
    <div class="speed-trainer-controls" data-testid="speed-trainer-controls">
      <label class="field compact-field">
        <span>{t("speedTrainer.start")} (%)</span>
        <input
          type="number"
          min="10"
          max="300"
          step="5"
          data-testid="speed-trainer-start"
          value={practice.speedTrainer.startPercent}
          onchange={(event) => {
            const val = Number(event.currentTarget.value);
            if (val >= 10 && val <= 300) {
              practice.speedTrainer.startPercent = Math.round(val);
              onchange();
            }
          }}
        />
      </label>
      <label class="field compact-field">
        <span>{t("speedTrainer.target")} (%)</span>
        <input
          type="number"
          min="10"
          max="300"
          step="5"
          data-testid="speed-trainer-target"
          value={practice.speedTrainer.targetPercent}
          onchange={(event) => {
            const val = Number(event.currentTarget.value);
            if (val >= 10 && val <= 300) {
              practice.speedTrainer.targetPercent = Math.round(val);
              onchange();
            }
          }}
        />
      </label>
      <label class="field compact-field">
        <span>{t("speedTrainer.step")} (%)</span>
        <input
          type="number"
          min="1"
          max="50"
          step="1"
          data-testid="speed-trainer-step"
          value={practice.speedTrainer.stepPercent}
          onchange={(event) => {
            const val = Number(event.currentTarget.value);
            if (val >= 1 && val <= 50) {
              practice.speedTrainer.stepPercent = Math.round(val);
              onchange();
            }
          }}
        />
      </label>
      <label class="field compact-field">
        <span>{t("speedTrainer.passesPerStep")}</span>
        <input
          type="number"
          min="1"
          max="20"
          step="1"
          data-testid="speed-trainer-passes"
          value={practice.speedTrainer.passesPerStep}
          onchange={(event) => {
            const val = Number(event.currentTarget.value);
            if (val >= 1 && val <= 20) {
              practice.speedTrainer.passesPerStep = Math.round(val);
              onchange();
            }
          }}
        />
      </label>
    </div>

    {#if speedTrainerRunning || speedTrainerCompleted}
      <div class="speed-trainer-status" data-testid="speed-trainer-status">
        {#if speedTrainerCompleted}
          <span class="pill pill-accent"
            >{t("speedTrainer.goalReached", {
              speed: practice.speedTrainer.targetPercent,
            })}</span
          >
        {:else}
          <span class="muted small">
            {t("speedTrainer.status", {
              pass: speedTrainerPass,
              totalPasses: practice.speedTrainer.passesPerStep,
              speed: speedTrainerPercent,
              target: practice.speedTrainer.targetPercent,
            })}
          </span>
        {/if}
      </div>
    {/if}
  {/if}
</div>
