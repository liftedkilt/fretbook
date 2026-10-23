import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../lib/api";
import * as calModule from "../lib/listen/calibration";
import * as inputModule from "../lib/listen/input";
import { ui } from "../lib/ui.svelte";
import CalibrationSheet from "./CalibrationSheet.svelte";

vi.mock("../lib/api", () => ({
  getCalibration: vi.fn(),
  saveCalibration: vi.fn(),
}));

describe("CalibrationSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ui.sheet = "calibration";

    vi.spyOn(calModule, "listOutputDevices").mockResolvedValue([
      { deviceId: "default", label: "Default Output" },
      { deviceId: "bt-1", label: "AirPods Pro Bluetooth" },
    ]);

    vi.spyOn(inputModule, "listInputDevices").mockResolvedValue([
      { deviceId: "default", label: "Default Input" },
      { deviceId: "usb-mic", label: "Scarlett 2i2 USB" },
    ]);

    vi.mocked(api.getCalibration).mockResolvedValue(null);
    vi.mocked(api.saveCalibration).mockResolvedValue({
      output_device: "default",
      input_device: "default",
      offset_ms: 50,
      jitter_ms: 2.5,
      updated_at: "2026-01-01T00:00:00Z",
    });
  });

  it("renders device pickers and manual adjustment slider", async () => {
    render(CalibrationSheet);

    expect(screen.getByTestId("calibration-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("output-device-select")).toBeInTheDocument();
    expect(screen.getByTestId("input-device-select")).toBeInTheDocument();
    expect(screen.getByTestId("offset-slider")).toBeInTheDocument();
    expect(screen.getByTestId("start-calibration-button")).toBeInTheDocument();
  });

  it("loads and displays stored calibration from the server", async () => {
    vi.mocked(api.getCalibration).mockResolvedValue({
      output_device: "default",
      input_device: "default",
      offset_ms: 65,
      jitter_ms: 4.1,
      updated_at: "2026-01-01T00:00:00Z",
    });

    render(CalibrationSheet);

    await waitFor(() => {
      const status = screen.getByTestId("current-calibration");
      expect(status).toHaveTextContent("65");
      expect(status).toHaveTextContent("4.1");
    });
  });

  it("warns when Bluetooth audio output is selected", async () => {
    render(CalibrationSheet);

    // Wait for options to render
    const option = await screen.findByRole("option", { name: "AirPods Pro Bluetooth" });
    expect(option).toBeInTheDocument();

    // Default output is not bluetooth
    expect(screen.queryByTestId("bluetooth-warning")).not.toBeInTheDocument();

    // Select Bluetooth device
    const select = screen.getByTestId("output-device-select");
    await fireEvent.change(select, { target: { value: "bt-1" } });

    expect(await screen.findByTestId("bluetooth-warning")).toBeInTheDocument();
  });

  it("allows manually adjusting and saving the latency offset", async () => {
    render(CalibrationSheet);

    await screen.findByRole("option", { name: "Default Output" });
    const slider = screen.getByTestId("offset-slider");
    await fireEvent.input(slider, { target: { value: "85" } });

    expect(screen.getByTestId("offset-value")).toHaveTextContent("85 ms");

    const saveBtn = screen.getByTestId("save-calibration-button");
    await fireEvent.click(saveBtn);

    expect(api.saveCalibration).toHaveBeenCalledWith({
      output_device: "default",
      input_device: "default",
      offset_ms: 85,
      jitter_ms: null,
    });
    expect(await screen.findByTestId("save-success-notice")).toBeInTheDocument();
  });

  it("runs the calibration wizard and displays measured results", async () => {
    vi.spyOn(calModule.CalibrationWizard.prototype, "run").mockImplementation(async function (
      this: calModule.CalibrationWizard,
      options?: calModule.CalibrationOptions,
    ) {
      options?.onProgress?.({
        phase: "calibrating",
        clickIndex: 5,
        totalClicks: 12,
        detectedCount: 4,
        lastOffsetMs: 72,
      });
      return {
        medianOffsetMs: 72.5,
        jitterMs: 35.0,
        sampleCount: 8,
        offsetsMs: [70, 72, 73, 75],
        isBluetooth: false,
        highJitter: true,
      };
    });

    render(CalibrationSheet);

    await screen.findByRole("option", { name: "Default Output" });
    const startBtn = screen.getByTestId("start-calibration-button");
    await fireEvent.click(startBtn);

    // Results screen should appear
    expect(await screen.findByTestId("results-section")).toBeInTheDocument();
    expect(screen.getByTestId("result-offset")).toHaveTextContent("72.5");
    expect(screen.getByTestId("result-jitter")).toHaveTextContent("35");

    // High jitter warning should be visible
    expect(screen.getByTestId("high-jitter-warning")).toBeInTheDocument();

    // Save from results screen
    const saveBtn = screen.getByTestId("save-result-button");
    await fireEvent.click(saveBtn);

    expect(api.saveCalibration).toHaveBeenCalledWith({
      output_device: "default",
      input_device: "default",
      offset_ms: 72.5,
      jitter_ms: 35.0,
    });
  });
});
