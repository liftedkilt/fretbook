<script lang="ts">
  import { onMount } from "svelte";

  import ApiTokens from "./ApiTokens.svelte";
  import BackupSettings from "./BackupSettings.svelte";
  import Icon from "./Icon.svelte";
  import LlmAdmin from "./LlmAdmin.svelte";
  import LlmSettings from "./LlmSettings.svelte";
  import PedalSettings from "./PedalSettings.svelte";
  import YtDlpStatus from "./YtDlpStatus.svelte";
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import SegmentedControl from "./ui/SegmentedControl.svelte";
  import {
    addDemo,
    apiUrl,
    getCalibration,
    getDemo,
    removeDemo,
    saveCalibration,
  } from "../lib/api";
  import { currentLocale, locales, setLocale, t, tOr } from "../lib/i18n.svelte";
  import {
    getLocalCalibration,
    isHighJitter,
    setLocalCalibration,
  } from "../lib/listen/calibration";
  import { getSavedDevice, saveDevice } from "../lib/listen/devicePrefs";
  import { listInputDevices, type InputDevice } from "../lib/listen/input";
  import { clearOfflineData } from "../lib/offline/offline.svelte";
  import { followLink, hrefFor } from "../lib/router.svelte";
  import { SHORTCUTS } from "../lib/shortcuts";
  import {
    openSheet,
    refreshSongs,
    setDefaultInstrument,
    setTheme,
    ui,
    type Theme,
  } from "../lib/ui.svelte";

  const DOCS_URL = "https://github.com/liftedkilt/fretbook/tree/main/docs";
  const CHANGELOG_URL = "https://github.com/liftedkilt/fretbook/blob/main/CHANGELOG.md";

  const themes: { id: Theme; icon: string; labelKey: string }[] = [
    { id: "system", icon: "monitor", labelKey: "settings.themeSystem" },
    { id: "dark", icon: "moon", labelKey: "settings.themeDark" },
    { id: "light", icon: "sun", labelKey: "settings.themeLight" },
  ];

  let error = $state("");
  let calibrationOffset = $state(0);
  let calibrationJitter = $state<number | null>(null);
  let hasCalibration = $state(false);
  let demoInstalled = $state(0);
  let demoNotice = $state("");
  let inputDevice = $state(getSavedDevice());
  let inputDevices = $state<InputDevice[]>([]);
  let shortcutsOpen = $state(false);
  let hash = $state(typeof location === "undefined" ? "" : location.hash.slice(1));

  // Single-user mode has no admin role, and the admin API refuses that user.
  // The instance manager still needs yt-dlp and the shared assistant settings.
  const singleUserInstance = $derived(
    !ui.demoMode && ui.me !== null && ui.me.authenticated === false,
  );

  const sections = $derived.by(() => {
    const items: { id: string; labelKey: string }[] = [
      { id: "general", labelKey: "settingsPage.sections.general" },
      { id: "audio", labelKey: "settingsPage.sections.audio" },
      { id: "pedals", labelKey: "settingsPage.sections.pedals" },
    ];
    if (!ui.demoMode) {
      items.push(
        { id: "library", labelKey: "settingsPage.sections.library" },
        { id: "tokens", labelKey: "settingsPage.sections.tokens" },
        { id: "assistant", labelKey: "settingsPage.sections.assistant" },
      );
    }
    if (singleUserInstance)
      items.push({ id: "instance", labelKey: "settingsPage.sections.instance" });
    items.push({ id: "about", labelKey: "settingsPage.sections.about" });
    return items;
  });

  const current = $derived(
    sections.some((item) => item.id === hash) ? hash : (sections[0]?.id ?? "general"),
  );

  const shortcutSummary = $derived.by(() => {
    const first = SHORTCUTS[0];
    if (!first) return "";
    const pair = t("settingsPage.pedalPair", { key: first.label, action: t(first.labelKey) });
    return SHORTCUTS.length > 1 ? `${pair} · …` : pair;
  });

  onMount(() => {
    void loadCurrentCalibration();
    void refreshInputs();
    if (!ui.demoMode)
      void getDemo().then(
        (demo) => (demoInstalled = demo.installed),
        () => undefined,
      );
    const readHash = () => {
      hash = location.hash.slice(1);
    };
    window.addEventListener("hashchange", readHash);
    const media = navigator.mediaDevices;
    media?.addEventListener?.("devicechange", refreshInputs);
    return () => {
      window.removeEventListener("hashchange", readHash);
      media?.removeEventListener?.("devicechange", refreshInputs);
    };
  });

  async function refreshInputs() {
    try {
      inputDevices = await listInputDevices();
    } catch {
      inputDevices = [];
    }
  }

  function chooseInput(next: string) {
    inputDevice = next;
    saveDevice(next);
  }

  async function changeDemo(add: boolean) {
    if (!add && !confirm(t("demo.confirmRemove"))) return;
    try {
      const demo = await (add ? addDemo() : removeDemo());
      demoInstalled = demo.installed;
      demoNotice = t(add ? "demo.added" : "demo.removed", { count: demo.changed });
      await refreshSongs();
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }

  async function loadCurrentCalibration() {
    const local = getLocalCalibration("default", "default");
    if (local !== null) {
      calibrationOffset = local;
      hasCalibration = true;
    }
    try {
      const remote = await getCalibration("default", "default");
      if (remote) {
        calibrationOffset = remote.offset_ms;
        calibrationJitter = remote.jitter_ms ?? null;
        hasCalibration = true;
        setLocalCalibration("default", "default", remote.offset_ms);
      }
    } catch {
      // offline / ignored
    }
  }

  async function onManualOffsetChange(val: number) {
    calibrationOffset = val;
    hasCalibration = true;
    setLocalCalibration("default", "default", val);
    try {
      await saveCalibration({
        output_device: "default",
        input_device: "default",
        offset_ms: val,
        jitter_ms: calibrationJitter,
      });
    } catch {
      // offline / ignored
    }
  }

  async function changeDefault(next: string) {
    error = "";
    try {
      await setDefaultInstrument(next);
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }
</script>

<Page width="page" testid="settings-page">
  <div class="settings">
    <PageHeader title={t("settings.heading")} subtitle={t("settingsPage.subtitle")} />

    {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}

    <div class="layout">
      <nav class="nav" aria-label={t("settingsPage.navLabel")}>
        {#each sections as section (section.id)}
          <a
            href={`${hrefFor("/settings")}#${section.id}`}
            data-testid={`settings-nav-${section.id}`}
            aria-current={current === section.id ? "location" : undefined}
          >
            {t(section.labelKey)}
          </a>
        {/each}
      </nav>

      <div class="sections">
        <section id="general" class="block" data-testid="settings-section-general">
          <h2>{t("settingsPage.sections.general")}</h2>

          {#if ui.me?.authenticated}
            <div class="row">
              <div class="copy">
                <strong data-testid="account-name">{ui.me.display_name}</strong>
                <p class="hint">
                  {ui.me.email}{ui.me.role === "admin" ? ` · ${t("admin.roleAdmin")}` : ""}
                </p>
              </div>
              <div class="actions">
                {#if ui.me.role === "admin"}
                  <a
                    class="button"
                    href={hrefFor("/admin")}
                    onclick={(event) => followLink(event, "/admin")}
                  >
                    <Icon name="users" size={16} />{t("account.admin")}
                  </a>
                {/if}
                <!-- Wipe this device's copy of the library first; the form is sent once that is done. -->
                <form
                  method="post"
                  action={apiUrl("/auth/logout")}
                  onsubmit={(event) => {
                    event.preventDefault();
                    const form = event.currentTarget;
                    void clearOfflineData()
                      .catch(() => undefined)
                      .then(() => form.submit());
                  }}
                >
                  <button type="submit" data-testid="sign-out">
                    <Icon name="logout" size={16} />{t("account.signOut")}
                  </button>
                </form>
              </div>
            </div>
          {/if}

          <div class="row">
            <div class="copy">
              <strong>{t("settings.defaultInstrument")}</strong>
              <p class="hint">{t("settings.defaultInstrumentHint")}</p>
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
          </div>

          <div class="row">
            <strong>{t("language.label")}</strong>
            <select
              data-testid="language-select"
              value={currentLocale()}
              aria-label={t("language.label")}
              onchange={(event) => setLocale(event.currentTarget.value)}
            >
              {#each locales as item (item.id)}
                <option value={item.id}>{t(item.labelKey)}</option>
              {/each}
            </select>
          </div>

          <div class="row stack">
            <strong>{t("settings.theme")}</strong>
            <SegmentedControl
              label={t("settings.theme")}
              value={ui.theme}
              onchange={(next) => setTheme(next as Theme)}
              options={themes.map((item) => ({
                value: item.id,
                label: t(item.labelKey),
                icon: item.icon,
              }))}
            />
          </div>
        </section>

        <section id="audio" class="block" data-testid="settings-section-audio">
          <h2>{t("settingsPage.sections.audio")}</h2>
          <p class="hint">{t("settingsPage.audioHint")}</p>

          <div class="stack-field" data-testid="calibration-setting">
            <div class="copy">
              <strong>{t("calibration.title")}</strong>
              <p class="hint">{t("calibration.description")}</p>
              <p class="hint" data-testid="calibration-status">
                {#if hasCalibration}
                  {t("calibration.currentLatency", { offset: calibrationOffset })}
                  {#if calibrationJitter !== null}
                    · {t("calibration.currentJitter", { jitter: calibrationJitter })}
                  {/if}
                {:else}
                  {t("calibration.notCalibrated")}
                {/if}
              </p>
            </div>

            {#if calibrationJitter !== null && isHighJitter(calibrationJitter)}
              <p class="notice" role="alert" data-testid="settings-jitter-warning">
                <Icon name="alert" size={16} />
                {t("calibration.highJitterWarning", { jitter: calibrationJitter })}
              </p>
            {/if}

            <div class="offset">
              <label for="latency-offset">{t("calibration.manualSlider")}</label>
              <div class="offset-control">
                <input
                  id="latency-offset"
                  type="range"
                  min="0"
                  max="500"
                  step="1"
                  aria-label={t("calibration.manualSlider")}
                  data-testid="settings-offset-slider"
                  value={calibrationOffset}
                  oninput={(event) => void onManualOffsetChange(Number(event.currentTarget.value))}
                />
                <output for="latency-offset" data-testid="settings-offset-value">
                  {t("settingsPage.offsetMs", { offset: calibrationOffset })}
                </output>
              </div>
            </div>

            <button
              type="button"
              data-testid="open-calibration"
              onclick={() => openSheet("calibration")}
            >
              <Icon name="sliders" size={16} />{t("calibration.button")}
            </button>
          </div>

          <div class="row">
            <div class="copy">
              <strong>{t("settingsPage.inputDefault")}</strong>
              <p class="hint">{t("settingsPage.inputDefaultHint")}</p>
            </div>
            <select
              data-testid="input-device-default"
              aria-label={t("settingsPage.inputDefault")}
              value={inputDevice}
              onchange={(event) => chooseInput(event.currentTarget.value)}
            >
              <option value="">{t("listen.defaultDevice")}</option>
              {#each inputDevices.filter((device) => device.deviceId && device.deviceId !== "default") as device, index (device.deviceId)}
                <option value={device.deviceId}>
                  {device.label || t("listen.unnamedDevice", { n: index + 1 })}
                </option>
              {/each}
            </select>
          </div>
        </section>

        <section id="pedals" class="block" data-testid="settings-section-pedals">
          <h2>{t("settingsPage.sections.pedals")}</h2>
          <PedalSettings />

          <div class="shortcuts">
            <div class="copy">
              <h3 id="shortcut-heading">{t("settingsPage.shortcutsHeading")}</h3>
              <p class="hint">{t("settingsPage.shortcutsHint")}</p>
            </div>
            <button
              type="button"
              class="ghost"
              aria-expanded={shortcutsOpen}
              aria-controls="shortcut-panel"
              data-testid="shortcuts-toggle"
              onclick={() => (shortcutsOpen = !shortcutsOpen)}
            >
              {shortcutsOpen ? t("settingsPage.hideShortcuts") : t("settingsPage.showShortcuts")}
            </button>
            <div id="shortcut-panel">
              {#if shortcutsOpen}
                <div class="table-scroll">
                  <table aria-labelledby="shortcut-heading">
                    <thead>
                      <tr>
                        <th scope="col">{t("settingsPage.shortcutKey")}</th>
                        <th scope="col">{t("settingsPage.shortcutAction")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each SHORTCUTS as item (item.action)}
                        <tr>
                          <th scope="row"><kbd>{item.label}</kbd></th>
                          <td>{t(item.labelKey)}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              {:else}
                <p class="hint" data-testid="shortcut-summary">{shortcutSummary}</p>
              {/if}
            </div>
          </div>
        </section>

        {#if !ui.demoMode}
          <section id="library" class="block" data-testid="settings-section-library">
            <h2>{t("settingsPage.sections.library")}</h2>
            <section class="setting" data-testid="demo-settings">
              <div class="setting-label">
                <span class="setting-icon"><Icon name="sparkle" /></span>
                <div>
                  <strong>{t("demo.heading")}</strong>
                  <p class="muted">{t("demo.hint")}</p>
                  {#if demoNotice}<p class="muted" role="status">{demoNotice}</p>{/if}
                </div>
              </div>
              {#if demoInstalled > 0}
                <button data-testid="demo-remove" onclick={() => void changeDemo(false)}>
                  {t("demo.remove")}
                </button>
              {:else}
                <button data-testid="demo-add" onclick={() => void changeDemo(true)}>
                  {t("demo.add")}
                </button>
              {/if}
            </section>
            <BackupSettings />
          </section>

          <section id="tokens" class="block" data-testid="settings-section-tokens">
            <h2>{t("settingsPage.sections.tokens")}</h2>
            <ApiTokens />
          </section>

          <section id="assistant" class="block" data-testid="settings-section-assistant">
            <h2>{t("settingsPage.sections.assistant")}</h2>
            <LlmSettings />
          </section>
        {/if}

        {#if singleUserInstance}
          <section id="instance" class="block" data-testid="settings-section-instance">
            <h2>{t("settingsPage.sections.instance")}</h2>
            <p class="hint">{t("settingsPage.instanceHint")}</p>
            <YtDlpStatus />
            <LlmAdmin />
          </section>
        {/if}

        <section id="about" class="block" data-testid="settings-section-about">
          <h2>{t("settingsPage.sections.about")}</h2>
          <div data-testid="about-setting">
            <strong>{t("about.label")}</strong>
            {#if ui.version}
              <p class="hint">
                {t("about.version", { version: ui.version })}{#if ui.commit}
                  · {t("about.commit", { commit: ui.commit.slice(0, 7) })}{/if}
              </p>
            {/if}
          </div>
          <p class="links">
            <a href={DOCS_URL} data-testid="about-docs">{t("settingsPage.docs")}</a>
            <a href={CHANGELOG_URL} data-testid="about-changelog">{t("settingsPage.changelog")}</a>
          </p>
        </section>
      </div>
    </div>
  </div>
</Page>

<style>
  .settings {
    display: grid;
    gap: var(--sp-5);
  }

  .layout {
    display: grid;
    gap: var(--sp-5);
  }

  .nav {
    display: flex;
    gap: var(--sp-2);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .nav::-webkit-scrollbar {
    display: none;
  }

  .nav a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 var(--sp-3);
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-sm);
    font-weight: 600;
    line-height: 1.45;
    text-decoration: none;
    white-space: nowrap;
  }

  .nav a:hover {
    color: var(--text);
    background: var(--surface);
  }

  .nav a[aria-current="location"] {
    background: var(--surface-3);
    color: var(--text);
  }

  .sections {
    display: grid;
    gap: var(--sp-7);
    min-width: 0;
  }

  .block {
    display: grid;
    gap: var(--sp-4);
    padding: var(--sp-4);
    scroll-margin-top: var(--sp-8);
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }

  .block :global(.setting) {
    padding: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }

  h2 {
    margin: 0;
    font-size: var(--fs-h2);
    font-weight: 600;
    line-height: 1.3;
  }

  h3 {
    margin: 0;
    font-size: var(--fs-h3);
    font-weight: 600;
    line-height: 1.4;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    align-items: center;
    gap: var(--sp-3);
  }

  .copy,
  .stack-field,
  .shortcuts,
  .offset {
    display: grid;
    gap: var(--sp-2);
    min-width: 0;
  }

  .hint {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-sm);
    line-height: 1.45;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }

  .offset-control {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--sp-3);
  }

  output {
    min-width: calc(var(--sp-8) + var(--sp-3));
    color: var(--text-2);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    font-variant-numeric: tabular-nums;
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-4);
    margin: 0;
  }

  .links a {
    color: var(--accent-text);
    font-size: var(--fs-body);
    line-height: 1.55;
    text-decoration: underline;
    text-underline-offset: var(--sp-1);
  }

  .table-scroll {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }

  th,
  td {
    padding: var(--sp-2) var(--sp-3);
    border-bottom: 1px solid var(--line);
    text-align: left;
    vertical-align: middle;
  }

  thead th {
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    line-height: 1.4;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    min-height: var(--sp-6);
    padding: 0 var(--sp-2);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-xs);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
  }

  @media (min-width: 768px) {
    .layout {
      grid-template-columns: calc(var(--sp-8) * 2 + var(--sp-6)) minmax(0, 1fr);
      align-items: start;
      gap: var(--sp-6);
    }

    .nav {
      position: sticky;
      top: var(--sp-4);
      flex-direction: column;
      overflow: visible;
    }

    .nav a {
      white-space: normal;
    }

    .sections {
      max-width: var(--page-narrow);
    }

    .block {
      gap: var(--sp-5);
      padding: var(--sp-5);
    }

    .row {
      grid-template-columns: minmax(0, 1fr) minmax(calc(var(--sp-8) * 2), calc(var(--sp-8) * 4));
      gap: var(--sp-4);
    }

    .row.stack {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
