import { Injectable } from '@angular/core';
import { LinearResampler, MIC_SAMPLE_RATE, floatToPcm16 } from './pcm';

const WORKLET_URL = 'pcm-capture-worklet.js';

/**
 * Captures the microphone as 16 kHz mono PCM16, in chunks of about 100 ms.
 *
 * The audio context is asked for 16 kHz so the browser does the resampling. Where the
 * browser gives a different rate anyway, the chunks are resampled here.
 */
@Injectable()
export class MicCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;

  get active(): boolean {
    return this.stream !== null;
  }

  /** Asks for the microphone and starts delivering chunks. Rejects if access is refused. */
  async start(onChunk: (pcm: Int16Array) => void): Promise<void> {
    this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.stream = stream;
    try {
      const context = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
      this.context = context;
      await context.audioWorklet.addModule(WORKLET_URL);
      // Stopped while the worklet was loading: nothing more to set up.
      if (this.context !== context) return;

      const resampler =
        context.sampleRate === MIC_SAMPLE_RATE
          ? null
          : new LinearResampler(context.sampleRate, MIC_SAMPLE_RATE);
      const node = new AudioWorkletNode(context, 'pcm-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
      });
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const samples = resampler ? resampler.process(event.data) : event.data;
        if (samples.length > 0) onChunk(floatToPcm16(samples));
      };
      context.createMediaStreamSource(stream).connect(node);
      this.node = node;
    } catch (cause) {
      this.stop();
      throw cause;
    }
  }

  /** Stops capturing and releases the microphone. Safe to call at any time. */
  stop(): void {
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.disconnect();
      this.node = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
