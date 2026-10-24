<script lang="ts">
  import { getSongPractice } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { formatDuration } from "../lib/practiceLog";
  import { formatSpeedPercent } from "../lib/practice";
  import type { SongPractice } from "../lib/types";

  let { songId }: { songId: string } = $props();

  let history = $state<SongPractice | null>(null);

  $effect(() => {
    const id = songId;
    let cancel = false;
    history = null;
    // The history is a nicety: if it cannot load the page simply goes without.
    getSongPractice(id)
      .then((loaded) => {
        if (!cancel) history = loaded;
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  });

  function when(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime())
      ? iso
      : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  }

  function what(session: SongPractice["sessions"][number]): string {
    const parts = [
      session.mode === "wait"
        ? t("practiceLog.mode.wait")
        : session.mode === "scored"
          ? t("practiceLog.mode.scored")
          : t("practiceLog.mode.free"),
    ];
    if (session.loop_name) parts.push(session.loop_name);
    else if (session.loop_start !== null && session.loop_end !== null)
      parts.push(t("practiceLog.bars", { from: session.loop_start + 1, to: session.loop_end + 1 }));
    return parts.join(" · ");
  }
</script>

{#if history && history.session_count > 0}
  <details class="song-practice no-print" data-testid="song-practice">
    <summary>
      {t("practiceLog.songHeading")}
      <span class="muted">
        {t("practiceLog.songSummary", {
          sessions: history.session_count,
          time: formatDuration(history.total_seconds),
        })}
      </span>
    </summary>
    <p class="muted totals">
      {#if history.best_speed !== null}{t("practiceLog.bestSpeed", {
          speed: formatSpeedPercent(history.best_speed),
        })}{/if}
      {#if history.best_score !== null}
        · {t("practiceLog.bestScore", { score: Math.round(history.best_score) })}{/if}
    </p>
    <ul>
      {#each history.sessions as session (session.id)}
        <li data-testid="song-practice-row">
          <span>{when(session.started_at)}</span>
          <span class="muted">{what(session)}</span>
          <span class="muted">{formatSpeedPercent(session.speed)}</span>
          <strong>{formatDuration(session.duration_seconds)}</strong>
        </li>
      {/each}
    </ul>
  </details>
{/if}

<style>
  .song-practice {
    max-width: 960px;
    margin: 1rem auto 2rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    padding: 0.75rem 1rem;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .totals {
    margin: 0.5rem 0;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.35rem;
  }
  li {
    display: grid;
    grid-template-columns: 1fr 1fr auto auto;
    gap: 0.75rem;
    font-size: 0.9rem;
  }
  @media (max-width: 600px) {
    li {
      grid-template-columns: 1fr auto;
    }
  }
</style>
