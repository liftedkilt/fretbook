import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BackupScheduleStatus from "./BackupScheduleStatus.svelte";

const api = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    key: string;
    params: Record<string, string | number>;
    constructor(
      status: number,
      message: string,
      key = "",
      params: Record<string, string | number> = {},
    ) {
      super(message);
      this.status = status;
      this.key = key;
      this.params = params;
    }
  }
  return { ApiError, getBackupSchedule: vi.fn(), runBackupNow: vi.fn() };
});

vi.mock("../lib/api", () => api);

const base = {
  schedule: "daily",
  directory: "/data/backups/snapshots",
  keep: 7,
  last_snapshot: null,
  next_due_at: "2026-03-02T12:00:00+00:00",
  last_error: null,
  last_error_at: null,
  running: false,
};

const snapshot = {
  path: "/data/backups/snapshots/fretbook-backup-20260301T120000Z",
  created_at: "2026-03-01T12:00:00+00:00",
  bytes: 2048,
};

describe("BackupScheduleStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says when no snapshot has been taken", async () => {
    api.getBackupSchedule.mockResolvedValue(base);
    render(BackupScheduleStatus);
    expect(await screen.findByText("No snapshot yet")).toBeTruthy();
    expect(screen.getByText(/Daily, keeping 7/)).toBeTruthy();
    expect(screen.getByText(/next due/)).toBeTruthy();
    expect(screen.getByText("Folder: /data/backups/snapshots")).toBeTruthy();
    expect(screen.queryByTestId("backup-error")).toBeNull();
  });

  it("shows the last snapshot and its size", async () => {
    api.getBackupSchedule.mockResolvedValue({
      ...base,
      schedule: "off",
      next_due_at: null,
      last_snapshot: snapshot,
    });
    render(BackupScheduleStatus);
    const last = await screen.findByTestId("backup-last");
    expect(last.textContent).toContain("Last snapshot");
    expect(last.textContent).toContain("2.0 KB");
    expect(screen.getByText(/No schedule, keeping 7/)).toBeTruthy();
    expect(screen.queryByText(/next due/)).toBeNull();
  });

  it("shows the last error", async () => {
    api.getBackupSchedule.mockResolvedValue({
      ...base,
      last_snapshot: snapshot,
      last_error: "Permission denied",
      last_error_at: "2026-03-02T12:00:00+00:00",
    });
    render(BackupScheduleStatus);
    const alert = await screen.findByTestId("backup-error");
    expect(alert.textContent).toContain("The last backup failed");
    expect(alert.textContent).toContain("Permission denied");
  });

  it("backs up now and reports where", async () => {
    api.getBackupSchedule.mockResolvedValue(base);
    api.runBackupNow.mockResolvedValue({ ...base, last_snapshot: snapshot });
    render(BackupScheduleStatus);
    await screen.findByText("No snapshot yet");
    await fireEvent.click(screen.getByTestId("backup-now"));
    expect(await screen.findByText(`Saved to ${snapshot.path}`)).toBeTruthy();
    expect(api.runBackupNow).toHaveBeenCalledOnce();
  });

  it("reports a failed, a busy and an unexpected back-up", async () => {
    api.getBackupSchedule.mockResolvedValue(base);
    render(BackupScheduleStatus);
    await screen.findByText("No snapshot yet");
    const button = screen.getByTestId("backup-now");

    api.runBackupNow.mockRejectedValueOnce(
      new api.ApiError(500, "x", "backupSchedule.failed", { reason: "disk full" }),
    );
    await fireEvent.click(button);
    expect((await screen.findByTestId("backup-error")).textContent).toContain(
      "The backup failed: disk full",
    );

    api.runBackupNow.mockRejectedValueOnce(new api.ApiError(409, "x", "backupSchedule.busy"));
    await fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId("backup-error").textContent).toContain("already being written"),
    );

    api.runBackupNow.mockRejectedValueOnce(new api.ApiError(403, "only administrators"));
    await fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId("backup-error").textContent).toContain("only administrators"),
    );

    api.runBackupNow.mockRejectedValueOnce("odd");
    await fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByTestId("backup-error").textContent).not.toContain("only"),
    );
    expect(api.getBackupSchedule).toHaveBeenCalledTimes(5);
  });

  it("shows a load error and disables the button while a backup runs", async () => {
    api.getBackupSchedule.mockRejectedValueOnce(new Error("offline"));
    render(BackupScheduleStatus);
    expect((await screen.findByTestId("backup-error")).textContent).toContain("offline");
    api.getBackupSchedule.mockResolvedValue({ ...base, running: true });
    render(BackupScheduleStatus);
    await waitFor(() =>
      expect(
        screen
          .getAllByTestId("backup-now")
          .some((button) => (button as HTMLButtonElement).disabled),
      ).toBe(true),
    );
  });
});
