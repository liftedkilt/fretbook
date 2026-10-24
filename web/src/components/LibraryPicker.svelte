<script lang="ts">
  import { listLibraries } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { LibraryInfo } from "../lib/types";
  import { refreshSongs, setActiveLibrary, ui } from "../lib/ui.svelte";

  let libraries = $state<LibraryInfo[]>([]);

  const personalId = $derived(libraries.find((item) => item.kind === "personal")?.id ?? "");
  const selected = $derived(ui.libraryId || personalId);

  $effect(() => {
    let cancel = false;
    listLibraries()
      .then((rows) => {
        if (!cancel) libraries = rows;
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  });

  async function choose(event: Event) {
    const id = (event.currentTarget as HTMLSelectElement).value;
    setActiveLibrary(id === personalId ? "" : id);
    await refreshSongs().catch((err: unknown) => {
      ui.error = err instanceof Error ? err.message : t("error.generic");
    });
  }
</script>

<div class="library-picker">
  <label>
    <span>{t("bands.switcher")}</span>
    <select
      data-testid="library-switcher"
      value={selected}
      onchange={(event) => void choose(event)}
    >
      {#each libraries as library (library.id)}
        <option value={library.id}>
          {library.kind === "personal" ? t("bands.yours") : library.name}
        </option>
      {/each}
    </select>
  </label>
  <a
    class="button"
    data-testid="nav-bands-library"
    href={hrefFor("/bands")}
    onclick={(event) => followLink(event, "/bands")}>{t("bands.nav")}</a
  >
</div>

<style>
  .library-picker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    margin: 0 0 1rem;
    font-size: 0.95rem;
  }

  label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  select {
    min-width: 12rem;
  }
</style>
