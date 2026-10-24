<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";

  import Icon from "./Icon.svelte";
  import { deleteStems, dismissJob, getJob, getStems, startStems } from "../lib/api";
  import { keyed, t, tOr } from "../lib/i18n.svelte";
  import {
    loadStemMixes,
    orderStems,
    saveStemMixes,
    stemMix,
    StemPlayer,
    type StemMix,
    type StemMixes,
    type StemName,
  } from "../lib/stems";

  // Splits the recording into parts (a worker runs Demucs) and plays them in step with the player's <audio>,
  // so the bass can be muted or the guitar soloed. Hidden until a worker can make stems or stems exist.
  let {
    songId,
    audioEl,
    master,
    onactive,
  }: {
    songId: string;
    audioEl: HTMLAudioElement | null;
    /** The recording's volume slider, which scales every stem. */
    master: number;
    /** Tells the player whether the stems or the recording itself is what you hear. */
    onactive: (active: boolean) => void;
  } = $props();

  type Phase = "idle" | "working" | "failed";

  let loaded = $state(false);
  let available = $state(false);
  let stems = $state<{ name: StemName; url: string }[]>([]);
  let mixes = $state<StemMixes>(untrack(() => loadStemMixes(songId)));
  let enabled = $state(false);
  let phase = $state<Phase>("idle");
  let progress = $state("");
  let error = $state("");
  let run = 0;
  let player: StemPlayer | null = null;

  async function refresh() {
    try {
      const found = await getStems(songId);
      stems = orderStems(found.stems) as { name: StemName; url: string }[];
      available = found.available;
    } catch {
      // The mixer is an extra: when the list cannot be read it stays out of the way.
      stems = [];
      available = false;
    }
    loaded = true;
  }

  onMount(() => void refresh());

  async function separate() {
    const mine = ++run;
    phase = "working";
    progress = t("stems.queued");
    error = "";
    enabled = false;
    try {
      const { job_id } = await startStems(songId);
      for (let attempt = 0; attempt < 7200; attempt += 1) {
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
          await refresh();
          if (!stems.length) throw new Error(t("stems.noResult"));
          phase = "idle";
          enabled = true;
          return;
        }
        progress = tOr(job.progress_key, job.progress || t("stems.working"));
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error(t("stems.timeout"));
    } catch (err) {
      if (mine !== run) return;
      error = err instanceof Error ? err.message : t("stems.failed");
      phase = "failed";
    }
  }

  async function remove() {
    run += 1;
    enabled = false;
    try {
      await deleteStems(songId);
    } catch {
      // Removing is best effort; the list below shows what is still there.
    }
    await refresh();
    phase = "idle";
  }

  function edit(name: StemName, change: (mix: StemMix) => void) {
    const next = { ...stemMix(mixes, name) };
    change(next);
    mixes = { ...mixes, [name]: next };
    saveStemMixes(songId, mixes);
  }

  // Play the stems while the toggle is on; turning it off gives the recording its sound back.
  $effect(() => {
    const element = audioEl;
    if (!enabled || !element || !stems.length) return;
    const base = document.baseURI;
    const active = new StemPlayer(
      element,
      stems.map((stem) => ({ name: stem.name, url: new URL(stem.url, base).toString() })),
    );
    player = active;
    onactive(true);
    return () => {
      active.dispose();
      if (player === active) player = null;
      onactive(false);
    };
  });

  $effect(() => {
    const snapshot = $state.snapshot(mixes);
    player?.setMix(snapshot, master);
  });

  onDestroy(() => {
    run += 1;
  });

  function label(name: StemName): string {
    switch (name) {
      case "bass":
        return t("stems.names.bass");
      case "drums":
        return t("stems.names.drums");
      case "guitar":
        return t("stems.names.guitar");
      case "piano":
        return t("stems.names.piano");
      case "vocals":
        return t("stems.names.vocals");
      default:
        return t("stems.names.other");
    }
  }
</script>

{#if loaded && (available || stems.length > 0 || phase !== "idle")}
  <div class="panel-group" data-testid="stem-mixer">
    <h3>{t("stems.title")}</h3>
    {#if phase === "working"}
      <p class="muted small" role="status" data-testid="stems-progress">{progress}</p>
    {:else}
      {#if stems.length === 0}
        <p class="muted small">{t("stems.hint")}</p>
      {/if}
      <div class="mix-row">
        {#if stems.length > 0}
          <label class="check">
            <input type="checkbox" data-testid="stems-use" bind:checked={enabled} />
            {t("stems.use")}
          </label>
        {/if}
        {#if available}
          <button data-testid="stems-separate" title={t("stems.separateHint")} onclick={separate}
            ><Icon name="waveform" size={18} />{stems.length
              ? t("stems.rerun")
              : t("stems.separate")}</button
          >
        {/if}
        {#if stems.length > 0}
          <button data-testid="stems-remove" onclick={remove}>{t("stems.remove")}</button>
        {/if}
      </div>
      {#if phase === "failed"}
        <p class="alert" role="alert"><Icon name="alert" size={18} />{error}</p>
      {/if}
      {#if enabled}
        <p class="muted small">{t("stems.usingHint")}</p>
        {#each stems as stem (stem.name)}
          {@const mix = stemMix(mixes, stem.name)}
          {@const name = label(stem.name)}
          <div class="mix-row" data-testid={`stem-${stem.name}`}>
            <span class="mix-name">{name}</span>
            <button
              class="button"
              aria-pressed={mix.mute}
              aria-label={t("stems.muteStem", { name })}
              data-testid={`stem-mute-${stem.name}`}
              onclick={() => edit(stem.name, (target) => (target.mute = !target.mute))}
              >{t("stems.mute")}</button
            >
            <button
              class="button"
              aria-pressed={mix.solo}
              aria-label={t("stems.soloStem", { name })}
              data-testid={`stem-solo-${stem.name}`}
              onclick={() => edit(stem.name, (target) => (target.solo = !target.solo))}
              >{t("stems.solo")}</button
            >
            <input
              class="mix-track-volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={mix.volume}
              aria-label={t("stems.stemVolume", { name })}
              data-testid={`stem-volume-${stem.name}`}
              oninput={(event) => {
                const value = Number(event.currentTarget.value);
                edit(stem.name, (target) => (target.volume = value));
              }}
            />
          </div>
        {/each}
      {/if}
    {/if}
  </div>
{/if}
