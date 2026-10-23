<script lang="ts" module>
  // 24×24 stroke icons, drawn in the style of Lucide. Inline so the app needs nothing from a CDN.
  const PATHS: Record<string, string> = {
    library: "M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5v-2ZM4 19.5A2.5 2.5 0 0 1 6.5 17H19M9 7h6",
    plus: "M12 5v14M5 12h14",
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-3.5-3.5",
    settings:
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
    play: "M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z",
    pause: "M7 4h3.5v16H7zM13.5 4H17v16h-3.5z",
    prev: "M18 6 10 12l8 6V6ZM6 6v12",
    next: "M6 6l8 6-8 6V6ZM18 6v12",
    back: "M15 18l-6-6 6-6",
    forward: "M9 18l6-6-6-6",
    chevronDown: "M6 9l6 6 6-6",
    close: "M18 6 6 18M6 6l12 12",
    edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
    trash: "M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6",
    download: "M12 3v12M7 10l5 5 5-5M5 21h14",
    upload: "M12 21V9M7 14l5-5 5 5M5 3h14",
    link: "M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
    file: "M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6ZM14 3v6h6M8 13h8M8 17h5",
    tab: "M3 6h18M3 10h18M3 14h18M3 18h18M8 4v4M15 8v4M11 12v4M17 16v4",
    chords: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    guitar:
      "M19.5 2.5l2 2M20.5 3.5 13 11M11.5 9.5a4.5 4.5 0 0 0-4.6 1.1 3 3 0 0 0-.6 1.1c-.3 1-1.2 1.6-2.2 1.8a2.5 2.5 0 0 0-1.4.7c-1.5 1.5-.9 4.5 1.3 6.7s5.2 2.8 6.7 1.3a2.5 2.5 0 0 0 .7-1.4c.2-1 .8-1.9 1.8-2.2a3 3 0 0 0 1.1-.6 4.5 4.5 0 0 0 1.1-4.6M8 16l.01 0",
    bass: "M14 3h7v7M21 3l-9 9M10.5 11.5a4 4 0 0 0-5.3.4c-1.6 1.6-.9 3.3-2.2 4.6l4.5 4.5c1.3-1.3 3-.6 4.6-2.2a4 4 0 0 0 .4-5.3",
    acoustic: "M12 3v6M9 3h6M12 9a5 5 0 0 0-5 5 4 4 0 0 0 1 2.6A5 5 0 1 0 16 16.6 4 4 0 0 0 17 14a5 5 0 0 0-5-5ZM12 16.5h.01",
    waveform: "M3 12h2M7 8v8M11 4v16M15 7v10M19 10v4M21 12h0",
    repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
    gauge: "M12 14l4-4M3.5 18a10 10 0 1 1 17 0",
    follow: "M12 5v14M5 12l7 7 7-7",
    sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    tap: "M9 11V5a2 2 0 1 1 4 0v6M13 10.5V9a2 2 0 1 1 4 0v3.5M17 11a2 2 0 1 1 4 0v3a7 7 0 0 1-7 7h-2a7 7 0 0 1-5.6-2.8L3.3 14.6a2 2 0 0 1 3-2.6L9 14.5",
    users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
    logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
    globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18",
    sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
    moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
    monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16v-5M12 8h.01",
    check: "M20 6 9 17l-5-5",
    more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
    minus: "M5 12h14",
    text: "M4 7V4h16v3M9 20h6M12 4v16",
    sparkle: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z",
    save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM17 21v-8H7v8M7 3v5h8",
    alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
    eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    layers: "M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5",
    print: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  };

  const FILLED = new Set(["play", "pause", "prev", "next"]);
</script>

<script lang="ts">
  let { name, size = 20, class: className = "" }: { name: string; size?: number; class?: string } = $props();
</script>

<svg
  class="icon {className}"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={FILLED.has(name) ? "currentColor" : "none"}
  stroke="currentColor"
  stroke-width={FILLED.has(name) ? 0 : 1.8}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={PATHS[name] ?? ""} />
</svg>
