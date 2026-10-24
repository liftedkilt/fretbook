<script lang="ts">
  import Icon from "./Icon.svelte";
  import { ApiError, attachYouTubeAudio, dismissJob, waitForJob } from "../lib/api";
  import { keyed, t, tOr } from "../lib/i18n.svelte";

  let { songId, ondone }: { songId: string; ondone: () => void | Promise<void> } = $props();

  let url = $state("");
  let busy = $state(false);
  let progress = $state("");
  let error = $state("");

  async function submit(event: Event) {
    event.preventDefault();
    const link = url.trim();
    if (!link || busy) return;
    busy = true;
    error = "";
    progress = t("youtubeAudio.working");
    try {
      const { job_id } = await attachYouTubeAudio(songId, link);
      const job = await waitForJob(job_id, (running) => {
        progress = tOr(running.progress_key, running.progress || t("youtubeAudio.working"));
      });
      // Read once and let it go: it is not an import, and a failed one would sit in the import list.
      void dismissJob(job_id).catch(() => undefined);
      if (job.status === "error") {
        error = keyed({ key: job.error_key, message: job.error ?? "", params: job.error_params });
        return;
      }
      url = "";
      await ondone();
    } catch (err) {
      error =
        err instanceof ApiError
          ? keyed({ key: err.key, message: err.message, params: err.params })
          : t("youtubeAudio.timeout");
    } finally {
      busy = false;
      progress = "";
    }
  }
</script>

<form class="youtube-audio" onsubmit={submit} data-testid="youtube-audio">
  <label class="field compact-field">
    <span>{t("youtubeAudio.label")}</span>
    <input
      type="url"
      bind:value={url}
      placeholder={t("youtubeAudio.placeholder")}
      disabled={busy}
      data-testid="youtube-audio-url"
    />
  </label>
  <button
    class="button"
    type="submit"
    disabled={busy || !url.trim()}
    data-testid="youtube-audio-go"
  >
    <Icon name="upload" size={18} />{t("youtubeAudio.submit")}
  </button>
  {#if busy}<span role="status" class="muted">{progress}</span>{/if}
  {#if error}<p class="alert" role="alert" data-testid="youtube-audio-error">
      <Icon name="alert" size={18} />{error}
    </p>{/if}
</form>
