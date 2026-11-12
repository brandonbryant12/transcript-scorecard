# Transcript, audio and video: what each one adds to scoring

Research notes from live runs against the Gemini Decisions API (`gemini-decision-1`) on 2026-11-11.
Scripts are in this folder, raw answers are in `results/`, and generated media is in `media/`.
See `README.md` for how to re-run.

Every claim below is tagged with where it comes from:

- **[measured]** observed in these runs (script and result file named);
- **[documented]** stated in Google's docs, not re-tested here;
- **[inferred]** reasoning from measured or documented facts;
- **[main thread]** observed by the main project thread in a real practice call, not by these scripts.

## 1. Answers first

**With audio, is the transcript still needed? Yes.**
A recording can stand in for the transcript on content questions (26 of 29 turn-level cells correct by time range, the same as the transcript's 26 of 29), but it costs about 6 times the tokens (2,010 audio tokens against 318 text tokens for the same 67-second call), takes about 2.6 times as long (1.2 s against 0.46 s), leaks answers between turns (mean probability on false cells 0.19 against 0.04), and can only point at a turn by time range, which you get from a transcript or diarisation anyway.
Latency also grows with the recording (about 10 ms per second of audio), so re-sending a growing recording is a real-time problem before it is a cost problem.

**With video, are the audio and the transcript still needed? The transcript yes; a separate audio clip no, if the video carries its sound track.**
A `video` block is read at one frame per second (66 tokens per frame at low resolution) and its sound is heard (a spoken sentence recognised at P 0.69 to 0.90 at low resolution, voice emotion recognised).
So one short video clip per turn can replace a separate audio clip plus frames.
It cannot replace the transcript, for the same reasons audio cannot, at about 20 times the transcript's token rate (96 tokens per second against 4.7).

**When is each channel worth its cost?**

| Channel | What it adds that the others cannot | Measured strength of the signal | Worth it when |
| --- | --- | --- | --- |
| Transcript | What was said, by whom, in a form a question can address and a coach can quote | Baseline for every content question | Always |
| Audio | How it sounded | Real acted speech, same neutral words: sentiment 0.89 for angry against 1.95 for neutral; P(irritated) 0.72 against 0.25 | The speakers are real people. On synthetic voices it mostly repeats the words |
| Video | Attention, gaze, posture, facial expression | Single frame: presence 0.7 to 1.0 for slumped or on a phone against 2.5 to 3.6 for attentive or engaged; P(looks away) 0.78 to 0.86 against 0.13 to 0.14 | The employee is on camera and presence is part of the job |

**What contradicted the plan the media lane was built on**

1. Audio is billed at **30 tokens per second**, not the documented 25.
2. Putting the turn's transcript next to its audio clip **suppresses the voice signal**: P(irritated) for an angry clip fell from 0.79 to 0.31. The media lane currently does this.
3. A `video` block costs **66 tokens per frame**; an image block at low resolution costs **264**. Frames sent as images are four times dearer per frame than the same frames inside a video clip.
4. A yes/no question over several frames **dilutes a brief behaviour**: looking away in 2 of 6 frames scored 0.33, below the 0.6 detection threshold. Asked frame by frame it scored 0.87 and 0.89.
5. The model **never says "nothing there"**: three seconds of silence returned a normal-looking rating, and a muted video still returned a confident "voice" emotion read from the face.
6. Synthetic voices are a weak test of the audio channel: a TTS model asked to speak polite words furiously produced a cheerful clip, according to two different listening models.

The one-clip-per-request choice held up: several clips in one request can be addressed by label, but neighbouring clips colour each other.

## 2. Scope and method

- Model under test: `gemini-decision-1` through `POST /v1beta/decisions`. Questions are yes/no (`noul`), pick-one (`choice`) and ordered rubric (`score`), answered independently against shared input.
- The API was deterministic in these runs: 108 of 108 question groups returned identical values across three repeats (`02-voice-vs-words.mjs`). Later experiments therefore ask each question once. **[measured]**
- Stimuli:
  - Synthetic speech from `gemini-3.8-flash-tts` with a style instruction per clip (`media/*.wav`, 16 kHz mono).
  - Acted human speech and video from RAVDESS (Livingstone and Russo, 2018, CC BY-NC-SA 4.0): two actors, eight emotions, every clip the sentence "Kids are talking by the door", so only the voice and face differ. These files are fetched to a folder outside the repository and are not stored here.
  - Synthetic webcam frames from `gemini-nano-banana-2.1`: one fictional agent in six states, generated as edits of one base image so only the behaviour changes (`media/frame_*.jpg`). I viewed the six frames and they show what was asked.
  - A 67-second, 12-turn, two-voice call assembled from TTS with known turn boundaries (`media/call.wav`, `media/call.json`).
- Question wording is copied from the project's scorecard (`vocal_delivery`, `visual_presence`), its sentiment levels, and the media lane (`planMediaRequests`), so results apply to the questions the project asks.
- Spend: roughly 400 Decisions requests plus 25 speech clips and 6 images.

## 3. What each modality carries and misses

### Transcript (verbal)

Carries the content: what was promised, asked, verified, refused.
It is the only form in which one turn has a stable label that a question can point at and a coach can quote.

Misses how things were said.
Text alone gave the same answer for every delivery of the same sentence, as it must: "Fine. I'll wait for the email then." read as 1.20 on the 0 to 4 sentiment scale whatever the voice; "Kids are talking by the door." read as 1.76. **[measured, `02`, `04`]**
It also misses everything visible.

### Audio (vocal)

Carries prosody.
On acted human speech with identical neutral words (`04-ravdess-voice.mjs`), audio alone separated the emotions:

| Acted emotion (2 actors) | Voice sentiment (0 to 4) | P(irritated tone) | Vocal delivery (0 to 4) |
| --- | --- | --- | --- |
| neutral | 1.95 | 0.25 | 2.38 |
| calm | 1.92 | 0.22 | 2.49 |
| happy | 1.75 (one actor read as angry: 0.99; the other 2.50) | 0.46 | 1.98 |
| sad | 1.60 | 0.28 | 2.24 |
| surprised | 1.70 | 0.33 | 2.33 |
| angry | 0.89 | 0.72 | 0.82 |
| fearful | 0.87 | 0.58 | 1.49 |
| disgust | 1.07 | 0.71 | 1.24 |

Text-only baseline for the same sentence: 1.76. **[measured]**

Audio also carries the words: the model recognised a quoted phrase in a clip at P 0.76 to 0.88 across formats, against 0.07 to 0.28 for a phrase that was not said. **[measured, `08`]**

Misses:

- A stable way to address a turn. Time ranges work roughly; counting turns does not (section 5.3).
- Fine emotion categories. Eight-way recognition of the acted emotion was 7 of 16 for the decision model and 7 of 16 for a general model (`gemini-3.8-flash`) on the same clips. Chance is 2 of 16. Negative and aroused voices (angry, fearful, disgust) are found reliably; calm against neutral, and happy against angry for one actor, are not. **[measured]**
- Anything visible.

Fear sounds "irritated" to the behaviour question: P(irritated) was 0.46 to 0.73 for fearful clips. An anxious speaker can trip a behaviour written for an impatient one. **[measured]**

### Video and frames (visual)

Carries attention, gaze, posture and expression, none of which are in the sound or the words:

| Synthetic frame (one frame, low resolution) | Presence (0 to 4) | P(faces camera) | P(looks away) |
| --- | --- | --- | --- |
| attentive, facing camera | 2.50 | 0.87 | 0.14 |
| smiling and nodding | 3.29 | 0.87 | 0.13 |
| facing camera, blank expression | 2.23 | 0.86 | 0.14 |
| head turned to a second screen | 1.51 | 0.12 | 0.78 |
| looking down at a phone | 0.97 | 0.17 | 0.82 |
| slumped, head on hand | 0.69 | 0.19 | 0.86 |

**[measured, `10` part A]**

On real faces (three frames from each RAVDESS video, low resolution) the face emotion was read correctly in 4 of 4 clips: neutral 0.64, happy 0.90, sad 0.45, angry 0.78. **[measured, `10` part C]**

The face corrected the voice once: for the actor whose happy voice was read as angry, text plus audio gave sentiment 1.97, frames alone 3.25, and everything together 3.11. **[measured, `10` fused]**

Misses the words and the sound, unless the frames arrive inside a video block with a sound track.
Expression also bleeds into the presence rating: a sad or angry face facing the camera rated 2.05 and 2.21 on presence, against 2.77 for neutral and 3.70 for happy. Presence as written rewards a pleasant expression, not only attention. **[measured]**

## 4. API mechanics per modality

Endpoint, auth and question shapes are as in the project's Gemini adapter. Input is a string, or an array of content blocks.

### 4.1 Text

- Block: `{ "type": "text", "text": "..." }`, or a bare string as the whole input.
- Token accounting **[measured, `12-token-accounting.mjs`]**:

| Request | Text tokens | Latency (3 runs) |
| --- | --- | --- |
| one-character input, 1 yes/no question | 131 | 503 / 276 / 325 ms |
| 12-turn transcript, 1 yes/no | 449 | 287 / 251 / 275 ms |
| transcript, 10 yes/no | 1,232 | 289 / 328 / 370 ms |
| transcript, 100 yes/no | 9,062 | 536 / 397 / 403 ms |
| transcript, 300 yes/no | 26,462 | 826 / 749 / 812 ms |
| transcript, 1 five-level rubric | 495 | 280 / 384 / 299 ms |
| transcript, 10 five-level rubrics | 1,692 | 317 / 304 / 280 ms |

  - The transcript of the 67-second call costs **318 tokens**, about **4.7 tokens per second of conversation**, and is billed once per request however many questions follow.
  - Each further yes/no question of this length costs about **87 tokens**; each further five-level rubric about **133**. Questions, not the transcript, dominate a text request.
  - Latency is flat to about 100 questions (0.3 to 0.5 s) and reaches 0.8 s at 300.

### 4.2 Audio

- Block: `{ "type": "audio", "data": "<base64>", "mime_type": "audio/wav" }`.
- **Tokens: 30.0 per second**, exactly, from 5 s to 536 s (`08`). Short clips come out slightly higher (3.08 s gave 97 tokens), about 4 tokens of fixed overhead per clip. The docs say 25 per second. **[measured vs documented]**
- Tokens depend only on duration, not on encoding, sample rate or bitrate: the same 4.56 s clip was 139 tokens as 16 kHz WAV, 8 kHz WAV, mu-law, MP3, Opus and FLAC, and 141 to 142 as AAC. **[measured]**
- Accepted encodings **[measured, `08-audio-mechanics.mjs`]**:

| `mime_type` | Content | Bytes | Result |
| --- | --- | --- | --- |
| `audio/wav` | 16 kHz 16-bit mono | 145,964 | OK |
| `audio/wav` | 8 kHz 16-bit mono | 73,004 | OK |
| `audio/wav` | 8 kHz mu-law (telephony) | 36,572 | OK |
| `audio/l16` | raw PCM, no rate | 145,920 | HTTP 400: "Rate is required for TYPE_L16 audio." |
| `audio/l16;rate=16000` | raw PCM | 145,920 | OK |
| `audio/pcm;rate=16000` | raw PCM (the Live API's MIME string) | 145,920 | OK |
| `audio/mp3`, `audio/mpeg` | MP3 32 kbps | 18,800 | OK |
| `audio/m4a`, `audio/aac` | AAC 32 kbps | about 20,000 | OK |
| `audio/ogg`, `audio/webm` | Opus 24 kbps (WebM is the browser `MediaRecorder` default) | about 14,000 | OK |
| `audio/flac` | FLAC | 91,568 | OK |
| `application/octet-stream` | WAV bytes | | HTTP 400: "Unsupported mime_type ... Only audio/* MIME types are supported." |
| `audio/mp3` | WAV bytes, wrong label | | OK: the content is sniffed, the label is not enforced within `audio/*` |

  Answers were essentially the same across encodings (P(heard the phrase) 0.76 to 0.88). Opus or MP3 cuts the upload by about 10 times at no token or quality cost seen here.
- **Latency grows with duration** **[measured]**:

| Recording | Bytes (WAV) | Audio tokens | Latency, 3 runs |
| --- | --- | --- | --- |
| 5 s | 156 KB | 150 | 524 / 354 / 348 ms |
| 15 s | 469 KB | 450 | 570 / 592 / 836 ms |
| 30 s | 938 KB | 900 | 803 / 588 / 611 ms |
| 67 s | 2.1 MB | 2,010 | 1,132 / 1,328 / 1,513 ms |
| 134 s | 4.2 MB | 4,020 | 1,842 / 1,587 / 1,728 ms |
| 268 s | 8.4 MB | 8,040 | 3,083 / 2,834 / 3,041 ms |
| 536 s | 16.8 MB | 16,080 | 5,773 / 5,739 / 6,414 ms |

  Roughly 0.4 s plus 10.5 ms per second of audio, from one machine over the public internet with uncompressed WAV. Part of this is upload size; compressed audio was not timed at these lengths.
- Limits **[documented]**: 100 MB inline per request, 262,144 tokens of context. At 30 tokens per second the context alone caps a request near 2.4 hours of audio. **[inferred]**
- Telephone-band audio keeps the voice signal **[measured]**: on acted speech, P(irritated) for one angry clip was 0.84 at 16 kHz, 0.87 at 8 kHz and 0.84 as 8 kHz mu-law; neutral clips stayed at 0.24 to 0.27 in all three. One fearful clip dropped from 0.46 to 0.24 at 8 kHz and returned to 0.48 as mu-law, so expect noise at the margin.
- Degenerate input **[measured]**:

| Clip | Result |
| --- | --- |
| 3 s of digital silence | HTTP 200. P(a person is speaking) 0.35, delivery 2.43 with a flat distribution, P(irritated) 0.22 |
| 0.25 s of speech | HTTP 200. Almost identical: 0.35, 2.31, 0.20 |
| 0.05 s of speech | HTTP 200. 0.33, 2.49, 0.22 |
| WAV header with no samples | HTTP 400: "input[0]: audio/wav content could not be decoded (malformed data)" |

  With nothing to hear, the model returns its prior, which looks like a "Neutral" delivery. The answer does not signal emptiness; even "can a person be heard speaking?" only fell to 0.35. Empty or tiny clips must be filtered in code.

### 4.3 Images

- Block: `{ "type": "image", "data": "<base64>", "mime_type": "image/jpeg", "resolution": "low" }`.
- Tokens per image by setting **[measured, `10` part A, `11` part 2]**, with the documented figure in brackets:

| `resolution` | Tokens per image |
| --- | --- |
| `low` | 264 (280) |
| `medium` | 527 (560) |
| `high` | 1,100 (1,120) |
| not set | 1,100, the same as `high` |
| `ultra_high` | 2,205 (2,240) |

- Tokens do **not** depend on pixel size: a 160x90 frame and a 1920x1080 frame both cost 264 at `low`. The setting alone decides. **[measured]**
- `low` is enough for presence and gaze. Across the six frames, `low` and `high` agreed within 0.35 on the presence rubric and 0.07 on the yes/no behaviours. `ultra_high` was no better and slower (0.8 to 1.35 s). **[measured]**
- Pixel size barely matters for the answer down to 320x180 (P(looks away) 0.85); at 160x90 it slipped to 0.74. 640x360 JPEG at about 14 KB is a sensible capture size. **[measured]**
- Latency for a single-image request varied from 270 ms to 950 ms with no clear relation to the setting.

### 4.4 Video

- Block: `{ "type": "video", "data": "<base64>", "mime_type": "video/mp4", "resolution": "low" }`. `video/webm` (VP9) was also accepted. **[measured, `11` part 4]**
- Sampled at **one frame per second** **[measured: 3.31 s gave 3 frames, 3.69 to 4.12 s gave 4, a 6 s clip built with a held last frame gave 7]**.
- **66 tokens per frame** at `low`, `medium` and unset (documented: 70); **264 per frame** at `high` (documented: 280). Reported under the `image` modality in `usage`. **[measured]**
- The sound track is heard and billed as audio at about 30 tokens per second. A muted file is still billed about 5 audio tokens per second (15 to 20 tokens for a 3 to 4 s silent clip, 35 for 7 s). **[measured]**
- File resolution does not change tokens (720p and 360p both gave 198 image tokens) but it changes latency: the 3.4 to 5.2 MB originals took 1.9 to 2.8 s, the same clips at 360p (about 150 KB) took 0.6 to 0.8 s. Downscale before sending. **[measured, `10` part D]**
- Limits **[documented]**: no YouTube or `gs://` URLs; media by Files API URI, public or signed HTTPS URL (15 MB), or inline bytes.

### 4.5 Errors met

All had the shape `{ "error": { "message": "...", "code": "invalid_request" } }` with HTTP 400:
the three audio errors in the table above, and the TTS model rejecting any `sample_rate` other than its default (the speech docs list 16000 and 8000 as options; `gemini-3.8-flash-tts` returned "Request contains an invalid argument" for both).
No safety block was met.

### 4.6 Gemini Live, for the practice call **[main thread]**

The Live WebSocket rejects `responseModalities` at the top level of `setup` (close code 1007, "Unknown name"); it must sit under `generationConfig`. The WebSocket quickstart page shows it at the top level; the API reference table is the correct one.

## 5. Experiments

### 5.1 Synthetic voice against words (`02-voice-vs-words.mjs`, `03-stimulus-check.mjs`)

**Setup.** Thirteen TTS clips: one neutral customer sentence in five deliveries (set A), four clips where words and requested delivery conflict or agree (set B), and one employee sentence in four deliveries (set C). Each judged from text only, audio only, and text plus audio.

**Wording.**
Text: "How does the CUSTOMER feel in this turn?"
Audio, project wording: "Listen to the attached audio clip of the CUSTOMER. Judging by the sound of their voice (tone, pace and emphasis) rather than the words, how does the customer feel?"
Audio, plain: "Listen to the attached audio clip of the CUSTOMER. How does the customer feel?"
Employee: the `vocal_delivery` rubric and its two behaviour statements with the media lane's lead-in.

**Results, customer sentiment (0 to 4).**

| Clip (requested delivery) | Text only | Audio only, voice wording | Text + audio, voice wording |
| --- | --- | --- | --- |
| A calm and warm | 1.20 | 1.35 | 1.05 |
| A flat | 1.20 | 1.50 | 1.02 |
| A irritated | 1.20 | 1.20 | 0.88 |
| A anxious | 1.20 | 1.21 | 0.92 |
| A relieved | 1.20 | 1.19 | 0.96 |
| B polite words, furious voice | 3.57 | 3.25 | 3.40 |
| B polite words, warm voice | 3.57 | 3.19 | 3.22 |
| B angry words, cheerful voice | 0.10 | 2.23 | 2.03 |
| B neutral words, panicked voice | 1.70 | 1.03 | 1.02 |

The plain wording gave nearly the same numbers as the voice wording (within 0.15), except for the cheerful-voice clip with text attached (1.24 plain against 2.03 voice-worded). Telling the model to judge the voice "rather than the words" matters only when the two disagree strongly.

**Results, employee delivery (rubric / P(calm pace) / P(irritated)).**

| Clip | Text only | Audio only | Text + audio |
| --- | --- | --- | --- |
| C warm and calm | 2.51 / 0.83 / 0.02 | 2.90 / 0.74 / 0.15 | 3.08 / 0.85 / 0.09 |
| C rushed | same | 2.65 / 0.49 / 0.16 | 2.68 / 0.46 / 0.14 |
| C irritated | same | 2.70 / 0.54 / 0.60 | 2.92 / 0.28 / 0.11 |
| C flat, as if reading | same | 2.60 / 0.81 / 0.41 | 2.65 / 0.79 / 0.14 |

**Stimulus check.** A general model described each clip's voice without being told the style. It heard all five set A clips as "irritated" or "resigned", the "furious" polite clip as "bright, upbeat ... cheerful", the "cheerful" angry-words clip as a "sarcastic, mocking chuckle", and the "irritated and condescending" employee clip as "warm, reassuring". Only pace (rushed against measured) and the plainly congruent clips came through as requested.

**What it shows.**

- The TTS model largely speaks the way the words read, whatever style is requested. These clips cannot test whether the decision model hears a voice that contradicts its words. This is why section 5.2 uses human recordings.
- Where the synthetic voice did differ audibly (pace, the panicked clip, the laughing clip), the audio answers moved: P(calm pace) 0.49 for rushed against 0.74 for calm; sentiment 1.03 for the panicked clip against 1.70 from its words.
- The yes/no behaviours moved more than the rubric. Delivery scores sat in a 2.6 to 2.9 band while P(irritated) ranged 0.15 to 0.60.
- Adding the transcript to the audio pulled the irritated employee clip's P(irritated) from 0.60 down to 0.11. This is the first sign of the effect measured properly in section 5.4.
- This bears directly on the practice-call demo, where the customer is a synthetic voice.

### 5.2 Acted human speech, neutral words (`04-ravdess-voice.mjs`)

**Setup.** Sixteen RAVDESS clips (two actors, eight emotions, strong intensity except neutral), all "Kids are talking by the door". Each judged from audio alone and again with the media lane's text context, including the sentence itself. A general model named the emotion as a second listener. Loudness (RMS) recorded as a sanity check: neutral and calm clips were -44 to -52 dBFS, angry -21 to -28 dBFS, so the clips do differ acoustically.

**Wording.** As in 5.1, plus: "Listen to the attached audio clip. Judging only by the sound of the voice, which emotion is the speaker expressing?" with the eight acted labels as options.

**Results per clip (audio only).**

| Actor | Emotion | Voice sentiment | Acted-emotion choice (confidence) | Delivery | P(calm pace) | P(irritated) | General model |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | neutral | 1.95 | neutral (0.30) | 2.43 | 0.61 | 0.24 | calm |
| 02 | neutral | 1.96 | happy (0.29) | 2.33 | 0.34 | 0.25 | neutral |
| 01 | calm | 1.88 | neutral (0.29) | 2.50 | 0.38 | 0.24 | neutral |
| 02 | calm | 1.96 | neutral (0.38) | 2.49 | 0.50 | 0.21 | calm |
| 01 | happy | 0.99 | angry (0.53) | 1.13 | 0.19 | 0.72 | calm |
| 02 | happy | 2.50 | happy (0.48) | 2.83 | 0.54 | 0.19 | happy |
| 01 | sad | 1.96 | neutral (0.31) | 2.41 | 0.45 | 0.24 | calm |
| 02 | sad | 1.24 | sad (0.52) | 2.07 | 0.27 | 0.31 | fearful |
| 01 | angry | 0.77 | angry (0.76) | 0.64 | 0.05 | 0.84 | angry |
| 02 | angry | 1.01 | angry (0.72) | 1.00 | 0.12 | 0.60 | happy |
| 01 | fearful | 0.77 | fearful (0.61) | 1.21 | 0.06 | 0.69 | fearful |
| 02 | fearful | 0.96 | sad (0.46) | 1.77 | 0.08 | 0.46 | fearful |
| 01 | disgust | 0.85 | angry (0.66) | 0.62 | 0.06 | 0.85 | angry |
| 02 | disgust | 1.28 | angry (0.28) | 1.86 | 0.20 | 0.57 | fearful |
| 01 | surprised | 1.97 | happy (0.26) | 2.52 | 0.52 | 0.28 | calm |
| 02 | surprised | 1.42 | surprised (0.42) | 2.13 | 0.26 | 0.37 | surprised |

Per-request cost: about 100 to 150 audio tokens and 450 to 580 ms for five questions.

**What it shows.**

- The decision model hears prosody. With the words held constant, angry, fearful and disgusted voices score about one full level below neutral on sentiment and 1 to 1.7 levels below on delivery.
- Valence is more reliable than category. Negative-aroused against neutral separates cleanly; the eight-way label is right 7 times in 16, the same as the general model.
- One clear failure: actor 01's "happy" clip is read as angry across every question (it is loud and emphatic: -39 dBFS against -48 for the same actor's neutral). High arousal is being taken for anger.
- `calm_pace` as written ("a calm, unhurried pace in a warm tone") reached at most 0.61 even for neutral and calm voices. At the project's 0.6 threshold this positive behaviour would be reported as missing on almost every turn of a perfectly calm speaker.

### 5.3 Can a recording replace the transcript? (`06-audio-vs-transcript.mjs`)

**Setup.** The 67-second call has a planted identity check (turn 3, confirmed in turn 5), an unverified account change (turn 7), an unsupported guarantee (turn 9) and an owned next step (turn 11). Five behaviours are asked of each of the six employee turns: 30 cells, one left out as arguable, 6 true and 23 false.

Conditions:

- **A** labelled transcript, the project's wording: "Focus on the single turn labelled [turn-7]; treat every other turn as context only. Is this statement true of that turn? Statement: ..."
- **B** whole recording plus one line naming the speakers, addressing a turn three ways:
  - time: "Focus on what the EMPLOYEE says between 0:25 and 0:32 of the attached recording; treat the rest as context only."
  - ordinal: "Focus on the fourth time the EMPLOYEE speaks in the attached recording (the EMPLOYEE speaks first, then the speakers alternate) ..."
  - quote: "Focus on the part of the attached recording where the EMPLOYEE says "Sure, I'll just add them to the..." ..."
- **C** transcript and recording together, addressed by label.
- **D** one clip per employee turn with no transcript: "Listen to the attached audio clip of the EMPLOYEE in a customer support call. Is this statement true of what they say in the clip?"

**Results.**

| Condition | Tokens (text + audio) | Latency | Correct at 0.6 | Mean P on true cells | Mean P on false cells | False positives | Security rubric (0 to 4) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A transcript | 3,317 + 0 | 461 ms | 26 / 29 | 0.63 | 0.04 | 0 | 1.36 |
| B recording, by time | 3,482 + 2,021 | 1,219 ms | 26 / 29 | 0.69 | 0.19 | 1 | 0.76 |
| B recording, by ordinal | 3,512 + 2,021 | 1,232 ms | 15 / 29 | 0.58 | 0.50 | 11 | 0.76 |
| B recording, by quote | 3,497 + 2,021 | 1,204 ms | 23 / 29 | 0.71 | 0.29 | 4 | 0.76 |
| C transcript + recording | 3,467 + 2,021 | 1,122 ms | 28 / 29 | 0.77 | 0.06 | 0 | 0.89 |
| D clip per turn, no transcript | 3,116 + 1,216 (6 requests) | 475 to 544 ms each | 25 / 29 | 0.41 | 0.15 | 0 | not asked |

The planted problems were found in every usable condition: unverified change at turn 7 and unsupported guarantee at turn 9. The misses in A are the identity check (0.54 and 0.12) and the acknowledgement (0.26), which are strict readings of the scorecard wording, not a modality effect.

**What it shows.**

- Audio carries the content well enough to answer the questions. It is not deaf to words.
- **Addressing is the problem.** By ordinal the model cannot find the turn and answers about the call as a whole (11 false positives). By quote it needs the words, which means you already have a transcript. By time range it works, with more leakage than labels (0.19 against 0.04 on false cells). Time ranges come from a transcript or a diariser.
- A clip per turn with no context is clean but loses recall (mean 0.41 on true cells): "Thanks, that matches" means nothing without the question it answers. Content questions need context; the transcript supplies it cheaply.
- Transcript plus recording was the best on this call (28 of 29) at 1.65 times the tokens and 2.4 times the latency. One call is too few to say the gain is real.
- Token comparison for the content itself: the transcript is 318 tokens, the recording 2,010 to 2,021. Questions add about 3,100 either way.

### 5.4 Per-turn clip against whole recording, several clips at once, and context (`07-clip-addressing.mjs`)

**Setup.** Six RAVDESS clips from one actor, each a different emotion and all the same sentence, so a question cannot find its clip by the words. Four ways to ask the voice questions:

- one clip per request (the reference);
- the six joined into one recording with 0.6 s gaps, addressed by time range;
- the same recording addressed by ordinal ("the third of the six utterances");
- six separate audio blocks in one request, each preceded by a text block "Clip A:", "Clip B:", addressed by label.

**Results, actor 02 (voice sentiment / P(irritated)).**

| Emotion | One clip per request | Whole, by time | Whole, by ordinal | Labelled clips, one request |
| --- | --- | --- | --- | --- |
| neutral | 1.99 / 0.23 | 1.80 / 0.13 | 1.88 / 0.15 | 1.92 / 0.13 |
| angry | 0.85 / 0.78 | 1.10 / 0.83 | 1.20 / 0.77 | 0.87 / 0.91 |
| calm | 1.84 / 0.13 | 1.76 / 0.16 | 1.77 / 0.20 | 1.91 / 0.13 |
| happy | 2.60 / 0.17 | 1.77 / 0.53 | 1.76 / 0.36 | 1.55 / 0.48 |
| fearful | 1.00 / 0.57 | 1.64 / 0.65 | 1.65 / 0.59 | 1.06 / 0.67 |
| sad | 1.10 / 0.34 | 1.52 / 0.39 | 1.69 / 0.26 | 1.50 / 0.27 |

Mean absolute difference from the per-clip reference, sentiment / P(irritated):

| | Whole, by time | Whole, by ordinal | Labelled clips |
| --- | --- | --- | --- |
| Actor 02 | 0.40 / 0.11 | 0.43 / 0.07 | 0.28 / 0.12 |
| Actor 01 | 0.31 / 0.08 | 0.29 / 0.11 | 0.15 / 0.05 |

Tokens were the same in every arrangement (about 1,530 text and 700 to 840 audio for 12 questions). One labelled request took about 630 ms; six separate requests took 330 to 580 ms each.

**What it shows.**

- Several clips can be addressed by a text label placed before each block. It works, and it is closer to the reference than a joined recording.
- It is not free. The clip that differs most from its neighbours gets pulled towards them: the happy clip, sitting after the angry one, lost a full level (2.60 to 1.55) and gained irritation (0.17 to 0.48). The whole recording shows the same pull more strongly, flattening every clip towards the middle.
- One clip per request is the faithful arrangement. The main thread's caution was justified. Labelled batching is a reasonable fallback if request count ever matters more than fidelity, since tokens are the same.

**Context framing.** The same clip, the same two voice questions, four framings of the text around it:

- `audio_only`: nothing but the clip;
- `lane_context`: what the media lane sends now: call header, recent transcript **including the clip's own words**, and "The attached audio clip is the turn labelled [turn-2], spoken by the CUSTOMER.";
- `prior_turns_only`: header and the employee's preceding turn (bad news about a technician visit), then "The attached audio clip is the CUSTOMER's reply to that turn.", without the customer's words;
- `speaker_only`: "The attached audio clip is one turn of a customer support call, spoken by the CUSTOMER."

Voice sentiment / P(irritated):

| Clip | audio_only | lane_context | prior_turns_only | speaker_only |
| --- | --- | --- | --- | --- |
| actor 01 neutral | 1.92 / 0.27 | 1.77 / 0.15 | 1.45 / 0.32 | 1.74 / 0.26 |
| actor 01 angry | 0.78 / 0.79 | 1.14 / 0.31 | 0.75 / 0.84 | 0.67 / 0.87 |
| actor 01 fearful | 0.75 / 0.67 | 1.21 / 0.18 | 0.98 / 0.50 | 0.76 / 0.58 |
| actor 01 happy (heard as angry) | 0.96 / 0.73 | 1.31 / 0.45 | 1.10 / 0.62 | 0.93 / 0.83 |
| actor 02 neutral | 1.98 / 0.23 | 1.76 / 0.13 | 1.60 / 0.13 | 1.76 / 0.12 |
| actor 02 angry | 0.97 / 0.76 | 1.04 / 0.68 | 0.79 / 0.90 | 0.67 / 0.88 |
| actor 02 fearful | 1.03 / 0.71 | 1.26 / 0.29 | 0.96 / 0.46 | 0.89 / 0.49 |
| actor 02 happy | 2.43 / 0.20 | 1.74 / 0.11 | 1.66 / 0.13 | 2.34 / 0.15 |

- **Showing the model the clip's own words damps the voice.** With the lane's context, P(irritated) on an angry voice fell from 0.79 to 0.31 for one actor and the fearful clips from about 0.7 to 0.2 to 0.3; the genuinely happy voice fell from 2.43 to 1.74. The neutral words pull every answer back towards neutral. The same thing appeared with RAVDESS in `04` (mean P(irritated) on angry clips 0.72 alone, 0.46 with text) and with TTS in `02`.
- **Earlier turns as context colour the answer by expectation.** After bad news, the neutral voice read 1.45 and the happy voice 1.66: the model answers partly what a customer would feel, not what this one sounds like.
- **A one-line speaker note costs nothing.** It tracks audio-only closely and was slightly sharper on the angry clips.

### 5.5 Frames per turn and wording (`10` part B, `11` part 1)

**Setup.** One six-second turn as six frames: attentive, attentive, looking at a second screen, looking at a second screen, attentive, smiling. Sampled as 1, 3 or 6 frames. Low resolution.

| Frames sent | Image tokens | Presence | P(faces camera) | P(looks away) |
| --- | --- | --- | --- | --- |
| 1 (first) | 264 | 2.44 | 0.88 | 0.14 |
| 1 (third) | 264 | 1.62 | 0.13 | 0.70 |
| 3 (1st, 3rd, 5th) | 792 | 2.08 | 0.32 | 0.37 |
| 3 (2nd, 4th, 6th) | 792 | 2.32 | 0.31 | 0.50 |
| 6 | 1,584 | 2.38 | 0.40 | 0.37 |
| 6, each frame labelled and asked separately | 1,584 | | | 0.16, 0.16, **0.87**, **0.89**, 0.15, 0.13 |

Wording of the yes/no question over a set of six frames (P(looks away)):

| Frames looking away | Project wording ("true of what is visible in the frames") | "at least one of the frames" | "most of the frames" | "every one of the frames" |
| --- | --- | --- | --- | --- |
| 0 of 6 | 0.12 | 0.16 | 0.11 | 0.10 |
| 2 of 6 | 0.33 | 0.48 | 0.11 | 0.12 |
| 5 of 6 | 0.62 | 0.78 | 0.56 | 0.26 |
| 6 of 6 | 0.76 | 0.84 | 0.75 | 0.74 |

**What it shows.**

- One frame is a coin toss on a turn where behaviour changes: it sees whichever second it lands on.
- The rubric over a set behaves like an average. The six-frame rating (2.38) is close to the mean of the six single-frame ratings (2.30). That suits a rubric.
- A yes/no question over a set behaves like "roughly what share of the frames". A two-second lapse in six scores 0.33 to 0.37 and is never detected at a 0.6 threshold. Rewording to "at least one" helps (0.48) but still misses. Quantifier words are honoured only loosely ("every one" still gives 0.26 for 5 of 6, though it does drop).
- Asking frame by frame with labels recovers the lapse exactly (0.87 and 0.89 on the two away frames, 0.13 to 0.16 on the others). Unlike audio clips, labelled images in one request showed no visible bleed here.

### 5.6 A turn as one video block (`10` part D, `11` parts 3 and 4)

**The six-second synthetic turn as MP4 (no sound).**

| Block | Bytes | Image tokens | Latency | Presence | P(away), project wording | "at any point" | 0:00 to 0:02 | 0:02 to 0:04 | 0:04 to 0:06 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MP4, `low` | 50 KB | 462 | 673 ms | 3.02 | 0.38 | 0.75 | 0.41 | 0.84 | 0.11 |
| MP4, `medium` | 50 KB | 462 | 366 ms | 3.02 | 0.38 | 0.75 | 0.41 | 0.84 | 0.11 |
| MP4, `high` | 50 KB | 1,848 | 832 ms | 3.16 | 0.40 | 0.72 | 0.29 | 0.89 | 0.12 |
| MP4, unset | 50 KB | 462 | 340 ms | 3.02 | 0.38 | 0.75 | 0.41 | 0.84 | 0.11 |
| WebM VP9, `low` | 159 KB | 462 | 1,032 ms | 3.14 | 0.29 | 0.59 | 0.30 | 0.82 | 0.10 |

The agent looks away during seconds 2 to 4. "At any point in the video" found it (0.75); a time range inside the clip found it better (0.84) with some spill into the first two seconds (0.41).

**Real video with sound (RAVDESS, about 3.5 to 4 s each).**

| Clip | Block | Tokens (image / audio) | Latency | Face | Voice | P(heard the sentence) | Presence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| neutral | original 720p, `low` | 198 / 105 | 1,913 ms | neutral 0.71 | neutral 0.55 | 0.77 | 3.00 |
| neutral | 360p, `low` | 198 / 105 | 630 ms | neutral 0.64 | neutral 0.57 | 0.74 | 3.04 |
| neutral | 360p, `high` | 792 / 105 | 792 ms | neutral 0.69 | neutral 0.44 | 0.68 | 2.78 |
| neutral | 360p, sound removed | 198 / 15 | 322 ms | neutral 0.74 | neutral 0.54 | 0.37 | 3.04 |
| neutral | 3 image frames + audio clip | 792 / 103 | 540 ms | neutral 0.81 | neutral 0.69 | 0.77 | 2.78 |
| happy | 360p, `low` | 264 / 133 | 814 ms | happy 0.91 | happy 0.81 | 0.80 | 3.80 |
| happy | 360p, sound removed | 264 / 20 | 325 ms | happy 0.92 | happy 0.83 | 0.28 | 3.76 |
| happy | 3 image frames + audio clip | 792 / 113 | 456 ms | happy 0.87 | happy 0.61 | 0.76 | 3.66 |
| sad | 360p, `low` | 264 / 136 | 743 ms | neutral 0.45 | sad 0.36 | 0.69 | 2.62 |
| sad | 3 image frames + audio clip | 792 / 116 | 420 ms | neutral 0.47 | neutral 0.42 | 0.68 | 2.20 |
| angry | 360p, `low` | 264 / 140 | 584 ms | angry 0.91 | angry 0.96 | 0.90 | 2.82 |
| angry | 360p, sound removed | 264 / 20 | 305 ms | angry 0.76 | angry 0.77 | 0.36 | 2.62 |
| angry | 3 image frames + audio clip | 792 / 128 | 483 ms | angry 0.94 | angry 0.93 | 0.74 | 2.98 |

(Full rows for every variant are in `results/10-frames-and-video.json`.)

**What it shows.**

- A video block's sound is heard: the sentence is recognised with the sound on (0.69 to 0.90) and not with it off (0.28 to 0.37).
- A video block is the cheapest way to send frames: 264 image tokens for a four-second clip, against 792 for three image blocks at `low`. Answers were equivalent.
- `high` buys nothing for faces at this size and costs four times the image tokens.
- With the sound removed, the "judging only by the sound of the voice" question still answered happy 0.83 and angry 0.77. It read the face. A question about a channel that is absent is answered from whatever is present.
- The happy clip's voice question came back "happy 0.81" inside the video, while the same actor's voice alone was read as angry in 5.2. With the face in the same block, the voice answer follows the face. Channel questions are not isolated inside one block.

### 5.7 Does a second or third channel add anything? (`10` parts E and fused)

**Cross-channel bleed.** One request carrying an audio clip and a frame, with vocal questions and visual questions both asked, against the same questions asked on each alone:

| Case | Delivery, together / alone | P(irritated), together / alone | Presence, together / alone | P(looks away), together / alone |
| --- | --- | --- | --- | --- |
| warm voice + looking at phone | 2.70 / 2.90 | 0.16 / 0.15 | 1.21 / 0.97 | 0.78 / 0.82 |
| warm voice + engaged | 3.08 / 2.90 | 0.13 / 0.15 | 3.62 / 3.29 | 0.11 / 0.13 |
| rushed voice + engaged | 3.05 / 2.65 | 0.13 / 0.16 | 3.69 / 3.29 | 0.13 / 0.13 |

The yes/no behaviours hold their channel. The rubrics drift 0.2 to 0.4 of a level towards the other channel: a smiling face lifted the rushed voice's delivery rating from 2.65 to 3.05.

**Asked plainly, which channel wins?** "How does this person feel? Use everything available." on two RAVDESS clips, sentiment 0 to 4:

| Clip | Text | Audio only | Frames only | Text + audio | Text + frames | All three |
| --- | --- | --- | --- | --- | --- | --- |
| angry | 1.97 | 0.69 | 0.81 | 0.96 | 1.26 | 0.64 |
| happy (voice heard as angry) | 1.97 | 1.46 | 3.25 | 1.97 | 2.63 | 3.11 |

**What it shows.**

- Visual adds information that audio and text do not have, in two ways: attention and gaze, which are simply absent from the other channels, and facial affect, which here corrected a misread voice.
- Audio adds to text whenever the voice departs from the words (angry: 1.97 to 0.96).
- When channels agree, more channels sharpen the answer (angry: 0.64 with all three).
- For channel-specific rubrics, keep one channel per request; for a single fused judgement, one request with everything works but hides which channel drove it.

### 5.8 The practice call **[main thread]**

A real practice call through the implemented media lane (Gemini Live as the customer, per-turn WAV clips to `gemini-decision-1`) worked end to end.
Employee clip requests carried 3 questions at about 600 to 1,100 input tokens and took 680 to 850 ms.
Customer voice-sentiment requests carried 1 question at about 510 to 570 tokens and took 540 to 620 ms.
Voice sentiment tracked text sentiment closely on those turns: 1.56 against 1.60, 1.84 against 1.90, 3.27 against 3.43.
The employee audio in that call was macOS text-to-speech.

**Reconciling with the runs here.**

- The token counts match the unit costs in section 4: one rubric question is about 180 tokens, the lane's text context 100 to 300, and a 5 to 8 second clip 150 to 240 audio tokens. Audio is a minority of each request.
- The close agreement between voice and text sentiment is what sections 5.1 and 5.4 predict, for two independent reasons. The customer was a synthetic voice, which speaks the way its words read. And the lane puts the turn's words beside the clip, which pulls the voice answer towards the words. On that call the voice channel was not adding information; it was re-reading the transcript at five times the cost. It should not be read as evidence that voice and words usually agree.

## 6. Cost model

Unit costs, all **[measured]**, at the published $0.10 per million input tokens (output is free):

| Item | Tokens |
| --- | --- |
| Transcript text | about 4.7 per second of conversation (285 per minute) |
| Audio | 30 per second (1,800 per minute), plus about 4 per clip |
| Image block | 264 at `low`, 527 `medium`, 1,100 `high` or unset |
| Video block | 66 per second at `low`, `medium` or unset; 264 per second at `high`; plus sound at 30 per second, or about 5 per second if silent |
| Yes/no question | about 87 (131 for the first in a request) |
| Five-level rubric question | about 133 (177 for the first) |

Per minute of call **[inferred from the unit costs, not measured end to end]**, assuming 8 turns a minute (4 employee, 4 customer, about 5 seconds each), the default scorecard's 16 transcript behaviours, and a scoring pass every 2 turns on a 10-minute call:

| Configuration | What is sent each minute | Tokens per minute | Cost per minute | Per 10-minute call |
| --- | --- | --- | --- | --- |
| Transcript only | 64 behaviour questions, 8 customer questions, 4 call-lane passes of about 23 questions, the transcript so far 4 times | about 21,000 | $0.0021 | $0.021 |
| + audio, per-turn clips (current lane) | 4 employee clips with 3 questions and context, 4 customer clips with 1 question and context | + about 4,800 | + $0.0005 | + $0.005 |
| + audio, per-turn clips, speaker line instead of transcript context | the same without 100 to 300 tokens of context per request | + about 3,600 | + $0.0004 | + $0.004 |
| + frames, 3 image blocks at `low` per employee turn | 792 image tokens and 3 questions per turn | + about 4,600 | + $0.0005 | + $0.005 |
| + one video clip at `low` per employee turn, in place of that turn's frames and audio clip | 5 s of video with sound: 330 + 150 tokens, 6 questions | + about 4,600 for the employee's vocal and visual skills together (against about 7,200 as separate clip and frames) | + $0.0005 | + $0.005 |
| Whole recording re-sent on every pass (rejected design) | the audio so far, 4 times a minute | + 36,000 on average, rising to about 70,000 in the last minute | + $0.0036 | + $0.036 |

Points to take from the table:

- Media is a modest addition. The transcript lane's questions are most of the bill.
- In a per-turn media request the questions and context cost more than the media. A 5-second clip is 150 tokens; its three questions are about 350.
- Re-sending the growing recording costs about 20 times the per-turn clips over a 10-minute call (360,000 audio tokens against 18,000). Still only cents. The stronger argument against it is latency.

## 7. Real-time implications

- **Per-turn media requests fit a live loop.** A 3 to 8 second audio clip with a handful of questions returned in 450 to 850 ms here and in the practice call; a single frame in 270 to 950 ms; a 4-second 360p video clip in 580 to 810 ms. They run in parallel with the transcript pass, which itself takes 0.3 to 0.5 s.
- **A growing recording does not.** At about 0.4 s plus 10.5 ms per second of audio, a pass over 5 minutes of audio takes about 3.5 s and over 9 minutes about 6 s. By the middle of a call the pass would lag several turns behind.
- **Upload size shows up as latency.** The same 4-second video took 1.9 to 2.8 s at 3 to 5 MB and 0.6 to 0.8 s at about 150 KB. Capture small (360p video, 640x360 JPEG frames, Opus or MP3 audio).
- **A clip is ready only when its turn ends**, so voice and visual readings always arrive one turn behind the words. That is inherent to per-turn clips.
- **Nothing is cached** **[documented]**. Anything sent twice is billed and processed twice. Read each clip once and keep the answer, as the lane already does.

## 8. Recommendations for the media lane

These refer to `planMediaRequests` in `apps/api/src/scoring/question-plan.ts` as it stood when the experiments ran on 2026-11-11.

**Status after these notes were written.** The same day, the media lane was changed to follow recommendations 1 (no transcript with a clip), 3 (clips under a second or too quiet to hold speech are dropped, in `apps/api/src/practice/audio.ts`), 4 (visual behaviours asked per labelled frame and combined in code: the highest frame for a negative behaviour, the mean for a positive one), 9 (`calm_pace` reworded to pace only), 10 (a `mixedSignal` marker on customer turns whose voice and words are a level or more apart) and 12 (the `visual_presence` levels now describe attention, not cheerfulness). Recommendations 2, 6 and 8 were already how the lane worked. Recommendations 5 (one video clip per turn) and 7 (compressed audio) are not done: both need the browser to capture differently. A practice call through the changed lane, with audio and frames, scored end to end on the live API.

1. **Stop sending transcript context with audio clips.** The `context()` block puts "Recent transcript, for context:" and the focus turn's own words beside every clip. That halved or worse the voice signal on angry and fearful clips (5.4) and explains why voice sentiment mirrored text sentiment in the practice call (5.8). For vocal and voice requests replace it with one line: "The attached audio clip is one turn of a customer support call, spoken by the EMPLOYEE." (or CUSTOMER). Do not include earlier turns either: they bias the answer towards the expected reaction. This also saves 100 to 300 tokens per request. For visual requests a one-line note is likewise enough.

2. **Keep one clip per request.** Measured bleed between labelled clips in one request reached a full sentiment level (5.4). The current design is right.

3. **Filter clips in code before asking.** Skip clips shorter than about one second or with negligible energy; the model returns a neutral-looking prior for them (4.2) and those priors would be averaged into the vocal skill. Likewise never ask a channel's question when that channel is missing: on a muted video the "voice" question was answered from the face (5.6). The existing `captured.audio` and `frames.length` checks cover presence; add duration and silence checks.

4. **Ask visual yes/no behaviours per frame, and combine in code.** A set-level yes/no misses a lapse of two frames in six (0.33). Put a text label before each frame ("Frame 1:"), ask each behaviour of each frame, then take the maximum across frames for negative behaviours and the share of frames for positive ones. Keep the rubric as one question over the set, where averaging is the right behaviour. This matches how the transcript lane already works: atomic checks, composed in code.

5. **Consider one short video clip per employee turn instead of image frames plus an audio clip.** It is a quarter of the image tokens per frame (66 against 264), samples every second instead of three stills, and carries the sound. WebM from a browser `MediaRecorder` was accepted. Use "at any point in the video" for negative behaviours (0.75 for a two-second lapse) or time ranges within the clip. Two cautions: channel-specific rubrics drift when face and voice share a block (5.6, 5.7), so if vocal and visual skills must stay independent, send the sound separately; and encode at 360p or smaller to keep latency down. This needs a capture change (per-turn clips rather than loose frames), so treat it as the next step, not a patch.

6. **If frames stay as images, keep `resolution: "low"` explicit and capture small.** Unset means `high` (1,100 tokens). The Gemini adapter already sets `low`. Pixel size does not change tokens; 640x360 is plenty and 320x180 still worked.

7. **Send compressed audio.** Opus in WebM or MP3 gave the same tokens and answers at about a tenth of the bytes. Raw PCM needs `audio/l16;rate=16000` or `audio/pcm;rate=16000`; without the rate it is rejected. 8 kHz telephone audio is usable.

8. **Bound clip length.** Tokens and latency are linear in duration. A long monologue should be cut to its last 20 to 30 seconds or split; a 30-second clip already takes 0.6 to 0.8 s.

9. **Reword `calm_pace`.** "Speaks at a calm, unhurried pace in a warm tone" peaked at 0.61 on calm human speech, so at a 0.6 threshold it will be reported as missed on nearly every turn. Either split it ("speaks at a calm, unhurried pace") and leave warmth to the rubric, or accept a lower threshold for this behaviour once there are labels. `irritated_tone` separated well on acted speech (0.60 to 0.85 for angry and disgusted, 0.21 to 0.27 for neutral and calm) but also fires on fearful voices (0.46 to 0.73): fine for employees, misleading if ever asked of customers.

10. **Fusing voice and text sentiment.** The current equal average is a reasonable default only once the voice question is asked on audio alone (recommendation 1); until then it averages the words with the words. Keep both values, as the project does, and surface a "mixed signal" marker when they differ by a level or more: on acted speech that gap was the entire content of the audio channel. Do not tune the weights without coach labels. Label voice readings taken from synthetic voices as such in the practice demo, since they carry little independent information.

11. **Thresholds.** For single-frame visual behaviours 0.6 sits in a wide gap: frames that did not show the behaviour scored at most 0.28 and frames that did scored at least 0.70 (leaving aside `ultra_high`). For vocal behaviours the gap is narrower and speaker-dependent. Treat 0.6 as provisional and calibrate both on labelled real recordings.

12. **Presence and expression.** The `visual_presence` rubric rated a sad or angry face facing the camera a level below a pleasant one. If the skill is meant to measure attention rather than cheerfulness, say so in the level descriptions.

## 9. Limits of this investigation

- **Small numbers.** Sixteen human voice clips from two actors, four human video clips from one actor, six synthetic frames of one fictional person, one 67-second synthetic call. Every pattern here needs confirming at scale.
- **Acted, studio-quality emotion.** RAVDESS is deliberately strong and clean. Real callers are subtler, noisier, overlapping and mid-sentence.
- **Synthetic voices and images.** The TTS clips proved unreliable carriers of a requested delivery. The frames are generated and idealised: even lighting, one person, nothing in the way.
- **One model version, one day, one machine.** Latency figures include this machine's upload path and are not a benchmark.
- **Not tested:** video longer than 7 seconds, so latency and addressing in long video are unknown; content questions on video beyond recognising one sentence; overlapping speakers or diarisation from audio; languages other than English; background noise; the Files API and URL inputs; rate limits; the Live API's own video input; any provider other than Gemini (the others take text only).
- **Truth labels for the call experiment are one reader's.** They were written before the run, with one arguable cell excluded.

## 10. What to test next

1. Real call recordings with consent, labelled blind by coaches for tone and presence, to calibrate the vocal and visual thresholds and to measure whether the voice channel changes any score a coach would give.
2. The context change in recommendation 1 on real two-party audio: voice sentiment with and without the transcript beside it, against coach labels.
3. A per-turn video clip from a real webcam through the practice call, comparing the video block with frames plus audio on cost, latency and agreement.
4. Longer video (30 s, 2 min) for latency and for time addressing inside the clip.
5. Customer anxiety against irritation: whether a separate "sounds worried" behaviour keeps fearful voices from tripping `irritated_tone`.
6. Whether transcript plus per-turn audio improves content detection on real calls, as it appeared to on the one synthetic call (28 of 29 against 26 of 29).

## Appendix: files

| File | Purpose |
| --- | --- |
| `lib.mjs` | Shared helpers: Decisions and TTS calls, WAV handling, question text copied from the project |
| `01-generate-speech.mjs` | Thirteen TTS clips (sets A, B, C) |
| `02-voice-vs-words.mjs` | Text, audio, and both, on the TTS clips; three repeats |
| `03-stimulus-check.mjs` | A general model describes each TTS clip's voice |
| `fetch-ravdess.py` | Fetches the RAVDESS clips by HTTP range request to a folder outside the repo |
| `04-ravdess-voice.mjs` | Voice questions on acted human speech |
| `05-build-call.mjs` | Builds the 12-turn call recording with turn boundaries |
| `06-audio-vs-transcript.mjs` | Transcript, recording, both, and per-turn clips on content questions |
| `07-clip-addressing.mjs` | Per-clip against whole recording and labelled clips; context framing |
| `08-audio-mechanics.mjs` | Formats, degenerate clips, duration scaling, telephone band |
| `09-generate-frames.mjs` | Six synthetic webcam frames |
| `10-frames-and-video.mjs` | Frames by resolution and count, real faces, video blocks, channel conflicts |
| `11-followups.mjs` | Wording over frame sets, pixel size against tokens, a turn as a video block |
| `12-token-accounting.mjs` | What the transcript and each question cost in tokens |
| `results/*.json` | Raw answers, token usage and timings for each script |
| `media/` | Generated clips and frames (synthetic, fictional; about 3.8 MB) |
