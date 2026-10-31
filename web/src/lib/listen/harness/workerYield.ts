import { setImmediate } from "node:timers/promises";

import { afterEach } from "vitest";

// Vitest 3.2's worker RPC times out a call to `onTaskUpdate` after 60s, and that
// limit is not configurable. These tests are synchronous DSP: once a call is in
// flight, the worker does not read the host's acknowledgement until it returns
// to the event loop. Yield between cases so a pending ack lands before the next
// block. The listen-harness project also runs this file on its own, after the
// other projects, so the host is not busy with the rest of the suite while the
// file is on the CPU. See the listen-harness project in `vite.config.ts`.
afterEach(async () => {
  await setImmediate();
});
