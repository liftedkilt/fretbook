<script lang="ts">
  // Enters and leaves the song page's full screen layout (see lib/fullscreen.ts).
  // One button, in the player dock: it is the only full screen control on the page.
  import IconButton from "./ui/IconButton.svelte";
  import { t } from "../lib/i18n.svelte";
  import {
    enterFullscreen,
    exitFullscreen,
    fullscreenSupported,
    watchFocusMode,
    watchFullscreen,
  } from "../lib/fullscreen";

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
    if (!supported) {
      const next = !on;
      focus.set(next);
      if (next) window.scrollTo({ top: 0 });
      return;
    }
    if (on) {
      await exitFullscreen();
      return;
    }
    if (await enterFullscreen()) window.scrollTo({ top: 0 });
  }

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
