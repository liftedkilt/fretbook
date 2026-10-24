<script lang="ts">
  import { separateEffectBands } from "../lib/alphatab/display";
  import { preferredTrack, trackToAlphaTex } from "../lib/alphatex";
  import { t } from "../lib/i18n.svelte";
  import type { ScoreDocument } from "../lib/types";

  let { score, title = "" }: { score: ScoreDocument; title?: string } = $props();

  let host = $state<HTMLElement | null>(null);
  let failed = $state(false);

  // alphaTab is loaded on demand: most visits to the Add sheet never preview a tab.
  $effect(() => {
    const element = host;
    const source = trackToAlphaTex(score, preferredTrack(score).id, title, "");
    if (!element) return;
    let cancelled = false;
    let instance: { destroy(): void } | null = null;
    failed = false;
    void (async () => {
      try {
        const alphaTab = await import("@coderline/alphatab");
        if (cancelled) return;
        const settings = new alphaTab.Settings();
        settings.core.fontDirectory = new URL("font/", document.baseURI).href;
        settings.core.logLevel = alphaTab.LogLevel.Warning;
        settings.player.playerMode = alphaTab.PlayerMode.Disabled;
        settings.display.staveProfile = alphaTab.StaveProfile.Tab;
        separateEffectBands(settings);
        const api = new alphaTab.AlphaTabApi(element, settings);
        instance = api;
        api.tex(source);
      } catch {
        if (!cancelled) failed = true;
      }
    })();
    return () => {
      cancelled = true;
      instance?.destroy();
    };
  });
</script>

{#if failed}
  <p class="alert" role="alert">{t("asciiTab.previewFailed")}</p>
{:else}
  <div class="tab-preview" data-testid="tab-preview" bind:this={host}></div>
{/if}
