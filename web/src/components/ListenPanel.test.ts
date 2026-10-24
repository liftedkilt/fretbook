import { fireEvent, render, screen } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ListenPanel from "./ListenPanel.svelte";
import type { ListenSession } from "../lib/listen";

const listInputDevices = vi.fn();

vi.mock("../lib/listen/input", async (original) => ({
  ...(await original<typeof import("../lib/listen/input")>()),
  listInputDevices: () => listInputDevices(),
}));

function fakeSession(
  channelCount: number,
): ListenSession & { setChannel: ReturnType<typeof vi.fn> } {
  return {
    sampleRate: 48000,
    channelCount,
    currentTime: 0,
    setChannel: vi.fn(),
    setExpectedMidi: vi.fn(),
    setChroma: vi.fn(),
    stop: vi.fn(async () => undefined),
  };
}

describe("ListenPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    listInputDevices.mockReset();
    listInputDevices.mockResolvedValue([
      { deviceId: "scarlett", label: "Scarlett 2i2" },
      { deviceId: "mic", label: "" },
    ]);
  });

  it("lists the input devices and remembers the pick", async () => {
    const onDevice = vi.fn();
    render(ListenPanel, { onDevice });
    expect(await screen.findByRole("option", { name: "Scarlett 2i2" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Input 2" })).toBeInTheDocument();

    await fireEvent.change(screen.getByTestId("listen-device"), { target: { value: "scarlett" } });
    expect(onDevice).toHaveBeenCalledWith("scarlett");
    expect(localStorage.getItem("fretbook.listen.device")).toBe("scarlett");
  });

  it("refreshes the device list when a session starts", async () => {
    listInputDevices.mockResolvedValueOnce([{ deviceId: "scarlett", label: "" }]);
    const view = render(ListenPanel);
    expect(await screen.findByRole("option", { name: "Input 1" })).toBeInTheDocument();
    await view.rerender({ session: fakeSession(1) });
    expect(await screen.findByRole("option", { name: "Scarlett 2i2" })).toBeInTheDocument();
  });

  it("offers a channel picker only for multi-channel devices, remembered per device", async () => {
    const session = fakeSession(2);
    const onChannel = vi.fn();
    const view = render(ListenPanel, { session, deviceId: "scarlett", onChannel });
    await fireEvent.change(screen.getByTestId("listen-channel"), { target: { value: "1" } });
    expect(session.setChannel).toHaveBeenCalledWith(1);
    expect(onChannel).toHaveBeenCalledWith(1);
    expect(JSON.parse(localStorage.getItem("fretbook.listen.channels") ?? "{}")).toEqual({
      scarlett: 1,
    });

    await view.rerender({ session: fakeSession(1), deviceId: "scarlett" });
    expect(screen.queryByTestId("listen-channel")).not.toBeInTheDocument();
  });

  it("restores the remembered channel of the chosen device", async () => {
    localStorage.setItem("fretbook.listen.channels", JSON.stringify({ scarlett: 1 }));
    const onChannel = vi.fn();
    render(ListenPanel, { onChannel });
    await screen.findByRole("option", { name: "Scarlett 2i2" });
    await fireEvent.change(screen.getByTestId("listen-device"), { target: { value: "scarlett" } });
    expect(onChannel).toHaveBeenCalledWith(1);
  });

  it("falls back to the first channel when the remembered one is gone", async () => {
    const onChannel = vi.fn();
    render(ListenPanel, { session: fakeSession(1), channel: 3, onChannel });
    await vi.waitFor(() => expect(onChannel).toHaveBeenCalledWith(0));
  });

  it("drives the level meter from the peak", async () => {
    const view = render(ListenPanel, { level: 0 });
    const meter = screen.getByRole("meter", { name: "Input level" });
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    await view.rerender({ level: 0.1 });
    expect(meter).toHaveAttribute("aria-valuenow", "67");
    await view.rerender({ level: 1 });
    expect(meter).toHaveAttribute("aria-valuenow", "100");
  });

  it("explains why listening could not start", () => {
    render(ListenPanel, { problem: "denied" });
    expect(screen.getByRole("alert")).toHaveTextContent(/blocked/);
  });
});
