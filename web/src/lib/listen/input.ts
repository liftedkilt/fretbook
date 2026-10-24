import { t } from "../i18n.svelte";
import type { ChromaEvent } from "./chroma";
import type { PitchEvent } from "./engine";
import type { WorkletCommand, WorkletMessage, WorkletOptions } from "./messages";
// Vite bundles the processor (and the DSP it imports) into one standalone module for addModule().
import processorUrl from "./processor?worker&url";

export type ListenProblem = "insecure" | "unsupported" | "denied" | "noDevice" | "busy" | "other";

export class ListenError extends Error {
  constructor(
    readonly problem: ListenProblem,
    cause?: unknown,
  ) {
    super(`listen: ${problem}`, { cause });
    this.name = "ListenError";
  }
}

/** The explanation shown to the player for a failed start. */
export function describeProblem(problem: ListenProblem): string {
  switch (problem) {
    case "insecure":
      return t("listen.problem.insecure");
    case "unsupported":
      return t("listen.problem.unsupported");
    case "denied":
      return t("listen.problem.denied");
    case "noDevice":
      return t("listen.problem.noDevice");
    case "busy":
      return t("listen.problem.busy");
    default:
      return t("listen.problem.other");
  }
}

/** Browsers only expose the microphone on HTTPS pages and on localhost. */
export function checkAvailable(env: {
  isSecureContext?: boolean;
  mediaDevices?: unknown;
}): ListenProblem | null {
  if (env.isSecureContext === false) return "insecure";
  if (!env.mediaDevices) return "unsupported";
  return null;
}

export function classifyError(error: unknown): ListenProblem {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError")
    return "denied";
  if (
    name === "NotFoundError" ||
    name === "OverconstrainedError" ||
    name === "DevicesNotFoundError"
  )
    return "noDevice";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "other";
}

export interface InputDevice {
  deviceId: string;
  /** Empty until the player has granted microphone access once. */
  label: string;
}

export async function listInputDevices(): Promise<InputDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map((device) => ({ deviceId: device.deviceId, label: device.label }));
}

/** Constraints that leave the instrument's sound alone and ask for every channel of an interface. */
export function audioConstraints(deviceId?: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: { ideal: 8 },
  };
}

/** Meter position for an RMS or peak value: -60 dBFS at 0, full scale at 1. */
export function meterPosition(level: number): number {
  if (level <= 0) return 0;
  return Math.min(1, Math.max(0, (20 * Math.log10(level) + 60) / 60));
}

export interface ListenOptions {
  deviceId?: string;
  /** Which channel of a multi-channel interface carries the instrument (0-based). */
  channel?: number;
  a4?: number;
  /** Lowest note to track in Hz; 28 covers a 5-string bass tuned down a little. */
  minFrequency?: number;
  onPitch: (event: PitchEvent) => void;
  /** Pitch-class readings; they arrive only after `setChroma(true)`. */
  onChroma?: (event: ChromaEvent) => void;
  onLevel?: (level: { rms: number; peak: number }) => void;
}

export interface ListenSession {
  readonly sampleRate: number;
  /** Channels the device delivers, for building a channel picker. */
  readonly channelCount: number;
  setChannel(index: number): void;
  setExpectedMidi(midi: number | null): void;
  /** Start or stop the pitch-class readings used to check chords. */
  setChroma(on: boolean): void;
  stop(): Promise<void>;
}

export async function startListening(options: ListenOptions): Promise<ListenSession> {
  const unavailable = checkAvailable({
    isSecureContext: globalThis.isSecureContext,
    mediaDevices: globalThis.navigator?.mediaDevices,
  });
  if (unavailable) throw new ListenError(unavailable);

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: audioConstraints(options.deviceId),
    });
  } catch (error) {
    throw new ListenError(classifyError(error), error);
  }

  const context = new AudioContext({ latencyHint: "interactive" });
  try {
    const channelCount = Math.max(1, stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1);
    await context.audioWorklet.addModule(processorUrl);
    const processorOptions: WorkletOptions = {
      a4: options.a4,
      minFrequency: options.minFrequency,
      channel: options.channel ?? 0,
    };
    const node = new AudioWorkletNode(context, "fretbook-pitch", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount,
      channelCountMode: "explicit",
      channelInterpretation: "discrete",
      processorOptions,
    } as AudioWorkletNodeOptions);
    node.port.onmessage = (message: MessageEvent<WorkletMessage>) => {
      if (message.data.type === "pitch") options.onPitch(message.data.event);
      else if (message.data.type === "chroma") options.onChroma?.(message.data.event);
      else options.onLevel?.({ rms: message.data.rms, peak: message.data.peak });
    };
    const source = context.createMediaStreamSource(stream);
    source.connect(node);
    if (context.state === "suspended") await context.resume();

    const send = (command: WorkletCommand) => node.port.postMessage(command);
    return {
      sampleRate: context.sampleRate,
      channelCount,
      setChannel: (index) => send({ type: "channel", index }),
      setExpectedMidi: (midi) => send({ type: "expected", midi }),
      setChroma: (on) => send({ type: "chroma", on }),
      async stop() {
        source.disconnect();
        node.port.onmessage = null;
        node.disconnect();
        for (const track of stream.getTracks()) track.stop();
        await context.close();
      },
    };
  } catch (error) {
    for (const track of stream.getTracks()) track.stop();
    await context.close().catch(() => undefined);
    throw error instanceof ListenError ? error : new ListenError("other", error);
  }
}
