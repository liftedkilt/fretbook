<script lang="ts">
  import Tuner from "./Tuner.svelte";
  import ToolPage from "./ui/ToolPage.svelte";
  import { t } from "../lib/i18n.svelte";
  import { INSTRUMENTS, type InstrumentDefinition } from "../lib/tuner";
  import { parseCustomTuning } from "../lib/tuning";

  const STORAGE_KEY = "fretbook.standalone.tuner";

  interface StoredChoice {
    instrument?: string;
    tuning?: string;
    custom?: string;
  }

  function readStored(): StoredChoice {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function saveStored(choice: StoredChoice) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch {
      // Private mode
    }
  }

  const initial = readStored();
  let instrumentId = $state(
    INSTRUMENTS.some((i) => i.id === initial.instrument) ? initial.instrument! : "guitar6",
  );
  let tuningId = $state(initial.tuning || "standard");
  let customText = $state(initial.custom || "E4 B3 G3 D3 A2 E2");

  const currentInstrument = $derived<InstrumentDefinition>(
    INSTRUMENTS.find((i) => i.id === instrumentId) ?? INSTRUMENTS[0],
  );

  const availableTunings = $derived(currentInstrument.tunings);

  // Validate tuningId against the current instrument's tunings
  $effect(() => {
    if (instrumentId === "chromatic") {
      tuningId = "chromatic";
      return;
    }
    const hasTuning = availableTunings.some((t) => t.id === tuningId);
    if (!hasTuning && tuningId !== "custom") {
      tuningId = availableTunings[0]?.id ?? "standard";
    }
  });

  // Save choice on changes
  $effect(() => {
    saveStored({
      instrument: instrumentId,
      tuning: tuningId,
      custom: customText,
    });
  });

  const strings = $derived.by((): number[] | null => {
    if (instrumentId === "chromatic") return null;
    if (tuningId === "custom") {
      const parsed = parseCustomTuning(customText);
      if (parsed && parsed.length > 0) return parsed;
      return availableTunings[0]?.midi ?? [64, 59, 55, 50, 45, 40];
    }
    const found = availableTunings.find((t) => t.id === tuningId);
    return found?.midi ?? availableTunings[0]?.midi ?? null;
  });
</script>

<Tuner {strings} active={true}>
  {#snippet page(stagePart, optionsPart)}
    <ToolPage title={t("tools.tuner")} testid="standalone-tuner-view">
      {#snippet stage()}
        {@render stagePart()}
      {/snippet}
      {#snippet settings()}
        <div class="pickers">
          <label class="tool-field">
            <span>{t("tools.instrument")}</span>
            <select
              data-testid="tuner-instrument"
              value={instrumentId}
              onchange={(event) => {
                instrumentId = event.currentTarget.value;
              }}
            >
              {#each INSTRUMENTS as inst (inst.id)}
                <option value={inst.id}>{t(inst.labelKey)}</option>
              {/each}
            </select>
          </label>

          {#if instrumentId !== "chromatic"}
            <label class="tool-field">
              <span>{t("tools.tuning")}</span>
              <select
                data-testid="tuner-tuning"
                value={tuningId}
                onchange={(event) => {
                  tuningId = event.currentTarget.value;
                }}
              >
                {#each availableTunings as tune (tune.id)}
                  <option value={tune.id}>{t(tune.labelKey)}</option>
                {/each}
                <option value="custom">{t("tools.tunings.custom")}</option>
              </select>
            </label>
          {/if}

          {#if instrumentId !== "chromatic" && tuningId === "custom"}
            <label class="tool-field tool-field-full">
              <span>{t("tools.customTuning")}</span>
              <input
                type="text"
                data-testid="tuner-custom-tuning"
                placeholder={t("tools.customTuningPlaceholder")}
                value={customText}
                oninput={(event) => {
                  customText = event.currentTarget.value;
                }}
              />
              <span class="muted tool-field-help">{t("tools.customTuningHelp")}</span>
            </label>
          {/if}
        </div>
        <div class="tuner-options">{@render optionsPart()}</div>
      {/snippet}
    </ToolPage>
  {/snippet}
</Tuner>

<style>
  .pickers {
    display: grid;
    gap: var(--sp-3);
  }
</style>
