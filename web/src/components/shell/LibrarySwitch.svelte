<script lang="ts">
  import SegmentedControl from "../ui/SegmentedControl.svelte";
  import { t } from "../../lib/i18n.svelte";
  import { navigate } from "../../lib/router.svelte";

  // Phones have no Setlists tab, so Library and Setlists share this switch.
  let { active }: { active: "songs" | "setlists" } = $props();
</script>

<div class="library-switch">
  <SegmentedControl
    label={t("nav.librarySwitch")}
    value={active}
    testid="library-switch"
    options={[
      { value: "songs", label: t("nav.songs"), testid: "library-switch-songs" },
      { value: "setlists", label: t("setlists.nav"), testid: "library-switch-setlists" },
    ]}
    onchange={(value) => navigate(value === "songs" ? "/" : "/setlists")}
  />
</div>

<style>
  .library-switch {
    display: none;
    margin-bottom: var(--sp-4);
  }

  @media (max-width: 767px) {
    .library-switch {
      display: block;
    }
  }
</style>
