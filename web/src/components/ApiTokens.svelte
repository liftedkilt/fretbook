<script lang="ts">
  import Icon from "./Icon.svelte";
  import { createApiToken, listApiTokens, revokeApiToken } from "../lib/api";
  import type { ApiToken } from "../lib/api-types";
  import { currentLocale, t } from "../lib/i18n.svelte";
  import { ui } from "../lib/ui.svelte";

  const expiries = [
    { days: null, key: "apiTokens.expiryNever" },
    { days: 30, key: "apiTokens.expiry30" },
    { days: 90, key: "apiTokens.expiry90" },
    { days: 365, key: "apiTokens.expiry365" },
  ];

  let open = $state(false);
  let loading = $state(false);
  let tokens = $state<ApiToken[]>([]);
  let name = $state("");
  let days = $state<number | null>(null);
  let secret = $state("");
  let copied = $state(false);
  let error = $state("");

  // Tokens are managed from a session. Single-user mode has none, so it is always allowed.
  const available = $derived(ui.me !== null);

  function day(iso: string): string {
    return new Date(iso).toLocaleDateString(currentLocale());
  }

  async function toggle() {
    open = !open;
    secret = "";
    if (!open) return;
    error = "";
    loading = true;
    try {
      tokens = await listApiTokens();
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    } finally {
      loading = false;
    }
  }

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    error = "";
    try {
      const made = await createApiToken(name.trim(), days);
      secret = made.token;
      copied = false;
      name = "";
      tokens = await listApiTokens();
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(secret);
      copied = true;
    } catch {
      // The token stays selectable in the field below.
    }
  }

  async function revoke(token: ApiToken) {
    if (!confirm(t("apiTokens.revokeConfirm", { name: token.name }))) return;
    error = "";
    try {
      await revokeApiToken(token.id);
      tokens = tokens.filter((item) => item.id !== token.id);
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }
</script>

{#if available}
  <section class="setting setting-stacked" data-testid="api-tokens">
    <div class="setting-label">
      <span class="setting-icon"><Icon name="link" /></span>
      <div>
        <strong>{t("apiTokens.heading")}</strong>
        <p class="muted">{t("apiTokens.hint")}</p>
      </div>
    </div>
    <div class="account-row">
      <button
        type="button"
        aria-expanded={open}
        onclick={() => void toggle()}
        data-testid="tokens-toggle"
      >
        {open ? t("apiTokens.hide") : t("apiTokens.manage")}
      </button>
    </div>
    {#if open}
      {#if secret}
        <div class="notice" role="status" data-testid="new-token">
          <p>{t("apiTokens.created")}</p>
          <input
            class="token-secret"
            readonly
            value={secret}
            aria-label={t("apiTokens.heading")}
            onfocus={(event) => event.currentTarget.select()}
          />
          <div class="account-row">
            <button type="button" onclick={() => void copy()} data-testid="token-copy">
              {copied ? t("apiTokens.copied") : t("apiTokens.copy")}
            </button>
            <button type="button" onclick={() => (secret = "")}>{t("apiTokens.dismiss")}</button>
          </div>
        </div>
      {/if}
      <form class="account-row" onsubmit={create}>
        <input
          type="text"
          maxlength="80"
          bind:value={name}
          placeholder={t("apiTokens.namePlaceholder")}
          aria-label={t("apiTokens.nameLabel")}
          data-testid="token-name"
        />
        <select
          bind:value={days}
          aria-label={t("apiTokens.expiryLabel")}
          data-testid="token-expiry"
        >
          {#each expiries as item (item.key)}
            <option value={item.days}>{t(item.key)}</option>
          {/each}
        </select>
        <button type="submit" disabled={!name.trim()} data-testid="token-create">
          {t("apiTokens.create")}
        </button>
      </form>
      {#if loading}
        <p class="muted">{t("apiTokens.loading")}</p>
      {:else if tokens.length === 0}
        <p class="muted">{t("apiTokens.empty")}</p>
      {:else}
        <ul class="token-list">
          {#each tokens as token (token.id)}
            <li data-testid="token-row">
              <div>
                <strong>{token.name}</strong>
                <p class="muted">
                  <code>{token.prefix}…</code>
                  · {t("apiTokens.createdOn", { date: day(token.created_at) })}
                  · {token.expires_at
                    ? t("apiTokens.expiresOn", { date: day(token.expires_at) })
                    : t("apiTokens.neverExpires")}
                  · {token.last_used_at
                    ? t("apiTokens.lastUsed", { date: day(token.last_used_at) })
                    : t("apiTokens.neverUsed")}
                </p>
              </div>
              <button type="button" onclick={() => void revoke(token)}>
                <Icon name="trash" size={16} />{t("apiTokens.revoke")}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
    {#if error}<p class="alert" role="alert">{error}</p>{/if}
  </section>
{/if}
