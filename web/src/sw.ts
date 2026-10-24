import { createWorker } from "./lib/offline/swCore";

// Replaced when `vite build` bundles this file (see `fretbookServiceWorker` in vite.config.ts).
declare const __PRECACHE__: string[];
declare const __VERSION__: string;

// The project compiles against the DOM library, which clashes with the WebWorker one, so describe the little used here.
interface WorkerEvent extends Event {
  waitUntil(work: Promise<unknown>): void;
}
interface FetchWorkerEvent extends WorkerEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}
interface WorkerScope {
  registration: { scope: string };
  clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: WorkerEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchWorkerEvent) => void): void;
}
const scope = self as unknown as WorkerScope;

const worker = createWorker({
  fetch: (request) => fetch(request),
  caches,
  scope: new URL(scope.registration.scope),
  version: __VERSION__,
  precache: __PRECACHE__,
});

scope.addEventListener("install", (event) => {
  // A new build takes over at once: everything it serves is precached by now.
  event.waitUntil(worker.install().then(() => scope.skipWaiting()));
});

scope.addEventListener("activate", (event) => {
  event.waitUntil(worker.activate().then(() => scope.clients.claim()));
});

scope.addEventListener("fetch", (event) => {
  const response = worker.handle(event.request);
  if (response) event.respondWith(response.then((answer) => answer ?? fetch(event.request)));
});
