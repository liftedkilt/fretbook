<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import {
    DOUBLE_INLAYS,
    SINGLE_INLAYS,
    dotLabel,
    dotPosition,
    fretPosition,
    noteMidi,
    type FretLabel,
    type FretNote,
  } from "../lib/fretboard";

  // A fretboard diagram: strings run left to right, the highest string on top. It only draws; the
  // caller says which notes are lit (`current`) and which come next (`next`, faded by rank).
  let {
    tuning,
    capo = 0,
    frets = 12,
    current = [],
    next = [],
    label = "none",
    root = 0,
    leftHanded = false,
    onselect,
  }: {
    /** Open-string pitches, highest string first. 4 to 8 strings read best. */
    tuning: number[];
    capo?: number;
    frets?: number;
    current?: FretNote[];
    next?: { notes: FretNote[]; rank: number }[];
    label?: FretLabel;
    /** Pitch class (0 to 11) that the interval labels count from. */
    root?: number;
    leftHanded?: boolean;
    /** When given, every fret of every string is a button that reports the tapped note. */
    onselect?: (note: FretNote) => void;
  } = $props();

  const LEFT = 34;
  const RIGHT = 14;
  const WIDTH = 1000;
  const GAP = 28;
  const TOP = 18;
  const neck = WIDTH - LEFT - RIGHT;
  const height = $derived(TOP * 2 + Math.max(0, tuning.length - 1) * GAP + 16);

  // Right-handed puts the nut on the left. Left-handed mirrors the neck.
  function x(share: number): number {
    const along = LEFT + share * neck;
    return leftHanded ? WIDTH - along : along;
  }
  function y(string: number): number {
    return TOP + string * GAP;
  }

  const fretNumbers = $derived(Array.from({ length: frets }, (_, index) => index + 1));
  const middle = $derived(TOP + ((tuning.length - 1) * GAP) / 2);

  function text(note: FretNote): string {
    return dotLabel(label, noteMidi(tuning, capo, note), note.fret, root);
  }
  function describe(note: FretNote): string {
    return t("fretboard.noteAt", { string: note.string + 1, fret: note.fret });
  }
  const strong = $derived(new Set(current.map((note) => `${note.string}:${note.fret}`)));
  // A note that is already lit is not drawn again as an upcoming one.
  const upcoming = $derived(
    next
      .slice()
      .reverse()
      .flatMap((group) =>
        group.notes
          .filter((note) => !strong.has(`${note.string}:${note.fret}`))
          .map((note) => ({ note, rank: group.rank })),
      ),
  );
  const summary = $derived(
    current.length
      ? t("fretboard.now", { notes: current.map(describe).join(", ") })
      : t("fretboard.idle"),
  );
</script>

<figure class="fretboard" data-testid="fretboard" data-left-handed={leftHanded || undefined}>
  <svg
    viewBox={`0 0 ${WIDTH} ${height}`}
    role="img"
    aria-label={t("fretboard.label", { strings: tuning.length })}
    preserveAspectRatio="xMidYMid meet"
  >
    {#each [...SINGLE_INLAYS, ...DOUBLE_INLAYS].filter((fret) => fret <= frets) as fret (fret)}
      {#if DOUBLE_INLAYS.includes(fret)}
        <circle class="inlay" cx={x(dotPosition(fret, frets))} cy={middle - GAP * 0.9} r="5" />
        <circle class="inlay" cx={x(dotPosition(fret, frets))} cy={middle + GAP * 0.9} r="5" />
      {:else}
        <circle class="inlay" cx={x(dotPosition(fret, frets))} cy={middle} r="5" />
      {/if}
    {/each}
    <line
      class="nut"
      x1={x(0)}
      x2={x(0)}
      y1={y(0) - 8}
      y2={y(tuning.length - 1) + 8}
      stroke-width={capo > 0 ? 7 : 5}
    />
    {#each fretNumbers as fret (fret)}
      <line
        class="fret"
        x1={x(fretPosition(fret, frets))}
        x2={x(fretPosition(fret, frets))}
        y1={y(0) - 8}
        y2={y(tuning.length - 1) + 8}
      />
    {/each}
    {#each tuning as _, string (string)}
      <line
        class="string"
        x1={x(0)}
        x2={x(1)}
        y1={y(string)}
        y2={y(string)}
        stroke-width={1 + (string / Math.max(1, tuning.length - 1)) * 2}
      />
    {/each}
    {#each upcoming as item (`${item.rank}:${item.note.string}:${item.note.fret}`)}
      <g
        class="dot next"
        data-testid="fretboard-next"
        data-rank={item.rank}
        opacity={Math.max(0.15, 0.55 - (item.rank - 1) * 0.18)}
      >
        <circle cx={x(dotPosition(item.note.fret, frets))} cy={y(item.note.string)} r="11" />
        {#if text(item.note)}
          <text x={x(dotPosition(item.note.fret, frets))} y={y(item.note.string)}
            >{text(item.note)}</text
          >
        {/if}
      </g>
    {/each}
    {#each current as note (`${note.string}:${note.fret}`)}
      <g class="dot now" data-testid="fretboard-now">
        <circle cx={x(dotPosition(note.fret, frets))} cy={y(note.string)} r="12" />
        {#if text(note)}
          <text x={x(dotPosition(note.fret, frets))} y={y(note.string)}>{text(note)}</text>
        {/if}
      </g>
    {/each}
    {#if onselect}
      {#each tuning as _, string (string)}
        {#each Array.from({ length: frets + 1 }, (_, fret) => fret) as fret (fret)}
          <circle
            class="tap"
            data-testid={`fret-tap-${string}-${fret}`}
            role="button"
            tabindex="-1"
            aria-label={describe({ string, fret })}
            cx={x(dotPosition(fret, frets))}
            cy={y(string)}
            r="13"
            onclick={() => onselect({ string, fret })}
            onkeydown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onselect({ string, fret });
              }
            }}
          />
        {/each}
      {/each}
    {/if}
    {#each [3, 5, 7, 9, 12, 15, 17, 19, 21, 24].filter((fret) => fret <= frets) as fret (fret)}
      <text class="fret-number" x={x(dotPosition(fret, frets))} y={height - 3}>{fret}</text>
    {/each}
  </svg>
  <figcaption class="muted small">
    {#if capo > 0}<span data-testid="fretboard-capo">{t("fretboard.capo", { fret: capo })}</span>
      ·
    {/if}<span aria-live="polite" data-testid="fretboard-summary">{summary}</span>
  </figcaption>
</figure>

<style>
  .fretboard {
    margin: 0;
    width: 100%;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    max-height: 220px;
  }
  .string {
    stroke: var(--text-3);
  }
  .fret {
    stroke: var(--line-strong);
    stroke-width: 2;
  }
  .nut {
    stroke: var(--text);
  }
  .inlay {
    fill: var(--line-strong);
    opacity: 0.5;
  }
  .dot circle {
    fill: var(--accent);
  }
  .dot.next circle {
    fill: var(--accent);
  }
  .dot.now circle {
    stroke: var(--text);
    stroke-width: 2;
  }
  .dot text {
    fill: #fff;
    font-size: 12px;
    font-weight: 600;
    text-anchor: middle;
    dominant-baseline: central;
  }
  .tap {
    fill: transparent;
    cursor: pointer;
  }
  .tap:hover {
    fill: var(--accent);
    opacity: 0.25;
  }
  .fret-number {
    fill: var(--text-3);
    font-size: 11px;
    text-anchor: middle;
  }
  /* One line, always the same height, so the score doesn't shift as the notes change. */
  figcaption {
    text-align: center;
    min-height: 1.4em;
    line-height: 1.4;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
