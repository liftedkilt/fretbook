<script lang="ts">
  import { onMount } from "svelte";

  import Icon from "./Icon.svelte";
  import { recordPracticeSession } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { IdleWatch, PracticeTimer, SHEET_IDLE_MS } from "../lib/practiceLog";

  let { songId, onlogged }: { songId: string; onlogged?: () => void } = $props();

  // A chord sheet has no playback, so practice is opt-in: time counts while the switch is on, the
  // page is visible, and something was touched in the last few minutes.
  let on = $state(false);
  let idle = $state(false);
  let visible = $state(typeof document === "undefined" || document.visibilityState !== "hidden");

  const timer = new PracticeTimer({
    onSession: (session, keepalive) => {
      void recordPracticeSession(session, keepalive).then(() => onlogged?.());
    },
  });
  const watch = new IdleWatch(SHEET_IDLE_MS, () => (idle = true));

  $effect(() => {
    timer.update(on && visible && !idle, {
      songId,
      trackId: "chords",
      loopName: "",
      loopStart: null,
      loopEnd: null,
      mode: "free",
      speed: 1,
    });
  });

  $effect(() => {
    if (!on) return;
    idle = false;
    watch.arm();
    const touch = () => {
      idle = false;
      watch.arm();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"];
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    return () => {
      for (const name of events) window.removeEventListener(name, touch);
      watch.disarm();
    };
  });

  onMount(() => {
    const leaving = () => timer.flush(true);
    const changed = () => {
      visible = document.visibilityState !== "hidden";
      if (!visible) leaving();
    };
    window.addEventListener("pagehide", leaving);
    document.addEventListener("visibilitychange", changed);
    return () => {
      window.removeEventListener("pagehide", leaving);
      document.removeEventListener("visibilitychange", changed);
      timer.flush();
      timer.dispose();
    };
  });
</script>

<div class="chord-practice no-print">
  <button class="toggle" data-testid="chord-practice" aria-pressed={on} onclick={() => (on = !on)}>
    <Icon name="target" size={18} /><span>{t("practiceLog.chordPractice")}</span>
  </button>
  <p class="muted" role="status">
    {#if !on}{t("practiceLog.chordPracticeHint")}
    {:else if idle}{t("practiceLog.chordPracticePaused")}
    {:else}{t("practiceLog.chordPracticeOn")}{/if}
  </p>
</div>

<style>
  .chord-practice {
    max-width: 960px;
    margin: 1rem auto 0;
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }
  p {
    margin: 0;
    font-size: 0.9rem;
  }
</style>
