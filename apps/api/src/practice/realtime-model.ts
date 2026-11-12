// The contract a real-time voice model has to meet to play the customer in a practice
// call. Nothing outside this folder knows which vendor is behind it: the gateway talks
// to this interface, and the model's transcripts enter scoring as ordinary stream turns.

export interface RealtimeEvents {
  // The session is configured and audio may be sent.
  onReady(): void;
  // A chunk of the model's speech: PCM16, 24 kHz, mono.
  onAudio(pcm: Buffer): void;
  // Fragments of what the human said, as the model's transcription produces them.
  onInputTranscript(text: string): void;
  // Fragments of what the model is saying.
  onOutputTranscript(text: string): void;
  // The human started or stopped speaking, at this offset (in seconds) into the audio
  // sent so far. Used to cut the human's turn out of the continuous microphone stream.
  onInputActivity(kind: 'start' | 'end', offsetSeconds: number): void;
  // The model has finished saying its turn (its words are complete).
  onTurnComplete(): void;
  // The human spoke over the model: anything still queued for playback is stale.
  onInterrupted(): void;
  onError(message: string): void;
  onClose(): void;
}

export interface RealtimeSession {
  // Microphone audio: PCM16, 16 kHz, mono.
  sendAudio(pcm: Buffer): void;
  // Ends the session and releases the connection.
  close(): void;
}

export interface RealtimeConnectOptions {
  // Who the model is in this call and how it should behave.
  readonly systemInstruction: string;
}

export interface RealtimeModel {
  // The model's public identifier, shown in the web app.
  readonly model: string;
  // The environment variable holding its credential, named when it is missing.
  readonly envVar: string;
  // Whether the server has what it needs to open a session.
  isAvailable(): boolean;
  connect(options: RealtimeConnectOptions, events: RealtimeEvents): RealtimeSession;
}

// Injection token for the RealtimeModel implementation.
export const REALTIME = Symbol('REALTIME');
