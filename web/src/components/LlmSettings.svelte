<script lang="ts">
  import Icon from "./Icon.svelte";
  import { getLlmStatus, removeOwnLlmKey, saveOwnLlmKey } from "../lib/api";
  import type { LlmStatus } from "../lib/api-types";
  import { t } from "../lib/i18n.svelte";

  let status = $state<LlmStatus | null>(null);
  let key = $state("");
  let error = $state("");

  function message(err: unknown): string {
    return err instanceof Error ? err.message : t("error.generic");
  }

  $effect(() => {
    getLlmStatus()
      .then((value) => (status = value))
      .catch((err) => (error = message(err)));
  });

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (key.trim().length < 8) return;
    error = "";
    try {
      status = await saveOwnLlmKey(key.trim());
      key = "";
    } catch (err) {
      error = message(err);
    }
  }

  async function remove() {
    if (!confirm(t("llm.removeConfirm"))) return;
    error = "";
    try {
      status = await removeOwnLlmKey();
    } catch (err) {
      error = message(err);
    }
  }

  function limit(used: number, max: number | null): string {
    return max === null ? String(used) : `${used} / ${max}`;
  }
</script>

<section class="setting setting-stacked" data-testid="llm-settings">
  <div class="setting-label">
    <span class="setting-icon"><Icon name="sparkle" /></span>
    <div>
      <strong>{t("llm.heading")}</strong>
      <p class="muted">{t("llm.hint")}</p>
    </div>
  </div>
  {#if status}
    {#if status.provider === "none"}
      <p class="muted" data-testid="llm-state">{t("llm.off")}</p>
    {:else}
      <p class="muted" data-testid="llm-state">
        {#if status.available}
          {#if status.source === "shared"}
            {t("llm.using.shared", { model: status.model })}
          {:else if status.source === "local"}
            {t("llm.using.local", { model: status.model })}
          {:else}
            {t("llm.using.own", { model: status.model })}
          {/if}
        {:else if status.mode === "disabled"}
          {t("llm.disabled")}
        {:else}
          {t("llm.needKey")}
        {/if}
      </p>
      {#if status.source === "shared" || status.source === "local"}
        <p class="muted" data-testid="llm-usage">
          {t("llm.usage", {
            today: limit(status.generations_today, status.daily_limit),
            month: limit(status.generations_month, status.monthly_limit),
          })}
        </p>
      {/if}
      {#if status.needs_key && status.mode !== "disabled"}
        <form class="account-row" onsubmit={save}>
          <input
            type="password"
            autocomplete="off"
            maxlength="500"
            bind:value={key}
            placeholder={status.has_own_key ? t("llm.keySaved") : t("llm.keyPlaceholder")}
            aria-label={t("llm.keyLabel")}
            data-testid="llm-key"
          />
          <button type="submit" disabled={key.trim().length < 8} data-testid="llm-key-save">
            {t("llm.keySave")}
          </button>
          {#if status.has_own_key}
            <button type="button" onclick={() => void remove()} data-testid="llm-key-remove">
              <Icon name="trash" size={16} />{t("llm.keyRemove")}
            </button>
          {/if}
        </form>
        <p class="muted">{t("llm.keyHint")}</p>
      {/if}
    {/if}
  {/if}
  {#if error}<p class="alert" role="alert">{error}</p>{/if}
</section>
