import { Injectable, signal } from '@angular/core';

const FRAME_INTERVAL_MS = 1000;
const FRAME_WIDTH = 320;
const JPEG_QUALITY = 0.6;
const DATA_URL_PREFIX = 'data:image/jpeg;base64,';

/**
 * Captures the camera and delivers one small JPEG frame a second, base64 encoded. The
 * stream is exposed so the page can show a self-view from the same source.
 */
@Injectable()
export class CameraCapture {
  private readonly source = signal<MediaStream | null>(null);
  private video: HTMLVideoElement | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  /** The live camera stream, or null while the camera is off. */
  readonly stream = this.source.asReadonly();

  /** Asks for the camera and starts delivering frames. Rejects if access is refused. */
  async start(onFrame: (jpegBase64: string) => void): Promise<void> {
    this.stop();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    });
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    this.video = video;
    this.source.set(stream);
    try {
      await video.play();
    } catch (cause) {
      this.stop();
      throw cause;
    }

    const canvas = document.createElement('canvas');
    this.timer = setInterval(() => {
      if (video.videoWidth === 0) return;
      canvas.width = FRAME_WIDTH;
      canvas.height = Math.round((video.videoHeight / video.videoWidth) * FRAME_WIDTH);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      if (dataUrl.startsWith(DATA_URL_PREFIX)) onFrame(dataUrl.slice(DATA_URL_PREFIX.length));
    }, FRAME_INTERVAL_MS);
  }

  /** Stops capturing and releases the camera. Safe to call at any time. */
  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.source()
      ?.getTracks()
      .forEach((track) => track.stop());
    this.source.set(null);
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
  }
}
