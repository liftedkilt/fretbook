import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import YouTubeAudio from "./YouTubeAudio.svelte";

const mockAttach = vi.fn();
const mockWait = vi.fn();
const mockDismiss = vi.fn();

vi.mock("../lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    key: string;
    params: Record<string, string | number>;
    constructor(status: number, message: string, key = "", params = {}) {
      super(message);
      this.status = status;
      this.key = key;
      this.params = params;
    }
  },
  attachYouTubeAudio: (...args: unknown[]) => mockAttach(...args),
  waitForJob: (...args: unknown[]) => mockWait(...args),
  dismissJob: (...args: unknown[]) => mockDismiss(...args),
}));

const LINK = "https://youtu.be/dQw4w9WgXcQ";

describe("YouTubeAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDismiss.mockResolvedValue(undefined);
  });

  it("queues the link, waits for the job and tells the player", async () => {
    mockAttach.mockResolvedValue({ job_id: "j1" });
    mockWait.mockResolvedValue({ status: "done", result: {} });
    const ondone = vi.fn();
    render(YouTubeAudio, { songId: "s1", ondone });
    expect(screen.getByTestId("youtube-audio-go")).toBeDisabled();

    await fireEvent.input(screen.getByTestId("youtube-audio-url"), {
      target: { value: ` ${LINK} ` },
    });
    await fireEvent.click(screen.getByTestId("youtube-audio-go"));

    await waitFor(() => expect(ondone).toHaveBeenCalledTimes(1));
    expect(mockAttach).toHaveBeenCalledWith("s1", LINK);
    expect(mockDismiss).toHaveBeenCalledWith("j1");
    expect(screen.getByTestId("youtube-audio-url")).toHaveValue("");
  });

  it("shows a translated error when the job fails", async () => {
    mockAttach.mockResolvedValue({ job_id: "j2" });
    mockWait.mockResolvedValue({
      status: "error",
      error: "off",
      error_key: "import.audioDisabled",
      error_params: {},
    });
    const ondone = vi.fn();
    render(YouTubeAudio, { songId: "s1", ondone });
    await fireEvent.input(screen.getByTestId("youtube-audio-url"), { target: { value: LINK } });
    await fireEvent.click(screen.getByTestId("youtube-audio-go"));

    expect(await screen.findByTestId("youtube-audio-error")).toHaveTextContent(
      "Audio downloads are turned off on this server.",
    );
    expect(ondone).not.toHaveBeenCalled();
  });

  it("shows the server's key when the request is refused", async () => {
    const { ApiError } = await import("../lib/api");
    mockAttach.mockRejectedValue(new ApiError(400, "paste", "audio.notYoutube"));
    render(YouTubeAudio, { songId: "s1", ondone: vi.fn() });
    await fireEvent.input(screen.getByTestId("youtube-audio-url"), {
      target: { value: "https://example.com/watch?v=x" },
    });
    await fireEvent.click(screen.getByTestId("youtube-audio-go"));
    expect(await screen.findByTestId("youtube-audio-error")).toHaveTextContent(
      "Paste a YouTube video link.",
    );
  });
});
