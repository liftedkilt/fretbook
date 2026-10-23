import { beforeEach, describe, expect, it } from "vitest";
import {
  addClientJob,
  dismissAllClientJobs,
  dismissClientJob,
  getClientJobs,
  importQueue,
  updateClientJob,
  type ClientJob,
} from "./importQueue.svelte";

function makeJob(id: string, overrides: Partial<ClientJob> = {}): ClientJob {
  return {
    id,
    isClient: true,
    kind: "import.guitarpro",
    status: "queued",
    label: "song.gp5",
    result: null,
    error: null,
    error_key: "",
    error_params: {},
    progress: "",
    progress_key: "",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("importQueue", () => {
  beforeEach(() => {
    dismissAllClientJobs();
  });

  it("manages client jobs addition, retrieval, update, and dismissal", () => {
    const job1 = makeJob("job-1");
    addClientJob(job1);

    expect(getClientJobs()).toHaveLength(1);
    expect(getClientJobs()[0].id).toBe("job-1");

    updateClientJob("job-1", { status: "running", progress: "Parsing…" });
    expect(getClientJobs()[0].status).toBe("running");
    expect(getClientJobs()[0].progress).toBe("Parsing…");

    // Updating a non-existent job does nothing
    updateClientJob("non-existent", { status: "done" });
    expect(getClientJobs()[0].status).toBe("running");

    dismissClientJob("job-1");
    expect(getClientJobs()).toHaveLength(0);
  });

  it("dismissAll clears both client jobs and tracked server job ids", () => {
    addClientJob(makeJob("job-1"));
    addClientJob(makeJob("job-2"));
    importQueue.trackJobIds(["server-1", "server-2"]);

    expect(getClientJobs()).toHaveLength(2);
    expect(importQueue.trackedServerJobIds.has("server-1")).toBe(true);

    importQueue.untrackJobId("server-1");
    expect(importQueue.trackedServerJobIds.has("server-1")).toBe(false);
    expect(importQueue.trackedServerJobIds.has("server-2")).toBe(true);

    const prevRefresh = importQueue.lastServerRefresh;
    importQueue.notifyServerJobs();
    expect(importQueue.lastServerRefresh).toBeGreaterThanOrEqual(prevRefresh);

    dismissAllClientJobs();
    expect(getClientJobs()).toHaveLength(0);
    expect(importQueue.trackedServerJobIds.size).toBe(0);
  });
});
