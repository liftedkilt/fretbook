import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import StemMixer from "./StemMixer.svelte";

const api = vi.hoisted(() => ({
  getStems: vi.fn(),
  startStems: vi.fn(),
  deleteStems: vi.fn(),
  getJob: vi.fn(),
  dismissJob: vi.fn(),
}));
vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  ...api,
}));

const stems = [
  { name: "guitar", url: "api/songs/s1/stems/guitar?v=a", byte_size: 10 },
  { name: "bass", url: "api/songs/s1/stems/bass?v=b", byte_size: 10 },
];

function mount() {
  const audioEl = document.createElement("audio");
  audioEl.volume = 0.9;
  const onactive = vi.fn();
  render(StemMixer, { songId: "s1", audioEl, master: 1, onactive });
  return { audioEl, onactive };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  api.dismissJob.mockResolvedValue(undefined);
});

describe("StemMixer", () => {
  it("stays hidden when there are no stems and no worker can make them", async () => {
    api.getStems.mockResolvedValue({ stems: [], available: false });
    mount();
    await waitFor(() => expect(api.getStems).toHaveBeenCalled());
    expect(screen.queryByTestId("stem-mixer")).toBeNull();
  });

  it("separates the recording, then mixes the stems", async () => {
    api.getStems.mockResolvedValueOnce({ stems: [], available: true });
    api.getStems.mockResolvedValueOnce({ stems, available: true });
    api.startStems.mockResolvedValue({ job_id: "j1" });
    api.getJob.mockResolvedValue({
      id: "j1",
      kind: "audio.stems",
      status: "done",
      result: { stems: ["guitar", "bass"] },
      error: null,
      error_key: "",
      error_params: {},
      progress: "",
      progress_key: "",
    });
    const { audioEl, onactive } = mount();
    await fireEvent.click(await screen.findByTestId("stems-separate"));
    await screen.findByTestId("stem-bass");
    expect(onactive).toHaveBeenCalledWith(true);
    expect(audioEl.volume).toBe(0);
    // Bass comes before guitar whatever order the server listed them in.
    const rows = screen.getAllByTestId(/^stem-(bass|guitar)$/);
    expect(rows.map((row) => row.dataset.testid)).toEqual(["stem-bass", "stem-guitar"]);

    const mute = screen.getByTestId("stem-mute-bass");
    expect(mute.getAttribute("aria-pressed")).toBe("false");
    await fireEvent.click(mute);
    expect(mute.getAttribute("aria-pressed")).toBe("true");
    expect(JSON.parse(localStorage.getItem("fretbook.stems.s1")!).bass.mute).toBe(true);
    await fireEvent.click(screen.getByTestId("stem-solo-guitar"));
    expect(screen.getByTestId("stem-solo-guitar").getAttribute("aria-pressed")).toBe("true");

    await fireEvent.click(screen.getByTestId("stems-use"));
    expect(onactive).toHaveBeenLastCalledWith(false);
    expect(audioEl.volume).toBe(0.9);
    expect(screen.queryByTestId("stem-bass")).toBeNull();
  });

  it("shows why a separation failed and offers it again", async () => {
    api.getStems.mockResolvedValue({ stems: [], available: true });
    api.startStems.mockResolvedValue({ job_id: "j1" });
    api.getJob.mockResolvedValue({
      id: "j1",
      kind: "audio.stems",
      status: "error",
      result: null,
      error: "Demucs is not installed in this worker",
      error_key: "stems.unavailable",
      error_params: {},
      progress: "",
      progress_key: "",
    });
    mount();
    await fireEvent.click(await screen.findByTestId("stems-separate"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Demucs is not installed in the worker");
    expect(screen.getByTestId("stems-separate")).toBeTruthy();
  });

  it("lists existing stems without a worker, and removes them", async () => {
    api.getStems.mockResolvedValueOnce({ stems, available: false });
    api.getStems.mockResolvedValueOnce({ stems: [], available: false });
    api.deleteStems.mockResolvedValue(undefined);
    mount();
    expect(await screen.findByTestId("stems-use")).toBeTruthy();
    expect(screen.queryByTestId("stems-separate")).toBeNull();
    await fireEvent.click(screen.getByTestId("stems-remove"));
    await waitFor(() => expect(api.deleteStems).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.queryByTestId("stem-mixer")).toBeNull());
  });
});
