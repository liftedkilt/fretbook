<script lang="ts">
  // Enters and leaves the song page's full screen layout (see lib/fullscreen.ts).
  // One button, in the player dock: it is the only full screen control on the page.
  import IconButton from "./ui/IconButton.svelte";
  import { t } from "../lib/i18n.svelte";
  import {
    enterFullscreen,
    exitFullscreen,
    fullscreenSupported,
    watchFullscreen,
  } from "../lib/fullscreen";

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
    class="ghost fullscreen-dock"
    icon={on ? "minimize" : "maximize"}
    {label}
    testid="player-fullscreen"
    pressed={on}
    placement="above"
    onclick={() => void toggle()}
  />
{/if}
