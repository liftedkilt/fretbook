import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminView from "./AdminView.svelte";

const api = vi.hoisted(() => ({
  listUsers: vi.fn(),
  getAdminStorage: vi.fn(),
  cleanOrphans: vi.fn(),
  getAdminJobs: vi.fn(),
  getAdminWorkers: vi.fn(),
  cancelAdminJob: vi.fn(),
  retryAdminJob: vi.fn(),
  getAdminSystem: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  adoptLocal: vi.fn(),
  revokeUserTokens: vi.fn(),
  signOutUser: vi.fn(),
  ...api,
}));

const job = (id: string, status: string, label: string) => ({
  id,
  kind: "import.songsterr",
  status,
  label,
  owner_id: "u1",
  owner_name: "Uma",
  worker_id: "",
  attempts: 0,
  error: status === "error" ? "boom" : null,
  error_key: "",
  error_params: {},
  progress: "",
  progress_key: "",
  created_at: "2026-01-01T00:00:00+00:00",
  updated_at: "2026-01-01T00:00:00+00:00",
});

describe("AdminView dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.listUsers.mockResolvedValue([]);
    api.getAdminStorage.mockResolvedValue({
      users: [
        {
          user_id: "u1",
          display_name: "Uma",
          local: false,
          song_count: 2,
          db_rows: 5,
          media_files: 3,
          media_bytes: 1536,
          quota_bytes: 1048576,
        },
      ],
      orphans: { files: 2, bytes: 2048, empty_dirs: 1 },
    });
    api.cleanOrphans.mockResolvedValue({ files: 2, bytes: 2048, empty_dirs: 1 });
    api.getAdminJobs.mockResolvedValue({
      counts: [
        { kind: "import.songsterr", status: "queued", count: 1 },
        { kind: "import.songsterr", status: "error", count: 1 },
      ],
      jobs: [job("j1", "queued", "Queued tab"), job("j2", "error", "Broken tab")],
    });
    api.getAdminWorkers.mockResolvedValue({
      workers: [
        {
          id: "gpu-1",
          kinds: ["stems"],
          host: "box",
          pid: 7,
          started_at: "2026-01-01T00:00:00+00:00",
          heartbeat_at: "2026-01-01T00:00:00+00:00",
          alive: true,
        },
      ],
      local_kinds: ["import.songsterr"],
    });
    api.cancelAdminJob.mockResolvedValue({ job_id: "j1" });
    api.retryAdminJob.mockResolvedValue({ job_id: "j2" });
    api.getAdminSystem.mockResolvedValue({
      version: "1.2.3",
      commit: null,
      schema_version: 19,
      ytdlp_version: "2026.01.01",
      python_version: "3.12.1",
      disk_free_bytes: 5 * 1024 ** 3,
      disk_total_bytes: 10 * 1024 ** 3,
      database_bytes: 4096,
      user_quota_mb: 0,
    });
  });

  it("shows storage per user and cleans orphaned files", async () => {
    render(AdminView, { self: "u1" });
    await fireEvent.click(screen.getByTestId("admin-tab-storage"));
    const table = await screen.findByTestId("storage-table");
    expect(table).toHaveTextContent("Uma");
    expect(table).toHaveTextContent("1.5 KB");
    expect(table).toHaveTextContent("1.5 KB / 1.0 MB");
    expect(screen.getByTestId("orphans-found")).toHaveTextContent("2 files (2.0 KB)");
    await fireEvent.click(screen.getByRole("button", { name: /Delete orphaned files/ }));
    await waitFor(() => expect(api.cleanOrphans).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Deleted 2 files and freed 2.0 KB.",
    );
  });

  it("lists jobs and workers; cancels queued jobs and retries failed ones", async () => {
    render(AdminView, { self: "u1" });
    await fireEvent.click(screen.getByTestId("admin-tab-jobs"));
    expect(await screen.findByText("Queued tab")).toBeInTheDocument();
    expect(screen.getByTestId("worker-table")).toHaveTextContent("gpu-1");
    expect(screen.getByTestId("worker-table")).toHaveTextContent("Online");
    expect(screen.getByText(/Run by the web server: import.songsterr/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    await waitFor(() => expect(api.cancelAdminJob).toHaveBeenCalledWith("j1"));
    await fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(api.retryAdminJob).toHaveBeenCalledWith("j2"));

    await fireEvent.change(screen.getByTestId("job-status-filter"), { target: { value: "error" } });
    await waitFor(() => expect(api.getAdminJobs).toHaveBeenLastCalledWith("error"));
  });

  it("shows system information", async () => {
    render(AdminView, { self: "u1" });
    await fireEvent.click(screen.getByTestId("admin-tab-system"));
    const info = await screen.findByTestId("system-info");
    expect(info).toHaveTextContent("1.2.3");
    expect(info).toHaveTextContent("3.12.1");
    expect(info).toHaveTextContent("2026.01.01");
    expect(info).toHaveTextContent("5.0 GB / 10 GB");
  });
});
