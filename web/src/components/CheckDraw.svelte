<script lang="ts">
  import Icon from "./Icon.svelte";

  // The check that draws itself when a lesson is just passed. Reduced motion shows it at once.
  let { draw = false, size = 18 }: { draw?: boolean; size?: number } = $props();
</script>

<span class="check" class:draw>
  <Icon name="check" {size} />
</span>

<style>
  .check {
    display: inline-grid;
  }

  .check.draw :global(svg path) {
    stroke-dasharray: 28;
    stroke-dashoffset: 28;
    animation: check-draw 1.2s var(--ease) forwards;
  }

  @keyframes check-draw {
    to {
      stroke-dashoffset: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .check.draw :global(svg path) {
      animation: none;
      stroke-dashoffset: 0;
    }
  }
</style>
