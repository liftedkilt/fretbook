<script lang="ts">
  import { separateEffectBands } from "../lib/alphatab/display";
  import { preferredTrack, trackToAlphaTex } from "../lib/alphatex";
  import { t } from "../lib/i18n.svelte";
  import type { ScoreDocument } from "../lib/types";

  let { score, title = "" }: { score: ScoreDocument; title?: string } = $props();

  let host = $state<HTMLElement | null>(null);
  let failed = $state(false);
  let chosen = $state("");
  const shown = $derived(
    score.tracks.find((track) => track.id === chosen) ?? preferredTrack(score),
  );

  // alphaTab is loaded on demand: most visits to the Add sheet never preview a tab.
  $effect(() => {
    const element = host;
    const source = trackToAlphaTex(score, shown.id, title, "");
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
        if (settings.notation?.elements && alphaTab.NotationElement) {
          settings.notation.elements.set(alphaTab.NotationElement.ScoreTitle, false);
          settings.notation.elements.set(alphaTab.NotationElement.ScoreSubTitle, false);
          settings.notation.elements.set(alphaTab.NotationElement.ScoreArtist, false);
        }
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

{#if score.tracks.length > 1}
  <label class="field">
    <span>{t("asciiTab.previewTrack")}</span>
    <select value={shown.id} onchange={(event) => (chosen = event.currentTarget.value)}>
      {#each score.tracks as track (track.id)}
        <option value={track.id}>{track.name}</option>
      {/each}
    </select>
  </label>
{/if}
{#if failed}
  <p class="alert" role="alert">{t("asciiTab.previewFailed")}</p>
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="tab-preview paper"
    data-testid="tab-preview"
    role="region"
    tabindex="0"
    aria-label={title || t("asciiTab.preview")}
    bind:this={host}
  ></div>
{/if}
