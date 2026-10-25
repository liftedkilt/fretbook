<script lang="ts">
  import Icon from "./Icon.svelte";
  import Sheet from "./Sheet.svelte";
  import { dismissJob, getJob, startTranscribe } from "../lib/api";
  import { keyed, t, tOr } from "../lib/i18n.svelte";
  import { ui } from "../lib/ui.svelte";

  let {
    open,
    songId,
    onclose,
    onsuccess,
  }: {
    open: boolean;
    songId: string;
    onclose: () => void;
    onsuccess: (trackId?: string) => void;
  } = $props();

  let stem = $state<"mix" | "bass" | "guitar">("mix");
  let preset = $state<string>(ui.defaultInstrument || "guitar-6");
  let grid = $state<4 | 8 | 16 | 32>(16);

  let phase = $state<"idle" | "working" | "done" | "failed">("idle");
  let progress = $state("");
  let error = $state("");
  let run = 0;

  const stemOptions: { value: "mix" | "bass" | "guitar"; label: string }[] = $derived([
    { value: "mix", label: t("transcribe.stemMix") },
    { value: "guitar", label: t("transcribe.stemGuitar") },
    { value: "bass", label: t("transcribe.stemBass") },
  ]);

  const gridOptions: { value: 4 | 8 | 16 | 32; label: string }[] = $derived([
    { value: 4, label: t("asciiTab.grid4") },
    { value: 8, label: t("asciiTab.grid8") },
    { value: 16, label: t("asciiTab.grid16") },
    { value: 32, label: t("asciiTab.grid32") },
  ]);

  async function submit() {
    const mine = ++run;
    phase = "working";
    progress = t("transcribe.queued");
    error = "";
    try {
      const { job_id } = await startTranscribe(songId, {
        stem,
        preset: preset || undefined,
        grid,
      });
      for (let attempt = 0; attempt < 1200; attempt += 1) {
        const job = await getJob(job_id);
        if (job.status === "done" || job.status === "error") {
          void dismissJob(job_id).catch(() => undefined);
        }
        if (mine !== run) return;
        if (job.status === "error") {
          throw new Error(
            keyed({ key: job.error_key, message: job.error ?? "", params: job.error_params }),
          );
        }
        if (job.status === "done") {
          phase = "done";
          onsuccess(job.result?.track_id);
          onclose();
          return;
        }
        progress = tOr(job.progress_key, job.progress || t("transcribe.transcribing"));
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
      throw new Error(t("transcribe.timeout"));
    } catch (err) {
      if (mine !== run) return;
      phase = "failed";
      error = err instanceof Error ? err.message : t("error.generic");
    }
  }

  function handleClose() {
    run += 1;
    phase = "idle";
    error = "";
    onclose();
  }
</script>

<Sheet
  {open}
  title={t("transcribe.title")}
  subtitle={t("transcribe.hint")}
  testid="transcribe-sheet"
  onclose={handleClose}
>
  <div class="transcribe-sheet">
    {#if phase === "working"}
      <div class="status-box working" role="status">
        <Icon name="refresh" size={20} class="spin" />
        <span>{progress}</span>
      </div>
    {:else}
      {#if error}
        <div class="status-box error" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      {/if}

      <div class="form-group">
        <label for="transcribe-stem">{t("transcribe.stem")}</label>
        <select id="transcribe-stem" bind:value={stem}>
          {#each stemOptions as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>

      <div class="form-group">
        <label for="transcribe-preset">{t("transcribe.preset")}</label>
        <select id="transcribe-preset" bind:value={preset}>
          {#each ui.presets as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      </div>

      <div class="form-group">
        <label for="transcribe-grid">{t("transcribe.grid")}</label>
        <select id="transcribe-grid" bind:value={grid}>
          {#each gridOptions as opt (opt.value)}
            <option value={opt.value}>{opt.label}</option>
          {/each}
        </select>
      </div>

      <div class="button-row">
        <button class="accent" data-testid="transcribe-submit" onclick={submit}>
          <Icon name="sparkle" size={16} />
          {t("transcribe.start")}
        </button>
        <button class="ghost" onclick={handleClose}>{t("transcribe.cancel")}</button>
      </div>
    {/if}
  </div>
</Sheet>

<style>
  .transcribe-sheet {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .form-group label {
    font-size: 0.85rem;
    font-weight: 500;
  }
  .form-group select {
    padding: 0.5rem 0.75rem;
    border-radius: var(--r-sm);
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--text);
  }
  .status-box {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border-radius: var(--r-sm);
    font-size: 0.9rem;
  }
  .status-box.working {
    background: var(--surface-3);
    color: var(--text);
  }
  .status-box.error {
    background: var(--danger-soft);
    color: var(--danger);
  }
  .button-row {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }
  :global(.spin) {
    animation: spin 1s linear infinite;
  }
  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
