<script lang="ts">
  import Icon from "./Icon.svelte";
  import { addDemo } from "../lib/api";
  import { t, tOr } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import {
    defaultFamily,
    openSheet,
    refreshSongs,
    setDefaultInstrument,
    ui,
  } from "../lib/ui.svelte";

  // The welcome of an empty library: every way to get started on one screen.
  let adding = $state(false);
  let error = $state("");

  const course = $derived(defaultFamily() === "bass" ? "bass-first-steps" : "guitar-first-steps");

  async function tryDemo() {
    adding = true;
    error = "";
    try {
      await addDemo();
      await refreshSongs();
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    } finally {
      adding = false;
    }
  }

  async function chooseInstrument(id: string) {
    try {
      await setDefaultInstrument(id);
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }
</script>

<div class="empty-state first-run" data-testid="library-empty">
  <span class="empty-art"><Icon name="sparkle" size={34} /></span>
  <h2 class="display">{t("firstRun.title")}</h2>
  <p class="muted">{t("firstRun.subtitle")}</p>
  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

  <ul class="first-run-steps">
    <li data-testid="first-run-import">
      <div>
        <strong>{t("firstRun.importTitle")}</strong>
        <p class="muted">{t("firstRun.importBody")}</p>
      </div>
      <button class="primary" onclick={() => openSheet("add")}
        ><Icon name="plus" />{t("add.button")}</button
      >
    </li>
    <li data-testid="first-run-demo">
      <div>
        <strong>{t("firstRun.demoTitle")}</strong>
        <p class="muted">{t("firstRun.demoBody")}</p>
      </div>
      <button data-testid="first-run-add-demo" disabled={adding} onclick={() => void tryDemo()}
        >{adding ? t("firstRun.demoAdding") : t("firstRun.demoButton")}</button
      >
    </li>
    <li data-testid="first-run-instrument">
      <div>
        <strong>{t("firstRun.instrumentTitle")}</strong>
        <p class="muted">{t("firstRun.instrumentBody")}</p>
      </div>
      <select
        value={ui.defaultInstrument}
        aria-label={t("settings.defaultInstrument")}
        onchange={(event) => void chooseInstrument(event.currentTarget.value)}
      >
        {#each ui.presets as item (item.id)}
          <option value={item.id}>{tOr(item.label_key, item.label)}</option>
        {/each}
      </select>
    </li>
    <li data-testid="first-run-tuner">
      <div>
        <strong>{t("firstRun.tunerTitle")}</strong>
        <p class="muted">{t("firstRun.tunerBody")}</p>
      </div>
      <button onclick={() => openSheet("tuner")}>{t("firstRun.tunerButton")}</button>
    </li>
    <li data-testid="first-run-course">
      <div>
        <strong>{t("firstRun.courseTitle")}</strong>
        <p class="muted">{t("firstRun.courseBody")}</p>
      </div>
      <a
        class="button"
        href={hrefFor(`/lessons/${course}`)}
        onclick={(event) => followLink(event, `/lessons/${course}`)}>{t("firstRun.courseButton")}</a
      >
    </li>
  </ul>
</div>
