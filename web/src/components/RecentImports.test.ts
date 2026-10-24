import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addClientJob, dismissAllClientJobs, importQueue } from "../lib/importQueue.svelte";
import type { Job } from "../lib/types";
import RecentImports from "./RecentImports.svelte";

const mockListJobs = vi.fn();
const mockRetryJob = vi.fn();
const mockDismissJob = vi.fn();
const mockListSongs = vi.fn().mockResolvedValue({ items: [], total: 0, counts: {} });

vi.mock("../lib/api", () => ({
  listJobs: (...args: unknown[]) => mockListJobs(...args),
  retryJob: (...args: unknown[]) => mockRetryJob(...args),
  dismissJob: (...args: unknown[]) => mockDismissJob(...args),
  listSongs: (...args: unknown[]) => mockListSongs(...args),
  listTags: vi.fn().mockResolvedValue([]),
  setFavourite: vi.fn(),
  addTags: vi.fn(),
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

  it("renders completed jobs with link to song when active in session", async () => {
    const runningJob = makeJob({
      id: "run-done-1",
      label: "my-riff.gp5",
      status: "running",
    });
    mockListJobs.mockResolvedValue([runningJob]);

    render(RecentImports);

    await vi.waitFor(() => {
      expect(screen.getByTestId("recent-imports-panel")).toBeInTheDocument();
    });

    const doneJob = makeJob({
      id: "run-done-1",
      label: "my-riff.gp5",
      status: "done",
      result: { song_id: "song-123" },
    });
    mockListJobs.mockResolvedValue([doneJob]);
    // The panel refetches when the queue reports new server jobs. A prop-less
    // rerender does not, and the 1s poll loses the race against waitFor in CI.
    importQueue.notifyServerJobs();

    await vi.waitFor(() => {
      expect(screen.getByTestId("job-link")).toHaveAttribute("href", "/songs/song-123");
    });
  });

  it("renders duplicate skipped and duplicate replaced statuses", async () => {
    const skippedJob = makeJob({
      id: "skip-1",
      label: "duplicate-riff.gp5",
      status: "done",
      result: { song_id: "song-1", skipped: true },
    });
    const replacedJob = makeJob({
      id: "replace-1",
      label: "replaced-riff.gp5",
      status: "done",
      result: { song_id: "song-2", replaced: true },
    });
    mockListJobs.mockResolvedValue([
      { ...skippedJob, status: "queued" },
      { ...replacedJob, status: "queued" },
    ]);

    const { rerender } = render(RecentImports);
    await vi.waitFor(() => {
      expect(screen.getByTestId("recent-imports-panel")).toBeInTheDocument();
    });

    mockListJobs.mockResolvedValue([skippedJob, replacedJob]);
    rerender({});

    await vi.waitFor(() => {
      expect(screen.getByText("duplicate-riff.gp5")).toBeInTheDocument();
      expect(screen.getByText("replaced-riff.gp5")).toBeInTheDocument();
    });
  });

  it("renders client-side worker jobs", async () => {
    mockListJobs.mockResolvedValue([]);
    addClientJob({
      id: "client-test-1",
      isClient: true,
      kind: "import.guitarpro",
      status: "running",
      label: "client-song.gp5",
      result: null,
      error: null,
      error_key: "",
      error_params: {},
      progress: "Parsing Guitar Pro in worker…",
      progress_key: "bulk.parsing",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    render(RecentImports);

    await vi.waitFor(() => {
      expect(screen.getByTestId("recent-imports-panel")).toBeInTheDocument();
      expect(screen.getByText("client-song.gp5")).toBeInTheDocument();
    });

    await fireEvent.click(screen.getByTestId("job-dismiss"));
    await vi.waitFor(() => {
      expect(screen.queryByTestId("recent-imports-panel")).toBeNull();
    });

    dismissAllClientJobs();
  });
});
