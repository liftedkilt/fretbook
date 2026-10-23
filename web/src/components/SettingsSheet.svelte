<script lang="ts">
  import Icon from "./Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import { apiUrl } from "../lib/api";
  import { currentLocale, locales, setLocale, t, tOr } from "../lib/i18n.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import { closeSheet, setDefaultInstrument, setTheme, ui, type Theme } from "../lib/ui.svelte";
  import { ytdlpHealth } from "../lib/ytdlp";

  let error = $state("");

  const themes: { id: Theme; icon: string; key: string }[] = [
    { id: "system", icon: "monitor", key: "settings.themeSystem" },
    { id: "dark", icon: "moon", key: "settings.themeDark" },
    { id: "light", icon: "sun", key: "settings.themeLight" },
  ];

  async function changeDefault(next: string) {
    error = "";
    try {
      await setDefaultInstrument(next);
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }
</script>

<Sheet open={ui.sheet === "settings"} title={t("settings.heading")} testid="settings-sheet" onclose={closeSheet}>
  <div class="settings-list">
    {#if ui.me?.authenticated}
      <section class="setting">
        <div class="setting-label">
          <span class="setting-icon"><Icon name="users" /></span>
          <div>
            <strong data-testid="account-name">{ui.me.display_name}</strong>
            <p class="muted">{ui.me.email}{ui.me.role === "admin" ? ` · ${t("admin.roleAdmin")}` : ""}</p>
          </div>
        </div>
        <div class="account-row">
          {#if ui.me.role === "admin"}
            <a
              class="button"
              href={hrefFor("/admin")}
              onclick={(event) => {
                closeSheet();
                followLink(event, "/admin");
              }}
            >
              <Icon name="users" size={16} />{t("account.admin")}
            </a>
          {/if}
          <form method="post" action={apiUrl("/auth/logout")}>
            <button type="submit" data-testid="sign-out"><Icon name="logout" size={16} />{t("account.signOut")}</button>
          </form>
        </div>
      </section>
    {/if}

    <section class="setting">
      <div class="setting-label">
        <span class="setting-icon"><Icon name="guitar" /></span>
        <div>
          <strong>{t("settings.defaultInstrument")}</strong>
          <p class="muted">{t("settings.defaultInstrumentHint")}</p>
        </div>
      </div>
      <select
        value={ui.defaultInstrument}
        aria-label={t("settings.defaultInstrument")}
        onchange={(event) => void changeDefault(event.currentTarget.value)}
      >
        {#each ui.presets as item (item.id)}
          <option value={item.id}>{tOr(item.label_key, item.label)}</option>
        {/each}
      </select>
    </section>

    <section class="setting">
      <div class="setting-label">
        <span class="setting-icon"><Icon name="globe" /></span>
        <strong>{t("language.label")}</strong>
      </div>
      <select data-testid="language-select" value={currentLocale()} aria-label={t("language.label")} onchange={(event) => setLocale(event.currentTarget.value)}>
        {#each locales as item (item.id)}
          <option value={item.id}>{t(item.labelKey)}</option>
        {/each}
      </select>
    </section>

    <section class="setting">
      <div class="setting-label">
        <span class="setting-icon"><Icon name="sun" /></span>
        <strong>{t("settings.theme")}</strong>
      </div>
      <div class="segmented" role="radiogroup" aria-label={t("settings.theme")}>
        {#each themes as item (item.id)}
          <button role="radio" aria-checked={ui.theme === item.id} onclick={() => setTheme(item.id)}>
            <Icon name={item.icon} size={16} />{t(item.key)}
          </button>
        {/each}
      </div>
    </section>
    {#if ui.version}
      <section class="setting" data-testid="about-setting">
        <div class="setting-label">
          <span class="setting-icon"><Icon name="info" /></span>
          <div>
            <strong>{t("about.label")}</strong>
            <p class="muted">
              {t("about.version", { version: ui.version })}{#if ui.commit} · {t("about.commit", { commit: ui.commit.slice(0, 7) })}{/if}
            </p>
          </div>
        </div>
      </section>
    {/if}
    {#if ui.ytdlp}
      <section class="setting setting-stacked" data-testid="ytdlp-setting">
        <div class="setting-label">
          <span class="setting-icon"><Icon name="download" /></span>
          <div>
            <strong>{t("ytdlp.label")}</strong>
            <p class="muted">{t("ytdlp.hint")}</p>
            <p class="muted">
              {#if ui.ytdlp.version}
                {t("ytdlp.version", { version: ui.ytdlp.version })}
                {#if ui.ytdlp.released && ui.ytdlp.age_days !== null}
                  · {t("ytdlp.released", { date: ui.ytdlp.released, count: ui.ytdlp.age_days })}
                {/if}
              {:else}
                {t("ytdlp.unknown")}
              {/if}
              {ui.ytdlp.auto_update ? t("ytdlp.autoUpdateOn") : t("ytdlp.autoUpdateOff")}
            </p>
          </div>
        </div>
        {#if ytdlpHealth(ui.ytdlp) === "stale"}
          <p class="notice setting-notice" role="status">{t("ytdlp.stale", { count: ui.ytdlp.age_days ?? 0 })}</p>
        {/if}
      </section>
    {/if}
    {#if error}<p class="alert" role="alert">{error}</p>{/if}
  </div>
</Sheet>
