import { getLocalCalibration } from "./calibration";
import { clampA4 } from "../tuner";
import { DEFAULT_A4 } from "./notes";

const DEVICE_KEY = "fretbook.listen.device";
const CHANNEL_KEY = "fretbook.listen.channels";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode
  }
}

function readChannels(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(read(CHANNEL_KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** The input device the player chose last; empty means the browser's default. */
export function getSavedDevice(): string {
  return read(DEVICE_KEY) ?? "";
}

export function saveDevice(deviceId: string) {
  write(DEVICE_KEY, deviceId);
}

/** The channel remembered for one device (0-based), 0 if none was saved. */
export function getSavedChannel(deviceId: string): number {
  const value = readChannels()[deviceId];
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export function saveChannel(deviceId: string, channel: number) {
  write(CHANNEL_KEY, JSON.stringify({ ...readChannels(), [deviceId]: channel }));
}

const A4_KEY = "fretbook.listen.a4";
const OUTPUT_KEY = "fretbook.listen.output";

/** The A4 reference shared by the tuner, wait mode and scored play; 440 until the player moves it. */
export function getSavedA4(): number {
  const value = Number.parseFloat(read(A4_KEY) ?? "");
  return Number.isFinite(value) ? clampA4(value) : DEFAULT_A4;
}

export function saveA4(a4: number) {
  write(A4_KEY, String(clampA4(a4)));
}

/** The output device the player last calibrated; empty means the browser's default. */
export function getSavedOutput(): string {
  return read(OUTPUT_KEY) ?? "";
}

export function saveOutput(deviceId: string) {
  write(OUTPUT_KEY, deviceId);
}

/**
 * The round-trip latency (ms) stored for the player's calibrated output and the given input,
 * falling back to the `default:default` pair. Null when nothing was ever calibrated.
 */
export function getStoredCalibration(inputDeviceId = getSavedDevice()): number | null {
  const output = getSavedOutput() || "default";
  const input = inputDeviceId || "default";
  return getLocalCalibration(output, input) ?? getLocalCalibration("default", "default");
}
