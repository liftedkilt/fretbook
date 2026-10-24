<script lang="ts">
  import ChordDiagram from "./ChordDiagram.svelte";
  import Fretboard from "./Fretboard.svelte";
  import Icon from "./Icon.svelte";
  import type { LessonBlock } from "../lib/api-types";
  import { resolveSetup } from "../lib/chords/instruments";
  import { generateVoicings } from "../lib/chords/voicings";
  import { presetById } from "../lib/exercises/presets";
  import { t } from "../lib/i18n.svelte";
  import { fretboardPitchClasses, isYouTube, renderMarkdown, spotsFor } from "../lib/lessons";
  import { followLink, hrefFor } from "../lib/router.svelte";

  let { blocks }: { blocks: LessonBlock[] } = $props();

  const INSTRUMENT_IDS: Record<string, string> = {
    guitar: "guitar6",
    bass: "bass4",
    ukulele: "ukulele",
  };

  function setupFor(instrument: string) {
    return resolveSetup(INSTRUMENT_IDS[instrument] ?? "guitar6");
  }

  function voicingFor(block: LessonBlock) {
    const setup = setupFor(block.params.instrument);
    const [first] = generateVoicings(setup.tuning.strings, block.params.name, {
      rootInBass: setup.instrument.rootInBass,
      limit: 1,
    });
    return { setup, voicing: first };
  }

  function neck(block: LessonBlock) {
    const setup = setupFor(block.params.instrument);
    // The diagram takes the highest string first; the tunings list the lowest first.
    const tuning = [...setup.tuning.strings].reverse();
    return { tuning, spots: spotsFor(tuning, fretboardPitchClasses(block.params)) };
  }

  function exerciseTitle(id: string): string {
    return presetById(id) ? t(`exercises.presets.${id}.title`) : id;
  }
</script>

<div class="lesson-blocks">
  {#each blocks as block, index (index)}
    {#if block.kind === "markdown"}
      <div class="lesson-prose" data-testid="lesson-prose">
        <!-- eslint-disable-next-line svelte/no-at-html-tags -- renderMarkdown escapes everything first -->
        {@html renderMarkdown(block.text)}
      </div>
    {:else if block.kind === "chord"}
      {@const found = voicingFor(block)}
      <figure class="lesson-chord" data-testid="lesson-chord">
        {#if found.voicing}
          <ChordDiagram
            voicing={found.voicing}
            strings={found.setup.tuning.strings.length}
            name={block.params.name}
          />
        {/if}
        <figcaption>{block.params.name}</figcaption>
      </figure>
    {:else if block.kind === "fretboard"}
      {@const found = neck(block)}
      <figure class="lesson-fretboard" data-testid="lesson-fretboard">
        <Fretboard tuning={found.tuning} current={found.spots} label="names" />
      </figure>
    {:else if block.kind === "tab"}
      <pre
        class="lesson-tab"
        data-testid="lesson-tab"
        aria-label={t("lessons.tabLabel")}>{block.text}</pre>
    {:else if block.kind === "song"}
      <a
        class="lesson-link"
        data-testid="lesson-song"
        href={hrefFor(`/songs/${block.params.song}`)}
        onclick={(event) => followLink(event, `/songs/${block.params.song}`)}
      >
        <Icon name="guitar" size={18} />
        <span>{block.params.title || t("lessons.openSong")}</span>
      </a>
    {:else if block.kind === "exercise"}
      {@const path = `/tools/exercises?preset=${block.params.preset}`}
      <a
        class="lesson-link"
        data-testid="lesson-exercise"
        href={hrefFor("/tools/exercises") + `?preset=${block.params.preset}`}
        onclick={(event) => followLink(event, path)}
      >
        <Icon name="tab" size={18} />
        <span
          >{t("lessons.openExercise", {
            name: block.params.title || exerciseTitle(block.params.preset),
          })}</span
        >
      </a>
    {:else if block.kind === "media"}
      <figure class="lesson-media" data-testid="lesson-media">
        {#if isYouTube(block.params.src)}
          <a class="lesson-link" href={block.params.src} target="_blank" rel="noopener noreferrer">
            <Icon name="link" size={18} />
            <span>{block.params.title || t("lessons.watchOnYouTube")}</span>
          </a>
        {:else if block.params.type === "video"}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video controls preload="none" src={block.params.src} aria-label={block.params.title}
          ></video>
        {:else}
          <audio controls preload="none" src={block.params.src} aria-label={block.params.title}
          ></audio>
        {/if}
        {#if block.params.title && !isYouTube(block.params.src)}
          <figcaption>{block.params.title}</figcaption>
        {/if}
      </figure>
    {/if}
  {/each}
</div>
