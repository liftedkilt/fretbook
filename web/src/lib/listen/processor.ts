// Runs inside the AudioWorkletGlobalScope: no DOM, no imports from the app beyond pure DSP.
import { PitchEngine } from "./engine";
import type { WorkletCommand, WorkletMessage, WorkletOptions } from "./messages";

// The worklet scope is not in TypeScript's DOM lib.
declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: unknown);
}
declare function registerProcessor(name: string, processor: unknown): void;

/** How often the level meter is refreshed, in seconds. */
const LEVEL_INTERVAL = 0.05;

class PitchProcessor extends AudioWorkletProcessor {
  private readonly engine: PitchEngine;
  private channel: number;
  private lastLevel = 0;

  constructor(options?: { processorOptions?: WorkletOptions }) {
    super(options);
    const config = options?.processorOptions ?? {};
    this.channel = config.channel ?? 0;
    this.engine = new PitchEngine({ sampleRate, a4: config.a4, minFrequency: config.minFrequency });
    this.port.onmessage = (message: MessageEvent<WorkletCommand>) => {
      if (message.data.type === "expected") this.engine.setExpectedMidi(message.data.midi);
      else if (message.data.type === "channel") this.channel = message.data.index;
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const samples = channels[Math.min(this.channel, channels.length - 1)];
    for (const event of this.engine.process(samples, currentTime)) {
      this.post({ type: "pitch", event });
    }
    if (currentTime - this.lastLevel >= LEVEL_INTERVAL) {
      this.lastLevel = currentTime;
      this.post({ type: "level", ...this.engine.takeLevel() });
    }
    return true;
  }

  private post(message: WorkletMessage): void {
    this.port.postMessage(message);
  }
}

registerProcessor("fretbook-pitch", PitchProcessor);
