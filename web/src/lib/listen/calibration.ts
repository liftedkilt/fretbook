import { startListening, type ListenSession } from "./input";

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export interface CalibrationOptions {
  outputDeviceId?: string;
  inputDeviceId?: string;
  channel?: number;
  /** Seconds between clicks. Defaults to 0.5s (120 BPM). */
  clickInterval?: number;
  /** Number of clicks in the calibration sequence. Defaults to 10. */
  clickCount?: number;
  /** Warm-up clicks before recording onsets. Defaults to 2. */
  leadInClicks?: number;
  onProgress?: (progress: CalibrationProgress) => void;
  onDetectedOnset?: (offsetMs: number) => void;
}

export interface CalibrationProgress {
  phase: "idle" | "calibrating" | "done" | "cancelled";
  clickIndex: number;
  totalClicks: number;
  detectedCount: number;
  lastOffsetMs?: number;
}

export interface CalibrationResult {
  medianOffsetMs: number;
  jitterMs: number;
  sampleCount: number;
  offsetsMs: number[];
  isBluetooth: boolean;
  highJitter: boolean;
}

/** Check if device label indicates a Bluetooth audio connection. */
export function isBluetoothDevice(label: string): boolean {
  if (!label) return false;
  return /bluetooth|airpods|buds|wireless|wh-1000|bose|beats|hands-free|headset|\bbt\b/i.test(
    label,
  );
}

/** Check if jitter is high enough to warrant a warning. */
export function isHighJitter(jitterMs: number, thresholdMs = 30): boolean {
  return jitterMs > thresholdMs;
}

/** Compute the median value of a list of numbers, rounded to 1 decimal place. */
export function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(median * 10) / 10;
}

/** Compute jitter as the sample standard deviation, rounded to 1 decimal place. */
export function computeJitter(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, x) => sum + x, 0) / values.length;
  const variance = values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (values.length - 1);
  return Math.round(Math.sqrt(variance) * 10) / 10;
}

/** Remove statistical outliers using the 1.5 * IQR rule. */
export function filterOutliers(values: number[]): number[] {
  if (values.length < 4) return [...values];
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const min = q1 - 1.5 * iqr;
  const max = q3 + 1.5 * iqr;
  const filtered = sorted.filter((v) => v >= min && v <= max);
  return filtered.length > 0 ? filtered : sorted;
}

/** List available audio output devices. */
export async function listOutputDevices(): Promise<AudioDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [{ deviceId: "default", label: "Default" }];
  }
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices
      .filter((d) => d.kind === "audiooutput")
      .map((d) => ({
        deviceId: d.deviceId || "default",
        label:
          d.label || (d.deviceId === "default" ? "Default" : `Output (${d.deviceId.slice(0, 8)})`),
      }));
    if (outputs.length === 0) {
      return [{ deviceId: "default", label: "Default" }];
    }
    return outputs;
  } catch {
    return [{ deviceId: "default", label: "Default" }];
  }
}

/** Synthesize a short, sharp click sound. */
export function scheduleClick(
  ctx: AudioContext,
  time: number,
  frequency = 1000,
  duration = 0.02,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(frequency, time);
  // Pitch drop gives a percussive rimshot character
  osc.frequency.exponentialRampToValueAtTime(100, time + duration);

  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(0.8, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, time + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(time);
  osc.stop(time + duration);
}

/** LocalStorage helpers for caching calibrations. */
const STORAGE_PREFIX = "fretbook.calibration.";

export function getLocalCalibration(
  outputDeviceId = "default",
  inputDeviceId = "default",
): number | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const key = `${STORAGE_PREFIX}${outputDeviceId}:${inputDeviceId}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function setLocalCalibration(
  outputDeviceId = "default",
  inputDeviceId = "default",
  offsetMs: number,
): void {
  try {
    if (typeof localStorage === "undefined") return;
    const key = `${STORAGE_PREFIX}${outputDeviceId}:${inputDeviceId}`;
    localStorage.setItem(key, String(offsetMs));
  } catch {
    // Ignore storage quota or access errors
  }
}

/**
 * Orchestrates an interactive latency calibration wizard.
 * Plays a series of clicks, captures onsets, and calculates median offset and jitter.
 */
export class CalibrationWizard {
  private active = false;
  private audioCtx: AudioContext | null = null;
  private listenSession: ListenSession | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  async run(options: CalibrationOptions = {}): Promise<CalibrationResult> {
    const clickInterval = options.clickInterval ?? 0.5;
    const clickCount = options.clickCount ?? 10;
    const leadInClicks = options.leadInClicks ?? 2;
    const totalClicks = leadInClicks + clickCount;

    this.active = true;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    this.audioCtx = ctx;

    if (options.outputDeviceId && "setSinkId" in ctx) {
      try {
        await (ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(
          options.outputDeviceId,
        );
      } catch {
        // Fallback to default output if setSinkId fails
      }
    }

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    const scheduledClicks: { index: number; time: number; recorded: boolean }[] = [];
    const recordedOffsets: number[] = [];

    // Start listening for mic / instrument attacks
    const listen = await startListening({
      deviceId: options.inputDeviceId,
      channel: options.channel,
      onPitch: (event) => {
        if (!this.active || !event.onset) return;
        const onsetTime = event.onsetTime ?? event.time;

        // Find the click that this onset corresponds to
        for (let i = scheduledClicks.length - 1; i >= 0; i--) {
          const click = scheduledClicks[i];
          if (click.index < leadInClicks) continue; // Ignore lead-in clicks
          if (click.recorded) continue;

          const diffSec = onsetTime - click.time;
          // Valid onset is after the click and before the next click window
          if (diffSec >= 0 && diffSec < clickInterval * 0.9) {
            click.recorded = true;
            const offsetMs = Math.round(diffSec * 1000 * 10) / 10;
            recordedOffsets.push(offsetMs);
            options.onDetectedOnset?.(offsetMs);
            options.onProgress?.({
              phase: "calibrating",
              clickIndex: click.index + 1,
              totalClicks,
              detectedCount: recordedOffsets.length,
              lastOffsetMs: offsetMs,
            });
            break;
          }
        }
      },
    });
    this.listenSession = listen;

    // Schedule clicks
    const startTime = ctx.currentTime + 0.1;
    for (let i = 0; i < totalClicks; i++) {
      const clickTime = startTime + i * clickInterval;
      scheduledClicks.push({ index: i, time: clickTime, recorded: false });
      scheduleClick(ctx, clickTime, i < leadInClicks ? 800 : 1200);

      const delayMs = Math.max(0, (clickTime - ctx.currentTime) * 1000);
      setTimeout(() => {
        if (!this.active) return;
        options.onProgress?.({
          phase: "calibrating",
          clickIndex: i + 1,
          totalClicks,
          detectedCount: recordedOffsets.length,
          lastOffsetMs: recordedOffsets[recordedOffsets.length - 1],
        });
      }, delayMs);
    }

    // Wait until the sequence completes
    const totalDurationMs = (totalClicks * clickInterval + 0.5) * 1000;
    await new Promise<void>((resolve) => {
      this.timer = setTimeout(resolve, totalDurationMs);
    });

    await this.cleanup();

    const cleanOffsets = filterOutliers(recordedOffsets);
    const medianOffsetMs = computeMedian(cleanOffsets);
    const jitterMs = computeJitter(cleanOffsets);

    const isBluetooth = isBluetoothDevice(options.outputDeviceId ?? "");
    const highJitter = isHighJitter(jitterMs);

    options.onProgress?.({
      phase: "done",
      clickIndex: totalClicks,
      totalClicks,
      detectedCount: cleanOffsets.length,
      lastOffsetMs: medianOffsetMs,
    });

    return {
      medianOffsetMs,
      jitterMs,
      sampleCount: cleanOffsets.length,
      offsetsMs: cleanOffsets,
      isBluetooth,
      highJitter,
    };
  }

  async cancel(): Promise<void> {
    this.active = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    if (this.listenSession) {
      try {
        await this.listenSession.stop();
      } catch {
        // Ignored
      }
      this.listenSession = null;
    }
    if (this.audioCtx) {
      try {
        await this.audioCtx.close();
      } catch {
        // Ignored
      }
      this.audioCtx = null;
    }
  }
}
