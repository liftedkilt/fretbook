<script lang="ts">
  import type { Snippet } from "svelte";

  import CrashScreen from "./CrashScreen.svelte";

  // Without this, an error thrown while a page renders (or in one of its effects) leaves the app blank.
  let { path, children }: { path: string; children: Snippet } = $props();
</script>

<svelte:boundary onerror={(error) => console.error(error)}>
  {@render children()}
  {#snippet failed(error, reset)}
    <CrashScreen {error} {reset} {path} />
  {/snippet}
</svelte:boundary>
