<script lang="ts">
  import { onMount } from "svelte";
  import type { Writable } from "svelte/store";
  import { t } from "../lib/i18n.svelte";
  import IconButton from "./ui/IconButton.svelte";

  let {
    muteState,
    onchange,
  }: {
    muteState: Writable<boolean>;
    onchange: (muted: boolean) => void;
  } = $props();

  let muted = $state(false);
  onMount(() => muteState.subscribe((value) => (muted = value)));
</script>

<IconButton
  class="ghost"
  icon={muted ? "volumeX" : "volume2"}
  label={t(muted ? "player.unmutePlayback" : "player.mutePlayback")}
  testid="player-mute"
  pressed={muted}
  placement="above"
  onclick={() => onchange(!muted)}
/>
