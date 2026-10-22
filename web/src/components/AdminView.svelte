<script lang="ts">
  import { ApiError, adoptLocal, listUsers, signOutUser } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import type { AdminUser } from "../lib/types";

  let { self }: { self: string } = $props();

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

  async function adopt() {
    error = "";
    try {
      const { moved } = await adoptLocal();
      notice = t("admin.adopted", { count: moved });
      await refresh();
    } catch (err) {
      error = message(err);
    }
  }
</script>

<div class="stack">
  <section class="panel">
    <h2 class="section-title" style="margin-top:0">{t("admin.heading")}</h2>
    <p class="hint">{t("admin.hint")}</p>
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
              <td>{user.email}</td>
              <td><span class="badge">{user.role === "admin" ? t("admin.roleAdmin") : t("admin.roleUser")}</span></td>
              <td>{user.song_count}</td>
              <td>
                {when(user.last_login_at)}
                <div class="hint">{t("admin.sessions", { count: user.session_count })}</div>
              </td>
              <td>
                {#if user.session_count > 0 && user.id !== self}
                  <button onclick={() => void endSessions(user)}>{t("admin.signOut")}</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  {#if localSongs > 0}
    <section class="panel">
      <h2 class="section-title" style="margin-top:0">{t("admin.adoptHeading")}</h2>
      <p class="hint">{t("admin.adoptHint", { count: localSongs })}</p>
      <button class="primary" onclick={() => void adopt()}>{t("admin.adopt")}</button>
    </section>
  {/if}

  {#if error}<p class="error">{error}</p>{/if}
  {#if notice}<p class="hint">{notice}</p>{/if}
</div>
