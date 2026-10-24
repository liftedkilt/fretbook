<script lang="ts">
  import { getRecommendations } from "../lib/api";
  import { levelOf } from "../lib/difficulty";
  import { t } from "../lib/i18n.svelte";
  import { agoDays, localDay } from "../lib/practiceLog";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import type { Recommendations } from "../lib/types";

  let recs = $state<Recommendations | null>(null);
  const today = localDay(new Date());

  $effect(() => {
    // Suggestions are a nicety: if they cannot load the page simply goes without.
    getRecommendations(today)
      .then((loaded) => (recs = loaded))
      .catch(() => {});
  });

  const songPath = (id: string) => `/songs/${id}`;

  function ago(day: string): string {
    const days = agoDays(day, today);
    return days === 0
      ? t("practiceLog.today")
      : days === 1
        ? t("practiceLog.yesterday")
        : t("practiceLog.daysAgo", { count: days });
  }

  const nothing = $derived(
    recs !== null && !recs.stretch.length && !recs.revisit.length && !recs.review.length,
  );
</script>

{#if recs && !nothing}
  <section class="recs" data-testid="practice-recommendations" aria-labelledby="recs-heading">
    <h2 id="recs-heading">{t("difficulty.recs.heading")}</h2>
    {#if recs.level !== null}
      <p class="muted" data-testid="recs-level">
        {recs.level_basis === "scored"
          ? t("difficulty.recs.level.scored", { level: levelOf(recs.level) })
          : t("difficulty.recs.level.practised", { level: levelOf(recs.level) })}
      </p>
    {/if}
    <div class="lists">
      {#if recs.stretch.length}
        <div class="card" data-testid="recs-stretch">
          <h3>{t("difficulty.recs.stretch")}</h3>
          <ul class="song-list">
            {#each recs.stretch as song (song.song_id)}
              <li>
                <a
                  href={hrefFor(songPath(song.song_id))}
                  onclick={(event) => followLink(event, songPath(song.song_id))}
                >
                  <strong>{song.title}</strong>
                  {#if song.artist}<span class="muted">{song.artist}</span>{/if}
                </a>
                {#if song.difficulty !== null}
                  <span class="muted meta"
                    >{t("difficulty.level", { level: levelOf(song.difficulty) })}</span
                  >
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if recs.revisit.length}
        <div class="card" data-testid="recs-revisit">
          <h3>{t("difficulty.recs.revisit")}</h3>
          <ul class="song-list">
            {#each recs.revisit as loop (`${loop.song_id}:${loop.loop_start}:${loop.loop_end}:${loop.loop_name}`)}
              <li>
                <a
                  href={hrefFor(songPath(loop.song_id))}
                  onclick={(event) => followLink(event, songPath(loop.song_id))}
                >
                  <strong>{loop.title}</strong>
                  <span class="muted"
                    >{loop.loop_name ||
                      t("practiceLog.bars", {
                        from: loop.loop_start + 1,
                        to: loop.loop_end + 1,
                      })}</span
                  >
                </a>
                <span class="muted meta">{Math.round(loop.score)}% · {ago(loop.last_day)}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if recs.review.length}
        <div class="card" data-testid="recs-review">
          <h3>{t("difficulty.recs.review")}</h3>
          <ul class="song-list">
            {#each recs.review as song (song.song_id)}
              <li>
                <a
                  href={hrefFor(songPath(song.song_id))}
                  onclick={(event) => followLink(event, songPath(song.song_id))}
                >
                  <strong>{song.title}</strong>
                  {#if song.artist}<span class="muted">{song.artist}</span>{/if}
                </a>
                <span class="muted meta">{ago(song.last_day)}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>
  </section>
{/if}

<style>
  .recs {
    display: grid;
    gap: 0.75rem;
  }
  .lists {
    display: grid;
    gap: 1rem;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  }
  .song-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .song-list li {
    display: flex;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .song-list a {
    display: grid;
    min-width: 0;
  }
</style>
