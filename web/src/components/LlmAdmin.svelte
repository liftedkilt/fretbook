<script lang="ts">
  import Icon from "./Icon.svelte";
  import {
    clearLlmNotices,
    getLlmSettings,
    listLlmNotices,
    listLlmUsage,
    listLlmUsers,
    saveLlmSettings,
    saveLlmUser,
  } from "../lib/api";
  import type { LlmNotice, LlmSettings, LlmUsageRow, LlmUserAccess } from "../lib/api-types";
  import { t } from "../lib/i18n.svelte";

  type Provider = LlmSettings["provider"];

  const defaultUrl: Record<Provider, string> = {
    none: "",
    ollama: "http://localhost:11434",
    anthropic: "https://api.anthropic.com",
    openai: "https://api.openai.com/v1",
  };

  let open = $state(false);
  let loaded = $state<LlmSettings | null>(null);
  let provider = $state<Provider>("none");
  let baseUrl = $state("");
  let model = $state("");
  let adminKey = $state("");
  let cap = $state<number | null>(null);
  let rate = $state(5);
  let users = $state<LlmUserAccess[]>([]);
  let usage = $state<LlmUsageRow[]>([]);
  let notices = $state<LlmNotice[]>([]);
  let error = $state("");
  let saved = $state(false);

  const hosted = $derived(provider === "anthropic" || provider === "openai");

  function message(err: unknown): string {
    return err instanceof Error ? err.message : t("error.generic");
  }

  function apply(value: LlmSettings) {
    loaded = value;
    provider = value.provider;
    baseUrl = value.base_url;
    model = value.model;
    cap = value.instance_monthly_cap_usd;
    rate = value.rate_limit_per_minute;
    adminKey = "";
  }

  function num(value: string): number | null {
    const parsed = Number.parseFloat(value);
    return value.trim() === "" || Number.isNaN(parsed) ? null : parsed;
  }

  async function load() {
    error = "";
    try {
      const [settings, people, log, warned] = await Promise.all([
        getLlmSettings(),
        listLlmUsers(),
        listLlmUsage(),
        listLlmNotices(),
      ]);
      apply(settings);
      users = people;
      usage = log;
      notices = warned;
    } catch (err) {
      error = message(err);
    }
  }

  async function toggle() {
    open = !open;
    if (open) await load();
  }

  async function save(event: SubmitEvent, clearKey = false) {
    event.preventDefault();
    error = "";
    saved = false;
    try {
      apply(
        await saveLlmSettings({
          provider,
          base_url: baseUrl,
          model,
          instance_monthly_cap_usd: cap,
          rate_limit_per_minute: rate,
          admin_key: adminKey.trim() || null,
          clear_admin_key: clearKey,
        }),
      );
      saved = true;
    } catch (err) {
      error = message(err);
    }
  }

  async function saveUser(user: LlmUserAccess) {
    error = "";
    try {
      const row = await saveLlmUser(user.user_id, {
        mode: user.mode,
        daily_limit: user.daily_limit,
        monthly_limit: user.monthly_limit,
        monthly_spend_cap_usd: user.monthly_spend_cap_usd,
      });
      users = users.map((item) => (item.user_id === row.user_id ? row : item));
    } catch (err) {
      error = message(err);
    }
  }

  function setLimit(user: LlmUserAccess, field: "daily_limit" | "monthly_limit", value: string) {
    const parsed = num(value);
    user[field] = parsed === null ? null : Math.round(parsed);
  }

  async function dismissNotices() {
    await clearLlmNotices();
    notices = [];
  }

  function noticeText(notice: LlmNotice): string {
    const params = { name: notice.user_name };
    if (notice.limit_kind === "daily") return t("llmAdmin.notice.daily", params);
    if (notice.limit_kind === "monthly") return t("llmAdmin.notice.monthly", params);
    return t("llmAdmin.notice.spend", params);
  }

  function sourceText(source: LlmUsageRow["key_source"]): string {
    if (source === "shared") return t("llmAdmin.source.shared");
    if (source === "local") return t("llmAdmin.source.local");
    return t("llmAdmin.source.own");
  }

  function money(value: number): string {
    return `$${value.toFixed(4)}`;
  }
</script>

<section class="setting setting-stacked" data-testid="llm-admin">
  <div class="setting-label">
    <span class="setting-icon"><Icon name="sparkle" /></span>
    <div>
      <strong>{t("llmAdmin.heading")}</strong>
      <p class="muted">{t("llmAdmin.hint")}</p>
    </div>
  </div>
  <div class="account-row">
    <button
      type="button"
      aria-expanded={open}
      onclick={() => void toggle()}
      data-testid="llm-admin-toggle"
    >
      {open ? t("llmAdmin.hide") : t("llmAdmin.manage")}
    </button>
  </div>
  {#if open && loaded}
    {#if notices.length}
      <div class="notice" role="status" data-testid="llm-notices">
        {#each notices as notice (notice.user_id + notice.limit_kind + notice.period)}
          <p>{noticeText(notice)}</p>
        {/each}
        <button type="button" onclick={() => void dismissNotices()}>{t("llmAdmin.dismiss")}</button>
      </div>
    {/if}
    <form class="llm-form" onsubmit={(event) => void save(event)}>
      <label>
        {t("llmAdmin.provider")}
        <select bind:value={provider} data-testid="llm-provider">
          {#each ["none", "ollama", "anthropic", "openai"] as item (item)}
            <option value={item}>{t(`llmAdmin.providers.${item}`)}</option>
          {/each}
        </select>
      </label>
      {#if provider !== "none"}
        <label>
          {provider === "ollama" ? t("llmAdmin.ollamaUrl") : t("llmAdmin.baseUrl")}
          <input
            type="url"
            bind:value={baseUrl}
            placeholder={defaultUrl[provider]}
            data-testid="llm-url"
          />
        </label>
        <label>
          {t("llmAdmin.model")}
          <input type="text" bind:value={model} maxlength="200" data-testid="llm-model" />
        </label>
      {/if}
      {#if hosted}
        <label>
          {t("llmAdmin.adminKey")}
          <input
            type="password"
            autocomplete="off"
            bind:value={adminKey}
            placeholder={loaded.has_admin_key ? t("llm.keySaved") : t("llm.keyPlaceholder")}
            data-testid="llm-admin-key"
          />
        </label>
        <label>
          {t("llmAdmin.instanceCap")}
          <input type="number" min="0" step="0.01" bind:value={cap} data-testid="llm-cap" />
        </label>
        <p class="muted" data-testid="llm-instance-usage">
          {t("llmAdmin.instanceUsage", {
            cost: money(loaded.admin_spend_month_usd),
            count: loaded.admin_generations_month,
          })}
        </p>
      {/if}
      {#if provider !== "none"}
        <label>
          {t("llmAdmin.rate")}
          <input type="number" min="1" max="600" bind:value={rate} data-testid="llm-rate" />
        </label>
      {/if}
      <div class="account-row">
        <button type="submit" data-testid="llm-save">{t("llmAdmin.save")}</button>
        {#if hosted && loaded.has_admin_key}
          <button
            type="button"
            onclick={(event) => void save(event as unknown as SubmitEvent, true)}
          >
            <Icon name="trash" size={16} />{t("llmAdmin.removeKey")}
          </button>
        {/if}
        {#if saved}<span class="muted" role="status">{t("llmAdmin.saved")}</span>{/if}
      </div>
    </form>

    {#if provider !== "none"}
      <h3>{t("llmAdmin.users")}</h3>
      <ul class="token-list" data-testid="llm-users">
        {#each users as user (user.user_id)}
          <li class="llm-user">
            <div>
              <strong>{user.display_name}</strong>
              <p class="muted">
                {t("llmAdmin.userUsage", {
                  today: user.generations_today,
                  month: user.generations_month,
                  cost: money(user.cost_month_usd),
                })}{user.has_own_key ? ` · ${t("llmAdmin.hasOwnKey")}` : ""}
              </p>
            </div>
            <div class="account-row">
              <select
                bind:value={user.mode}
                aria-label={t("llmAdmin.mode", { name: user.display_name })}
                data-testid="llm-user-mode"
              >
                {#each ["own_key", "shared", "disabled"] as item (item)}
                  <option value={item}>{t(`llmAdmin.modes.${item}`)}</option>
                {/each}
              </select>
              <input
                type="number"
                min="0"
                value={user.daily_limit ?? ""}
                oninput={(event) => setLimit(user, "daily_limit", event.currentTarget.value)}
                placeholder={t("llmAdmin.noLimit")}
                aria-label={t("llmAdmin.daily", { name: user.display_name })}
                data-testid="llm-user-daily"
              />
              <input
                type="number"
                min="0"
                value={user.monthly_limit ?? ""}
                oninput={(event) => setLimit(user, "monthly_limit", event.currentTarget.value)}
                placeholder={t("llmAdmin.noLimit")}
                aria-label={t("llmAdmin.monthly", { name: user.display_name })}
                data-testid="llm-user-monthly"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                value={user.monthly_spend_cap_usd ?? ""}
                oninput={(event) => (user.monthly_spend_cap_usd = num(event.currentTarget.value))}
                placeholder={t("llmAdmin.noLimit")}
                aria-label={t("llmAdmin.spend", { name: user.display_name })}
                data-testid="llm-user-spend"
              />
              <button type="button" onclick={() => void saveUser(user)} data-testid="llm-user-save">
                {t("llmAdmin.saveUser")}
              </button>
            </div>
          </li>
        {/each}
      </ul>
      <p class="muted">{t("llmAdmin.limitsHint")}</p>

      <h3>{t("llmAdmin.log")}</h3>
      {#if usage.length === 0}
        <p class="muted">{t("llmAdmin.logEmpty")}</p>
      {:else}
        <ul class="token-list" data-testid="llm-log">
          {#each usage as row (row.id)}
            <li>
              <span>
                <strong>{row.user_name}</strong>
                <span class="muted">
                  · {new Date(row.at).toLocaleString()} · {row.model} · {t("llmAdmin.tokens", {
                    input: row.input_tokens,
                    output: row.output_tokens,
                  })} · {money(row.cost_usd)} · {sourceText(row.key_source)}
                </span>
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  {/if}
  {#if error}<p class="alert" role="alert">{error}</p>{/if}
</section>
