# Modality research: transcript, audio, video

Experiments against the Gemini Decisions API (`gemini-decision-1`) that test what audio and video add to transcript-based scoring.
The findings are in [`NOTES.md`](NOTES.md). This file says how to re-run them.

Everything here is standalone: plain Node scripts using `fetch`, no workspace imports, no build step.

## Requirements

- Node.js 22 or newer.
- `GEMINI_API_KEY` in the environment. The scripts read it from the environment only and never write or print it.
- `ffmpeg` and `ffprobe` on `PATH` for scripts 08 to 11.
- Python 3 for the optional RAVDESS download.

Every run makes billable requests. The whole set is roughly 400 Decisions requests, 25 speech clips and 6 images.

## Run

From this folder:

```bash
export GEMINI_API_KEY=...          # or load it from your shell profile

# Synthetic media. Skipped if the files already exist in media/.
node 01-generate-speech.mjs        # 13 TTS clips
node 05-build-call.mjs             # the 12-turn call recording and call.json
node 09-generate-frames.mjs        # 6 webcam-style frames

# Experiments that need only the synthetic media.
node 02-voice-vs-words.mjs
node 03-stimulus-check.mjs
node 06-audio-vs-transcript.mjs
node 11-followups.mjs
node 12-token-accounting.mjs
```

Scripts 04 and 07, and parts of 08 and 10, use acted human recordings from RAVDESS.
RAVDESS is licensed CC BY-NC-SA 4.0 and is **not** stored in this repository.
Fetch the 20 clips used here (about 24 MB) to a folder outside the repo, then point the scripts at it:

```bash
python3 -I fetch-ravdess.py /path/outside/the/repo/ravdess
export RAVDESS_DIR=/path/outside/the/repo/ravdess

node 04-ravdess-voice.mjs
node 07-clip-addressing.mjs
node 08-audio-mechanics.mjs        # the telephone-band section needs RAVDESS_DIR; the rest does not
node 10-frames-and-video.mjs       # parts C and D (real faces, video blocks) need RAVDESS_DIR
```

`fetch-ravdess.py` reads individual files out of the remote zip archives with HTTP range requests, so it does not download the multi-gigabyte archives.

Each script prints a summary table and writes its raw answers, token usage and timings to `results/<script-name>.json`.
Media payloads are never written into the results; they are referenced by file name.

## What is where

| Path | Contents |
| --- | --- |
| `NOTES.md` | Findings, tables, cost model and recommendations |
| `lib.mjs` | Shared helpers and the question text copied from the project's scorecard |
| `01` to `12` `*.mjs` | One script per experiment or media set; the header comment in each says what it tests |
| `fetch-ravdess.py` | Downloads the RAVDESS clips |
| `results/` | Raw results from the runs of 2026-11-11 |
| `media/` | Generated speech (16 kHz WAV), the call recording with `call.json`, and six frames. All synthetic and fictional |

## Notes on re-running

- The Decisions API returned identical answers on repeated identical requests in these runs, so results should reproduce closely while the model version is unchanged. Latency will differ.
- The synthetic media is generated, so deleting `media/` and regenerating gives new clips and frames with different content; numbers that depend on them will move. Keep `media/` to reproduce the tables in the notes.
- The speech model rejected a non-default `sample_rate` on 2026-11-11, so clips are generated at 24 kHz and resampled to 16 kHz by `lib.mjs`.
- The question wording in `lib.mjs` is a copy of the project's scorecard and sentiment levels as of 2026-11-11. If those change, update the copy before comparing results.
