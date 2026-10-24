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
