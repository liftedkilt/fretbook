<script lang="ts">
  import Cover from "./Cover.svelte";
  import { getRecommendations } from "../lib/api";
  import { levelOf } from "../lib/difficulty";
  import { t } from "../lib/i18n.svelte";
  import { agoDays, localDay } from "../lib/practiceLog";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { ContentKind, Recommendations } from "../lib/types";

  let recs = $state<Recommendations | null>(null);
  const today = localDay(new Date());

  $effect(() => {
    // Suggestions are a nicety: if they cannot load the page simply goes without.
    getRecommendations(today)
      .then((loaded) => (recs = loaded))
      .catch(() => {});
  });

  type Card = {
    key: string;
    kind: "stretch" | "revisit" | "review";
    id: string;
    title: string;
    contentKind: ContentKind;
    reason: string;
    detail: string;
  };

  function ago(day: string): string {
    const days = agoDays(day, today);
    return days === 0
      ? t("practiceLog.today")
      : days === 1
        ? t("practiceLog.yesterday")
        : t("practiceLog.daysAgo", { count: days });
  }

  const cards = $derived.by((): Card[] => {
    if (!recs) return [];
    return [
      ...recs.stretch.map((song) => ({
        key: `stretch:${song.song_id}`,
        kind: "stretch" as const,
        id: song.song_id,
        title: song.title,
        contentKind: song.content_kind,
        reason:
          song.difficulty !== null
            ? `${t("difficulty.recs.stretch")} · ${t("difficulty.level", { level: levelOf(song.difficulty) })}`
            : t("difficulty.recs.stretch"),
        detail: song.artist,
      })),
      ...recs.revisit.map((loop) => ({
        key: `revisit:${loop.song_id}:${loop.loop_start}:${loop.loop_end}:${loop.loop_name}`,
        kind: "revisit" as const,
        id: loop.song_id,
        title: loop.title,
        contentKind: loop.content_kind,
        reason: t("practiceHome.loopScored", { percent: Math.round(loop.score) }),
        detail:
          loop.loop_name ||
          t("practiceLog.bars", { from: loop.loop_start + 1, to: loop.loop_end + 1 }),
      })),
      ...recs.review.map((song) => ({
        key: `review:${song.song_id}`,
        kind: "review" as const,
        id: song.song_id,
        title: song.title,
        contentKind: song.content_kind,
        reason: t("difficulty.recs.review"),
        detail: ago(song.last_day),
      })),
    ];
  });
</script>

{#if recs && cards.length}
  <section class="recs" data-testid="practice-recommendations" aria-labelledby="recs-heading">
    <h2 id="recs-heading">{t("practiceHome.upNext")}</h2>
    {#if recs.level !== null}
      <p class="muted level" data-testid="recs-level">
        {recs.level_basis === "scored"
          ? t("difficulty.recs.level.scored", { level: levelOf(recs.level) })
          : t("difficulty.recs.level.practised", { level: levelOf(recs.level) })}
      </p>
    {/if}
    <ul class="cards">
      {#each cards as card (card.key)}
        <li>
          <a
            class="card"
            data-testid={`recs-${card.kind}`}
            href={hrefFor(`/songs/${card.id}`)}
            onclick={(event) => followLink(event, `/songs/${card.id}`)}
          >
            <span class="art">
              <Cover
                id={card.id}
                title={card.title}
                kind={card.contentKind === "chords" ? "chords" : "tab"}
                size="md"
              />
            </span>
            <span class="text">
              <span class="reason">{card.reason}</span>
              <strong>{card.title}</strong>
              {#if card.detail}<span class="muted detail">{card.detail}</span>{/if}
            </span>
          </a>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .recs {
    display: grid;
    gap: var(--sp-3);
    min-width: 0;
  }

  h2 {
    margin: 0;
    font-size: var(--fs-h2);
  }

  .level {
    margin: 0;
    font-size: var(--fs-sm);
  }

  .cards {
    display: grid;
    gap: var(--sp-3);
    margin: 0;
    padding: 0;
    list-style: none;
    grid-template-columns: repeat(auto-fill, minmax(min(15rem, 100%), 1fr));
  }

  .card {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    min-height: 44px;
    padding: var(--sp-3);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface);
    color: inherit;
    text-decoration: none;
    min-width: 0;
  }

  .card:hover {
    border-color: var(--line-strong);
    background: var(--surface-2);
  }

  .art {
    flex: none;
    width: 64px;
  }

  .text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .text > * {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reason {
    color: var(--accent-text);
    font-size: var(--fs-xs);
    font-weight: 650;
  }

  .detail {
    font-size: var(--fs-sm);
  }
</style>
