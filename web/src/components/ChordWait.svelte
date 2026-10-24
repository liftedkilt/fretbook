<script lang="ts">
  import { untrack } from "svelte";

  import Icon from "./Icon.svelte";
  import { parse } from "../lib/chordpro";
  import { t } from "../lib/i18n.svelte";
  import { chordSheetSteps } from "../lib/listen/chordSheetWait";
  import { describeProblem, ListenError, startListening } from "../lib/listen/input";
  import { WaitRun } from "../lib/listen/waitRun";

  // Wait mode for a chord sheet: the chord that is lit is the one to play; the next lights up
  // once it is heard. `onactive` tells the sheet which chord that is.
  let {
    text,
    transpose = 0,
    flats = false,
    onactive,
  }: {
    text: string;
    transpose?: number;
    flats?: boolean;
    onactive: (key: string | null) => void;
  } = $props();

  type Phase = "idle" | "waiting" | "done";

  const built = $derived(chordSheetSteps(parse(text), transpose, flats));
  let on = $state(false);
  let phase = $state<Phase>("idle");
  let current = $state(-1);
  let hits = $state(0);
  let error = $state("");
  let run: WaitRun | null = null;

  const chord = $derived(built.steps[current]?.label ?? "");

  async function start() {
    if (run || built.steps.length === 0) return;
    error = "";
    const { steps, keys } = built;
    const next = new WaitRun({
      steps,
      listen: startListening,
      hintSeconds: 0,
      onWait: (_, index) => {
        current = index;
        phase = "waiting";
        onactive(keys[index]);
      },
      onHit: (_, index) => {
        hits = next.hits;
        if (index + 1 < steps.length) {
          next.reach(index + 1);
          return;
        }
        current = -1;
        phase = "done";
        onactive(null);
      },
      onHint: () => undefined,
    });
    try {
      await next.start();
    } catch (err) {
      error = err instanceof ListenError ? describeProblem(err.problem) : String(err);
      return;
    }
    run = next;
    on = true;
    hits = 0;
    next.seek(0);
    next.reach(0);
  }

  function stop() {
    run?.stop();
    run = null;
    on = false;
    phase = "idle";
    current = -1;
    onactive(null);
  }

  function toggle() {
    if (on) stop();
    else void start();
  }

  // The steps belong to the sheet as it was when the run began: a transposition or an edit ends it.
  $effect(() => {
    void built;
    untrack(() => {
      if (run) stop();
    });
  });

  $effect(() => () => run?.stop());
</script>

<section class="panel-group wait-chords no-print" data-testid="chord-wait">
  <h3>{t("chordWait.title")}</h3>
  {#if built.steps.length === 0}
    <p class="muted small" data-testid="chord-wait-empty">{t("chordWait.noChords")}</p>
  {:else}
    <p class="muted small">{t("chordWait.about")}</p>
    <div class="mix-row">
      <button class="button" data-testid="chord-wait-toggle" aria-pressed={on} onclick={toggle}
        ><Icon name="mic" size={16} />{on ? t("chordWait.stop") : t("chordWait.start")}</button
      >
    </div>
    {#if error}<p class="alert" role="alert" data-testid="chord-wait-error">
        <Icon name="alert" size={18} />{error}
      </p>{/if}
    {#if on}
      <div
        class="wait-status"
        data-testid="chord-wait-status"
        data-state={phase}
        data-hits={hits}
        data-total={built.steps.length}
        role="status"
      >
        <Icon name="mic" size={16} />
        <span class="wait-note">
          {#if phase === "waiting"}
            {t("chordWait.playNow", { chord })}
          {:else if phase === "done"}
            {t("chordWait.done", { hits, total: built.steps.length })}
          {:else}
            {t("chordWait.listening", { chord })}
          {/if}
        </span>
        <span class="muted small"
          >{t("chordWait.progress", { hits, total: built.steps.length })}</span
        >
        {#if phase === "waiting"}
          <button class="button" data-testid="chord-wait-skip" onclick={() => run?.skip()}
            >{t("chordWait.skip")}</button
          >
        {/if}
      </div>
    {/if}
  {/if}
</section>
