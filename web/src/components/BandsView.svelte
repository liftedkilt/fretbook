<script lang="ts">
  import Page from "./ui/Page.svelte";
  import PageHeader from "./ui/PageHeader.svelte";
  import {
    addMember,
    createBand,
    deleteBand,
    listLibraries,
    listMembers,
    removeMember,
    renameBand,
    setMemberRole,
  } from "../lib/api";
  import { t } from "../lib/i18n.svelte";
  import type { LibraryInfo, LibraryMember } from "../lib/types";
  import { refreshSongs, setActiveLibrary, ui } from "../lib/ui.svelte";

  let libraries = $state<LibraryInfo[]>([]);
  let members = $state<LibraryMember[]>([]);
  let openId = $state("");
  let name = $state("");
  let email = $state("");
  let role = $state<"view" | "edit">("view");
  let rename = $state("");
  let error = $state("");
  let notice = $state("");
  let busy = $state(false);

  const bands = $derived(libraries.filter((item) => item.kind === "band"));
  const open = $derived(bands.find((item) => item.id === openId) ?? null);

  async function load() {
    libraries = await listLibraries();
    if (openId && !bands.some((item) => item.id === openId)) openId = "";
    members = openId ? await listMembers(openId) : [];
  }

  $effect(() => {
    let cancel = false;
    listLibraries()
      .then(async (rows) => {
        if (cancel) return;
        libraries = rows;
      })
      .catch((err: unknown) => {
        if (!cancel) error = err instanceof Error ? err.message : t("error.generic");
      });
    return () => {
      cancel = true;
    };
  });

  async function run(action: () => Promise<void>) {
    busy = true;
    error = "";
    notice = "";
    try {
      await action();
      await load();
    } catch (err) {
      error = err instanceof Error ? err.message : t("error.generic");
    } finally {
      busy = false;
    }
  }

  function select(id: string) {
    openId = id;
    const band = bands.find((item) => item.id === id);
    rename = band?.name ?? "";
    void run(async () => {
      members = await listMembers(id);
    });
  }
</script>

<Page width="page">
  <section class="bands">
    <PageHeader title={t("bands.heading")} eyebrow={t("bands.nav")} subtitle={t("bands.intro")} />

    {#if error}<p class="alert" role="alert">{error}</p>{/if}
    {#if notice}<p class="muted" role="status">{notice}</p>{/if}

    <form
      class="band-create"
      onsubmit={(event) => {
        event.preventDefault();
        const next = name.trim();
        if (!next) return;
        void run(async () => {
          const created = await createBand(next);
          name = "";
          openId = created.id;
          rename = created.name;
          notice = t("bands.created");
          setActiveLibrary(created.id);
          await refreshSongs();
        });
      }}
    >
      <label>
        {t("bands.name")}
        <input data-testid="band-name" bind:value={name} maxlength="80" required />
      </label>
      <button
        class="primary"
        data-testid="band-create"
        type="submit"
        disabled={busy || !name.trim()}
      >
        {t("bands.create")}
      </button>
    </form>

    {#if bands.length === 0}
      <p class="muted" data-testid="bands-empty">{t("bands.empty")}</p>
    {:else}
      <ul class="band-list">
        {#each bands as band (band.id)}
          <li>
            <button
              type="button"
              aria-current={openId === band.id ? "true" : undefined}
              onclick={() => select(band.id)}
            >
              <strong>{band.name}</strong>
              <span
                >{t("bands.songs", { count: band.song_count })} · {band.role === "edit"
                  ? t("bands.edit")
                  : t("bands.view")}</span
              >
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if open && open.role === "edit"}
      <section class="band-manage" data-testid="band-members">
        <h2>{open.name}</h2>
        <form
          class="band-rename"
          onsubmit={(event) => {
            event.preventDefault();
            if (!rename.trim()) return;
            void run(async () => {
              await renameBand(open.id, rename.trim());
            });
          }}
        >
          <label>
            {t("bands.rename")}
            <input bind:value={rename} maxlength="80" />
          </label>
          <button type="submit" disabled={busy}>{t("bands.rename")}</button>
        </form>
        <h3>{t("bands.members")}</h3>
        <ul>
          {#each members as member (member.user_id)}
            <li>
              <span>{member.display_name}</span>
              <select
                aria-label={t("bands.role")}
                value={member.role}
                onchange={(event) => {
                  const next = (event.currentTarget as HTMLSelectElement).value as "view" | "edit";
                  void run(async () => {
                    await setMemberRole(open.id, member.user_id, next);
                  });
                }}
              >
                <option value="view">{t("bands.view")}</option>
                <option value="edit">{t("bands.edit")}</option>
              </select>
              <button
                type="button"
                disabled={busy}
                onclick={() =>
                  void run(async () => {
                    await removeMember(open.id, member.user_id);
                  })}
              >
                {t("bands.remove")}
              </button>
            </li>
          {/each}
        </ul>
        <form
          class="band-add"
          onsubmit={(event) => {
            event.preventDefault();
            const next = email.trim();
            if (!next) return;
            void run(async () => {
              await addMember(open.id, next, role);
              email = "";
            });
          }}
        >
          <label>
            {t("bands.email")}
            <input type="email" data-testid="band-email" bind:value={email} />
          </label>
          <label>
            {t("bands.role")}
            <select bind:value={role}>
              <option value="view">{t("bands.view")}</option>
              <option value="edit">{t("bands.edit")}</option>
            </select>
          </label>
          <button type="submit" disabled={busy || !email.trim()}>{t("bands.add")}</button>
        </form>
        <button
          class="danger-text"
          type="button"
          disabled={busy}
          onclick={() => {
            if (!confirm(t("bands.deleteConfirm"))) return;
            void run(async () => {
              await deleteBand(open.id);
              if (ui.libraryId === open.id) {
                setActiveLibrary("");
                await refreshSongs();
              }
              openId = "";
            });
          }}
        >
          {t("bands.delete")}
        </button>
      </section>
    {/if}
  </section>
</Page>

<style>
  .bands {
    display: grid;
    gap: 1rem;
  }

  .band-create,
  .band-rename,
  .band-add,
  .band-manage {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: end;
  }

  .band-manage {
    align-items: stretch;
    flex-direction: column;
  }

  .band-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.5rem;
  }

  .band-list button {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
    text-align: left;
  }

  label {
    display: grid;
    gap: 0.25rem;
  }
</style>
