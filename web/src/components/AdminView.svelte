<script lang="ts">
  import AdminJobs from "./AdminJobs.svelte";
  import AdminStorage from "./AdminStorage.svelte";
  import AdminSystem from "./AdminSystem.svelte";
  import Icon from "./Icon.svelte";
  import { ApiError, adoptLocal, listUsers, revokeUserTokens, signOutUser } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import { refreshSongs } from "../lib/ui.svelte";
  import type { AdminUser } from "../lib/types";

  let { self }: { self: string } = $props();

  let tab = $state("users");
  const tabLabels = $derived<Record<string, string>>({
    users: t("adminDashboard.tabs.users"),
    storage: t("adminDashboard.tabs.storage"),
    jobs: t("adminDashboard.tabs.jobs"),
    system: t("adminDashboard.tabs.system"),
  });
  let users = $state<AdminUser[]>([]);
  let error = $state("");
  let notice = $state("");

  const people = $derived(users.filter((user) => !user.local));
  const localSongs = $derived(users.find((user) => user.local)?.song_count ?? 0);

  function message(err: unknown): string {
    if (err instanceof ApiError || err instanceof Error) return err.message;
    return t("error.generic");
  }

  async function refresh() {
    try {
      users = await listUsers();
    } catch (err) {
      error = message(err);
    }
  }

  $effect(() => {
    void refresh();
  });

  function when(value: string | null): string {
    return value ? new Date(value).toLocaleString() : t("admin.never");
  }

  async function endSessions(user: AdminUser) {
    if (!confirm(t("admin.confirmSignOut", { name: user.display_name }))) return;
    error = "";
    try {
      const { ended } = await signOutUser(user.id);
      notice = t("admin.signedOut", { count: ended });
      await refresh();
    } catch (err) {
      error = message(err);
    }
  }

  async function revokeTokens(user: AdminUser) {
    if (!confirm(t("admin.confirmRevokeTokens", { name: user.display_name }))) return;
    error = "";
    try {
      const { revoked } = await revokeUserTokens(user.id);
      notice = t("admin.tokensRevoked", { count: revoked });
      await refresh();
    } catch (err) {
      error = message(err);
    }
  }

  async function adopt() {
    error = "";
    try {
      const { moved } = await adoptLocal();
      notice = t("admin.adopted", { count: moved });
      await Promise.all([refresh(), refreshSongs()]);
    } catch (err) {
      error = message(err);
    }
  }
</script>

<div class="admin-page">
  <header>
    <h1 class="display">{t("adminDashboard.heading")}</h1>
    {#if tab === "users"}<p class="muted">{t("admin.hint")}</p>{/if}
  </header>

  <div class="segmented" role="tablist" aria-label={t("adminDashboard.tabs.label")}>
    {#each ["users", "storage", "jobs", "system"] as name (name)}
      <button
        role="tab"
        aria-selected={tab === name}
        data-testid={`admin-tab-${name}`}
        onclick={() => (tab = name)}
      >
        {tabLabels[name]}
      </button>
    {/each}
  </div>

  {#if error}<p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>{/if}
  {#if notice}<p class="muted" role="status">{notice}</p>{/if}

  {#if tab === "storage"}
    <AdminStorage />
  {:else if tab === "jobs"}
    <AdminJobs />
  {:else if tab === "system"}
    <AdminSystem />
  {:else}
    <section class="card">
      <div class="table-scroll">
        <table class="user-table">
          <thead>
            <tr>
              <th>{t("admin.name")}</th>
              <th>{t("admin.email")}</th>
              <th>{t("admin.role")}</th>
              <th>{t("admin.songs")}</th>
              <th>{t("admin.lastLogin")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each people as user (user.id)}
              <tr>
                <td>{user.display_name}</td>
                <td class="muted">{user.email}</td>
                <td>
                  <span class="pill" class:pill-accent={user.role === "admin"}>
                    {user.role === "admin" ? t("admin.roleAdmin") : t("admin.roleUser")}
                  </span>
                </td>
                <td>{user.song_count}</td>
                <td>
                  {when(user.last_login_at)}
                  <div class="muted">{t("admin.sessions", { count: user.session_count })}</div>
                  <div class="muted">{t("admin.tokens", { count: user.token_count })}</div>
                </td>
                <td>
                  {#if user.session_count > 0 && user.id !== self}
                    <button class="ghost" onclick={() => void endSessions(user)}>
                      <Icon name="logout" size={16} />{t("admin.signOut")}
                    </button>
                  {/if}
                  {#if user.token_count > 0}
                    <button class="ghost" onclick={() => void revokeTokens(user)}>
                      <Icon name="trash" size={16} />{t("admin.revokeTokens")}
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    {#if localSongs > 0}
      <section class="card">
        <h2 class="card-title">{t("admin.adoptHeading")}</h2>
        <p class="muted">{t("admin.adoptHint", { count: localSongs })}</p>
        <div class="button-row">
          <button class="primary" onclick={() => void adopt()}>{t("admin.adopt")}</button>
        </div>
      </section>
    {/if}
  {/if}
</div>
