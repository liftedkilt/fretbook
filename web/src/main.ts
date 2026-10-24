import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import { mount } from "svelte";

import App from "./App.svelte";
import "./app.css";
import { startOffline } from "./lib/offline/offline.svelte";

const target = document.getElementById("app");
if (!target) throw new Error("missing #app");
mount(App, { target });
startOffline();
