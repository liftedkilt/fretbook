<script lang="ts">
  import Cover from "../Cover.svelte";
  import Icon from "../Icon.svelte";
  import { followLink, hrefFor } from "../../lib/router.svelte";

  // One row of a practice list: cover, title over artist (one line each), value on the right.
  // The whole row is the link, so it never needs underlined text.
  let {
    path = "",
    title,
    subtitle = "",
    value = "",
    cover,
    icon,
  }: {
    path?: string;
    title: string;
    subtitle?: string;
    value?: string;
    cover?: { id: string; kind: string };
    icon?: string;
  } = $props();
</script>

<li>
  {#if path}
    <a class="row" href={hrefFor(path)} onclick={(event) => followLink(event, path)}>
      {@render body()}
    </a>
  {:else}
    <div class="row">{@render body()}</div>
  {/if}
</li>

{#snippet body()}
  {#if cover}
    <span class="art"
      ><Cover
        id={cover.id}
        {title}
        kind={cover.kind === "chords" ? "chords" : "tab"}
        size="sm"
      /></span
    >
  {:else if icon}
    <span class="art icon-tile"><Icon name={icon} size={18} /></span>
  {/if}
  <span class="text">
    <strong>{title}</strong>
    {#if subtitle}<span class="muted">{subtitle}</span>{/if}
  </span>
  {#if value}<span class="value muted">{value}</span>{/if}
{/snippet}

<style>
  li {
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: 52px;
    padding: var(--sp-1) var(--sp-2);
    margin: 0 calc(-1 * var(--sp-2));
    border-radius: var(--r-sm);
    color: inherit;
    text-decoration: none;
    min-width: 0;
  }

  a.row:hover {
    background: var(--surface-2);
  }

  .art {
    flex: none;
    width: 38px;
  }

  .icon-tile {
    display: grid;
    place-items: center;
    height: 38px;
    border-radius: var(--r-sm);
    background: var(--surface-2);
    color: var(--text-2);
  }

  .text {
    display: grid;
    flex: 1;
    min-width: 0;
  }

  .text > * {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .text .muted {
    font-size: var(--fs-sm);
  }

  .value {
    flex: none;
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
</style>
