import { afterEach, describe, expect, it, vi } from "vitest";

import {
  audioConstraints,
  checkAvailable,
  classifyError,
  describeProblem,
  listInputDevices,
  meterPosition,
  startListening,
  ListenError,
} from "./input";

vi.mock("./processor?worker&url", () => ({ default: "/processor.js" }));

afterEach(() => vi.unstubAllGlobals());

describe("availability", () => {
  it("explains a page that is not secure or has no media devices", () => {
    expect(checkAvailable({ isSecureContext: false, mediaDevices: {} })).toBe("insecure");
    expect(checkAvailable({ isSecureContext: true, mediaDevices: undefined })).toBe("unsupported");
    expect(checkAvailable({ isSecureContext: true, mediaDevices: {} })).toBeNull();
  });

  it("has a message for every problem", () => {
    const problems = ["insecure", "unsupported", "denied", "noDevice", "busy", "other"] as const;
    const messages = problems.map(describeProblem);
    expect(new Set(messages).size).toBe(problems.length);
    expect(messages[0]).toContain("HTTPS");
    for (const message of messages) expect(message).not.toMatch(/^listen\./);
  });
});

describe("classifyError", () => {
  it("maps browser errors to problems", () => {
    const named = (name: string) => Object.assign(new Error("x"), { name });
    expect(classifyError(named("NotAllowedError"))).toBe("denied");
    expect(classifyError(named("NotFoundError"))).toBe("noDevice");
    expect(classifyError(named("OverconstrainedError"))).toBe("noDevice");
    expect(classifyError(named("NotReadableError"))).toBe("busy");
    expect(classifyError(named("TypeError"))).toBe("other");
    expect(classifyError("nope")).toBe("other");
  });
});

describe("audioConstraints", () => {
  it("turns off the processing that damages instrument sound", () => {
    const constraints = audioConstraints("abc");
    expect(constraints.echoCancellation).toBe(false);
    expect(constraints.noiseSuppression).toBe(false);
    expect(constraints.autoGainControl).toBe(false);
    expect(constraints.deviceId).toEqual({ exact: "abc" });
    expect(audioConstraints().deviceId).toBeUndefined();
  });
});

describe("meterPosition", () => {
  it("is logarithmic between -60 dBFS and full scale", () => {
    expect(meterPosition(0)).toBe(0);
    expect(meterPosition(0.001)).toBe(0);
    expect(meterPosition(1)).toBe(1);
    expect(meterPosition(2)).toBe(1);
    expect(meterPosition(0.1)).toBeCloseTo(40 / 60);
  });
});

describe("devices", () => {
  it("lists only audio inputs", async () => {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        enumerateDevices: async () => [
          { kind: "audioinput", deviceId: "a", label: "Scarlett 2i2" },
          { kind: "videoinput", deviceId: "v", label: "Cam" },
          { kind: "audiooutput", deviceId: "o", label: "Speakers" },
        ],
      },
    });
    expect(await listInputDevices()).toEqual([{ deviceId: "a", label: "Scarlett 2i2" }]);
  });

  it("returns an empty list without the API", async () => {
    vi.stubGlobal("navigator", {});
    expect(await listInputDevices()).toEqual([]);
  });
});

describe("startListening", () => {
  it("fails with an explanation on insecure pages", async () => {
    vi.stubGlobal("isSecureContext", false);
    vi.stubGlobal("navigator", { mediaDevices: {} });
    await expect(startListening({ onPitch: () => {} })).rejects.toMatchObject({
      problem: "insecure",
    });
  });

  it("maps a refused permission prompt", async () => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => {
          throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
        },
      },
    });
    const error = await startListening({ onPitch: () => {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ListenError);
    expect((error as ListenError).problem).toBe("denied");
  });

  it("wires the worklet, forwards messages, and tears everything down", async () => {
    const track = { stop: vi.fn(), getSettings: () => ({ channelCount: 2 }) };
    const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const port = { onmessage: null as ((m: unknown) => void) | null, postMessage: vi.fn() };
    const nodeOptions: unknown[] = [];
    class FakeNode {
      port = port;
      disconnect = vi.fn();
      constructor(_context: unknown, _name: string, options: unknown) {
        nodeOptions.push(options);
      }
    }
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const close = vi.fn(async () => {});
    class FakeContext {
      sampleRate = 48000;
      state = "suspended";
      audioWorklet = { addModule: vi.fn(async () => {}) };
      createMediaStreamSource = () => source;
      resume = vi.fn(async () => {});
      close = close;
    }
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("AudioWorkletNode", FakeNode);

    const onPitch = vi.fn();
    const onChroma = vi.fn();
    const onLevel = vi.fn();
    const session = await startListening({ deviceId: "d", channel: 1, onPitch, onChroma, onLevel });
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ echoCancellation: false }),
    });
    expect(session.channelCount).toBe(2);
    expect(session.sampleRate).toBe(48000);
    expect(nodeOptions[0]).toMatchObject({
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "discrete",
      processorOptions: { channel: 1 },
    });

    port.onmessage?.({ data: { type: "level", rms: 0.1, peak: 0.2 } });
    expect(onLevel).toHaveBeenCalledWith({ rms: 0.1, peak: 0.2 });
    const event = {
      time: 1,
      frequency: 41,
      clarity: 1,
      midi: 28,
      cents: 0,
      onset: true,
      onsetTime: 1,
    };
    port.onmessage?.({ data: { type: "pitch", event } });
    expect(onPitch).toHaveBeenCalledWith(event);

    const reading = {
      time: 1,
      bins: new Array(12).fill(0),
      span: 0.17,
      onset: false,
      onsetTime: null,
    };
    port.onmessage?.({ data: { type: "chroma", event: reading } });
    expect(onChroma).toHaveBeenCalledWith(reading);

    session.setChannel(0);
    session.setExpectedMidi(28);
    session.setChroma(true);
    expect(port.postMessage).toHaveBeenCalledWith({ type: "chroma", on: true });
    expect(port.postMessage).toHaveBeenCalledWith({ type: "channel", index: 0 });
    expect(port.postMessage).toHaveBeenCalledWith({ type: "expected", midi: 28 });

    await session.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it("releases the microphone when the worklet fails to load", async () => {
    const track = { stop: vi.fn(), getSettings: () => ({}) };
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: async () => ({ getAudioTracks: () => [track], getTracks: () => [track] }),
      },
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        audioWorklet = {
          addModule: async () => {
            throw new Error("boom");
          },
        };
        close = async () => {};
      },
    );
    await expect(startListening({ onPitch: () => {} })).rejects.toMatchObject({ problem: "other" });
    expect(track.stop).toHaveBeenCalled();
  });
});
