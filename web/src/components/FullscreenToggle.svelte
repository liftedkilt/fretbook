<script lang="ts">
  // Enters and leaves the song page's full screen layout (see lib/fullscreen.ts).
  // One button, in the player dock: it is the only full screen control on the page.
  import Icon from "./Icon.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import { t } from "../lib/i18n.svelte";
  import {
    enterFullscreen,
    exitFullscreen,
    fullscreenSupported,
    watchFocusMode,
    watchFullscreen,
  } from "../lib/fullscreen";

  let {
    onbeforetoggle,
    onaftertoggle,
  }: {
    onbeforetoggle?: () => void;
    onaftertoggle?: (on: boolean) => void;
  } = $props();

  const supported = fullscreenSupported();
  let on = $state(false);

  // Where the Fullscreen API is missing (iPhone Safari) the same button toggles a CSS-only focus mode.
  const focus = watchFocusMode((value) => {
    if (!supported) on = value;
  });

  $effect(() => {
    if (!supported) return focus.stop;
    const stop = watchFullscreen((value) => (on = value));
    return () => {
      stop();
      focus.stop();
    };
  });

  async function toggle() {
    onbeforetoggle?.();
    if (!supported) {
      const next = !on;
      focus.set(next);
      onaftertoggle?.(next);
      return;
    }
    if (on) {
      await exitFullscreen();
      onaftertoggle?.(false);
      return;
    }
    const entered = await enterFullscreen();
    if (entered) onaftertoggle?.(true);
  }

  // The phone dock folds this button into its "⋯" menu, which drives it from here.
  export const isOn = () => on;
  export { toggle };

  const label = $derived(on ? t("fullscreen.exit") : t("fullscreen.enter"));
</script>

<IconButton
  class="ghost fullscreen-dock"
  icon={on ? "minimize" : "maximize"}
  {label}
  testid="player-fullscreen"
  pressed={on}
  placement="above"
  onclick={() => void toggle()}
/>

{#if on}
  <button
    type="button"
    class="focus-exit"
    data-testid="player-focus-exit"
    aria-label={t("fullscreen.exit")}
    title={t("fullscreen.exit")}
    onclick={() => void toggle()}
  >
    <Icon name="close" size={18} />
  </button>
{/if}

<style>
  .focus-exit {
    display: none;
    position: fixed;
    top: calc(12px + env(safe-area-inset-top, 0px));
    right: calc(12px + env(safe-area-inset-right, 0px));
    z-index: 100;
    width: 36px;
    height: 36px;
    padding: 0;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-pill, 9999px);
    border: 1px solid var(--line-strong, var(--line));
    background: var(--surface-2, var(--surface));
    color: var(--text-2);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.15);
    cursor: pointer;
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .focus-exit:hover {
    background: var(--surface-3);
    color: var(--text);
  }

  @media (pointer: coarse), (hover: none), (max-width: 767px) {
    .focus-exit {
      display: inline-flex;
    }
  }
</style>
