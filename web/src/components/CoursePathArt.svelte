<script lang="ts">
  import Cover from "./Cover.svelte";

  // A course's art: the same generated gradient and glyph as a song cover, cropped to a banner.
  let {
    id,
    title,
    track,
    ratio = "16 / 7",
  }: { id: string; title: string; track: string; ratio?: string } = $props();
</script>

<div class="art" style="aspect-ratio:{ratio}">
  <Cover {id} {title} size="md" strings={track === "bass" ? 4 : 6} />
</div>

<style>
  .art {
    width: 100%;
    overflow: hidden;
    border-radius: var(--r-md);
  }

  .art :global(.cover) {
    aspect-ratio: auto;
    height: 100%;
    border-radius: 0;
  }
</style>
