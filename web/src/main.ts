import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import { mount } from "svelte";

import App from "./App.svelte";
import "./app.css";
import { startOffline } from "./lib/offline/offline.svelte";
import { rangeFillPercent } from "./lib/rangeFill";

const target = document.getElementById("app");
if (!target) throw new Error("missing #app");
mount(App, { target });
startOffline();
startRangeFills();

function paintRange(el: HTMLInputElement): void {
  el.style.setProperty("--range-fill", `${rangeFillPercent(el.min, el.max, el.value)}%`);
}

function paintRanges(root: ParentNode): void {
  for (const node of root.querySelectorAll("input[type=range]")) {
    if (node instanceof HTMLInputElement) paintRange(node);
  }
}

/** Keeps the themed range track filled as sliders are dragged or updated by steppers. */
function startRangeFills(): void {
  const paint = () => paintRanges(document);
  document.addEventListener("input", (event) => {
    const touched = event.target;
    if (touched instanceof HTMLInputElement && touched.type === "range") paintRange(touched);
  });
  // Steppers and tap tempo change the value without an input event on the range.
  document.addEventListener("click", paint);
  if (document.body) {
    const observer = new MutationObserver(paint);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["value", "min", "max"],
    });
  }
  paint();
  window.setInterval(paint, 250);
}
