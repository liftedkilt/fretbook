<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../lib/i18n.svelte";
  import { dropOp } from "../lib/offline/queueState.svelte";
  import { flushQueue, offline, opsQueue, queue, resolveEdit } from "../lib/offline/offline.svelte";

  let error = $state("");
  let busy = $state(false);

  const waiting = $derived(
    queue.edits.filter((edit) => edit.state === "pending").length +
      opsQueue.ops.filter((item) => item.state === "pending").length,
  );
  const refused = $derived(opsQueue.ops.filter((item) => item.state === "failed"));
  const stuck = $derived(queue.edits.filter((edit) => edit.state !== "pending"));

  async function settle(songId: string, keep: "mine" | "theirs") {
    busy = true;
    error = "";
    try {
      await resolveEdit(songId, keep);
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    } finally {
      busy = false;
    }
  }
</script>

{#if !offline.online || waiting > 0 || stuck.length > 0 || refused.length > 0}
  <div class="offline-status" data-testid="offline-status">
    {#if !offline.online}
      <p class="status-line" role="status" data-testid="offline-indicator">
        <Icon name="alert" size={16} /><strong>{t("offline.indicator")}</strong>
        <span class="muted">{t("offline.indicatorHint")}</span>
      </p>
    {/if}
    {#if waiting > 0}
      <p class="status-line" role="status" data-testid="offline-queued">
        <Icon name="refresh" size={16} />
        <span>{t("offline.queued", { count: waiting })}</span>
        {#if offline.online}
          <button
            type="button"
            data-testid="offline-sync"
            disabled={offline.syncing}
            onclick={() => void flushQueue()}>{t("offline.syncNow")}</button
          >
        {/if}
      </p>
    {/if}
    {#each stuck as edit (edit.songId)}
      <div class="status-line stuck" role="alert" data-testid="offline-conflict">
        <Icon name="alert" size={16} />
        <span>
          {edit.state === "conflict"
            ? t("offline.conflict", { title: edit.title })
            : t("offline.syncFailed", { title: edit.title, message: edit.message })}
        </span>
        <button
          type="button"
          data-testid="offline-keep-mine"
          disabled={busy || !offline.online}
          onclick={() => void settle(edit.songId, "mine")}>{t("offline.keepMine")}</button
        >
        <button
          type="button"
          data-testid="offline-keep-theirs"
          disabled={busy || !offline.online}
          onclick={() => void settle(edit.songId, "theirs")}>{t("offline.keepTheirs")}</button
        >
      </div>
    {/each}
    {#each refused as item (item.id)}
      <div class="status-line stuck" role="alert" data-testid="offline-op-failed">
        <Icon name="alert" size={16} />
        <span>{t("offline.opFailed", { message: item.message })}</span>
        <button type="button" data-testid="offline-op-dismiss" onclick={() => dropOp(item.id)}
          >{t("offline.dismiss")}</button
        >
      </div>
    {/each}
    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
  </div>
{/if}

<style>
  .offline-status {
    display: grid;
    gap: 0.4rem;
    margin-bottom: 1rem;
  }
  .status-line {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-radius: 10px;
    background: var(--warn-soft);
    color: var(--text);
    font-size: 0.9rem;
  }
  .stuck {
    background: var(--danger-soft);
  }
</style>
