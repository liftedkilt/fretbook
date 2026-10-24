<script lang="ts">
  // Enters and leaves the song page's full screen layout (see lib/fullscreen.ts).
  // The header copy is hidden while full screen is on; the dock copy only shows then (app.css).
  import IconButton from "./ui/IconButton.svelte";
  import { t } from "../lib/i18n.svelte";
  import {
    enterFullscreen,
    exitFullscreen,
    fullscreenSupported,
    watchFullscreen,
  } from "../lib/fullscreen";

  let { placement }: { placement: "header" | "dock" } = $props();

  const supported = fullscreenSupported();
  let on = $state(false);

  $effect(() => {
    if (!supported) return;
    return watchFullscreen((value) => (on = value));
  });

  async function toggle() {
    if (on) {
      await exitFullscreen();
      return;
    }
    if (await enterFullscreen()) window.scrollTo({ top: 0 });
  }

  const label = $derived(on ? t("fullscreen.exit") : t("fullscreen.enter"));
</script>

{#if supported}
  <IconButton
    class={placement === "dock" ? "ghost fullscreen-dock" : "fullscreen-header"}
    icon={on ? "minimize" : "maximize"}
    {label}
    testid={placement === "dock" ? "player-fullscreen-exit" : "player-fullscreen"}
    pressed={on}
    placement={placement === "dock" ? "above" : "below"}
    onclick={() => void toggle()}
  />
{/if}
