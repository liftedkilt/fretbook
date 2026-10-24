<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";

  const tools = [
    {
      id: "tuner",
      titleKey: "tools.tuner",
      descKey: "tools.tunerDescription",
      openKey: "tools.openTuner",
      icon: "tuner",
      path: "/tools/tuner",
      testId: "tool-card-tuner",
    },
    {
      id: "metronome",
      titleKey: "tools.metronome",
      descKey: "tools.metronomeDescription",
      openKey: "tools.openMetronome",
      icon: "gauge",
      path: "/tools/metronome",
      testId: "tool-card-metronome",
    },
    {
      id: "rhythm",
      titleKey: "rhythm.toolTitle",
      descKey: "rhythm.toolDescription",
      openKey: "rhythm.openTool",
      icon: "gauge",
      path: "/tools/rhythm",
      testId: "tool-card-rhythm",
    },
    {
      id: "chords",
      titleKey: "chordDiagrams.toolTitle",
      descKey: "chordDiagrams.toolDescription",
      openKey: "chordDiagrams.openTool",
      icon: "chords",
      path: "/tools/chords",
      testId: "tool-card-chords",
    },
    {
      id: "trainer",
      titleKey: "trainer.title",
      descKey: "trainer.toolDescription",
      openKey: "trainer.open",
      icon: "guitar",
      path: "/tools/trainer",
      testId: "tool-card-trainer",
    },
    {
      id: "exercises",
      titleKey: "exercises.toolTitle",
      descKey: "exercises.toolDescription",
      openKey: "exercises.openTool",
      icon: "tab",
      path: "/tools/exercises",
      testId: "tool-card-exercises",
    },
  ];
</script>

<div class="tools-page" data-testid="tools-view">
  <header class="tools-header">
    <h1 class="display">{t("tools.heading")}</h1>
    <p class="muted">{t("tools.subtitle")}</p>
  </header>

  <div class="tools-grid">
    {#each tools as tool (tool.id)}
      <a
        class="tool-card"
        data-testid={tool.testId}
        href={hrefFor(tool.path)}
        onclick={(event) => followLink(event, tool.path)}
      >
        <div class="tool-card-icon">
          <Icon name={tool.icon} size={32} />
        </div>
        <div class="tool-card-body">
          <h2 class="tool-card-title">{t(tool.titleKey)}</h2>
          <p class="tool-card-desc">{t(tool.descKey)}</p>
        </div>
        <div class="tool-card-action">
          <span class="button secondary tool-card-btn">
            {t(tool.openKey)}
            <Icon name="forward" size={16} />
          </span>
        </div>
      </a>
    {/each}
  </div>
</div>
