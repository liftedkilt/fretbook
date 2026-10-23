import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../lib/types";
import RecentImports from "./RecentImports.svelte";

const mockListJobs = vi.fn();
const mockRetryJob = vi.fn();
const mockDismissJob = vi.fn();

vi.mock("../lib/api", () => ({
  listJobs: (...args: unknown[]) => mockListJobs(...args),
  retryJob: (...args: unknown[]) => mockRetryJob(...args),
  dismissJob: (...args: unknown[]) => mockDismissJob(...args),
}));

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: "job-1",
    kind: "import.songsterr",
    status: "error",
    label: "hotel-california.musicxml",
    result: null,
    error: "Failed to parse MusicXML",
    error_key: "musicxml.parse",
    error_params: {},
    progress: "",
    progress_key: "",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("RecentImports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListJobs.mockResolvedValue([]);
  });

  it("renders nothing when there are no active or failed jobs", async () => {
    mockListJobs.mockResolvedValue([makeJob({ status: "done" })]);

    render(RecentImports);

    await vi.waitFor(() => {
      expect(screen.queryByTestId("recent-imports-panel")).toBeNull();
    });
  });

  it("renders failed jobs with error and retry/dismiss buttons", async () => {
    const failedJob = makeJob({
      id: "failed-1",
      label: "bad-song.musicxml",
      status: "error",
      error: "MusicXML parse error",
      error_key: "musicxml.parse",
    });
    mockListJobs.mockResolvedValue([failedJob]);

    render(RecentImports);

    await vi.waitFor(() => {
      expect(screen.getByTestId("recent-imports-panel")).toBeInTheDocument();
      expect(screen.getByText("bad-song.musicxml")).toBeInTheDocument();
      expect(screen.getByTestId("job-retry")).toBeInTheDocument();
      expect(screen.getByTestId("job-dismiss")).toBeInTheDocument();
    });

    mockRetryJob.mockResolvedValue({ job_id: "failed-1" });
    mockListJobs.mockResolvedValue([
      { ...failedJob, status: "queued", error: null, error_key: "" },
    ]);

    await fireEvent.click(screen.getByTestId("job-retry"));
    expect(mockRetryJob).toHaveBeenCalledWith("failed-1");

    mockDismissJob.mockResolvedValue(undefined);
    await fireEvent.click(screen.getByTestId("job-dismiss"));
    expect(mockDismissJob).toHaveBeenCalledWith("failed-1");
  });

  it("renders queued and running jobs", async () => {
    const runningJob = makeJob({
      id: "running-1",
      label: "songsterr-link",
      status: "running",
      progress: "Downloading audio...",
      progress_key: "import.downloadingAudio",
    });
    mockListJobs.mockResolvedValue([runningJob]);

    render(RecentImports);

    await vi.waitFor(() => {
      expect(screen.getByTestId("recent-imports-panel")).toBeInTheDocument();
      expect(screen.getByText("songsterr-link")).toBeInTheDocument();
      expect(screen.queryByTestId("job-retry")).toBeNull();
      expect(screen.getByTestId("job-dismiss")).toBeInTheDocument();
    });
  });
});
