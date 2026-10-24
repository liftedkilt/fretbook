// Lucide-style icon paths for the mockups (24px grid, 1.8 stroke). Names follow the design-language icon registry.
const P = {
  library: "M4 19.5V5a2 2 0 0 1 2-2h13v16H6.5A2.5 2.5 0 0 0 4 21.5v-2ZM4 19.5A2.5 2.5 0 0 1 6.5 17H19M9 7h6",
  target: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  graduation: "M22 10 12 5 2 10l10 5 10-5ZM6 12v5c3 2 9 2 12 0v-5M22 10v6",
  listMusic: "M21 15V6M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM12 12H3M16 6H3M12 18H3",
  wrench: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z",
  plus: "M12 5v14M5 12h14",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM20 20l-3.5-3.5",
  filter: "M3 5h18M6 12h12M10 19h4",
  sort: "M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4",
  chevronDown: "M6 9l6 6 6-6", chevronRight: "M9 18l6-6-6-6", back: "M15 18l-6-6 6-6",
  close: "M18 6 6 18M6 6l12 12",
  more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2ZM5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  alert: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  star: "M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3L7 14.2 2 9.3l6.9-1L12 2Z",
  play: "M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5Z",
  prev: "M18 6 10 12l8 6V6ZM6 6v12", next: "M6 6l8 6-8 6V6ZM18 6v12",
  bass: "M14 3h7v7M21 3l-9 9M10.5 11.5a4 4 0 0 0-5.3.4c-1.6 1.6-.9 3.3-2.2 4.6l4.5 4.5c1.3-1.3 3-.6 4.6-2.2a4 4 0 0 0 .4-5.3",
  guitar: "M19.5 2.5l2 2M20.5 3.5 13 11M11.5 9.5a4.5 4.5 0 0 0-4.6 1.1 3 3 0 0 0-.6 1.1c-.3 1-1.2 1.6-2.2 1.8a2.5 2.5 0 0 0-1.4.7c-1.5 1.5-.9 4.5 1.3 6.7s5.2 2.8 6.7 1.3a2.5 2.5 0 0 0 .7-1.4c.2-1 .8-1.9 1.8-2.2a3 3 0 0 0 1.1-.6 4.5 4.5 0 0 0 1.1-4.6",
  chords: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  tuningFork: "M9 2v8a3 3 0 0 0 6 0V2M12 13v9M9 22h6",
  metronome: "M9 3h6l4 18H5L9 3ZM12 15l5-9M7 15h10",
  drum: "M12 8c5 0 9-1.3 9-3s-4-3-9-3-9 1.3-9 3 4 3 9 3ZM3 5v12c0 1.7 4 3 9 3s9-1.3 9-3V5M3 11c0 1.7 4 3 9 3s9-1.3 9-3",
  ear: "M6 8.5a6 6 0 1 1 12 0c0 3-2 4-3 5.5S14 17 13 19a3 3 0 0 1-5.5-1M10 8.5a2 2 0 1 1 4 0",
  dumbbell: "M6 7v10M3 9v6M18 7v10M21 9v6M6 12h12",
  download: "M12 3v12M7 10l5 5 5-5M5 21h14",
  cloudDownload: "M7 18a5 5 0 1 1 .9-9.9A6 6 0 0 1 19 10a4 4 0 0 1-1 7.9M12 12v9M9 18l3 3 3-3",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z",
  maximize: "M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3",
  crosshair: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM22 12h-4M6 12H2M12 6V2M12 22v-4",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  gauge: "M12 14l4-4M3.5 18a10 10 0 1 1 17 0",
  hourglass: "M6 2h12M6 22h12M7 2c0 5 10 5 10 10S7 17 7 22M17 2c0 5-10 5-10 10s10 5 10 10",
  repeat: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  waveform: "M3 12h2M7 8v8M11 4v16M15 7v10M19 10v4M21 12h0",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  flame: "M12 22c4 0 7-2.7 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4.3 3 7 7 7Z",
  clock: "M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
  check: "M20 6 9 17l-5-5",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  tag: "M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8ZM7 7h.01",
  tap: "M9 11V5a2 2 0 1 1 4 0v6M13 10.5V9a2 2 0 1 1 4 0v3.5M17 11a2 2 0 1 1 4 0v3a7 7 0 0 1-7 7h-2a7 7 0 0 1-5.6-2.8L3.3 14.6a2 2 0 0 1 3-2.6L9 14.5",
  mic: "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3ZM19 11a7 7 0 0 1-14 0M12 18v3M8 21h8",
  trophy: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 16v-5M12 8h.01",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
};
const FILL = new Set(["play", "prev", "next"]);
// The app shell sidebar, shared by every desktop mockup: <aside class="side" data-on="library"></aside>
for (const side of document.querySelectorAll("aside[data-on]")) {
  const on = side.dataset.on;
  const nav = [["practice", "target", "Practice"], ["library", "library", "Library", "48"], ["lessons", "graduation", "Lessons"], ["setlists", "listMusic", "Setlists", "3"], ["tools", "wrench", "Tools"]];
  const favs = [["g1", "Walking Home"], ["g2", "Open String Riff"], ["g5", "Porch Light"]];
  side.innerHTML = `
    <div class="brand"><div class="brand-mark">F</div><span class="wordmark">Fret<em>book</em></span></div>
    <span class="btn primary" style="justify-content:center;margin:2px 0 14px"><i data-i="plus"></i>New</span>
    ${nav.map(([id, ic, label, n]) => `<a class="nav ${id === on ? "on" : ""}"><i data-i="${ic}"></i>${label}${n ? `<span class="count">${n}</span>` : ""}</a>`).join("")}
    <p class="side-label">Favourites</p>
    ${favs.map(([g, t]) => `<div class="fav"><span class="cv ${g}"></span>${t}</div>`).join("")}
    <div class="side-bottom"><a class="nav ${on === "settings" ? "on" : ""}"><i data-i="settings"></i>Settings</a></div>`;
}
for (const el of document.querySelectorAll("i[data-i]")) {
  const n = el.dataset.i;
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", `i ${el.className} ${FILL.has(n) ? "fill" : ""}`);
  if (el.dataset.f) s.setAttribute("class", s.getAttribute("class") + " fill");
  s.innerHTML = `<path d="${P[n] ?? ""}"/>`;
  el.replaceWith(s);
}
