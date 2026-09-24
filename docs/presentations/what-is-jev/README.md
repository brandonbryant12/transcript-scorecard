# What is JEV? A decision model

Open `what-is-jev.html` directly in a browser. All images are embedded; it works offline. Arrow keys navigate, Fullscreen expands, and Notes & sources opens the notes for the current slide. Browser print produces all slides.

This is an informal 21-slide introduction: JEV, the classifier meme, reduced setup effort, regression/autoregression/classification primer, Titanic training walkthrough, JEV API and real experiment, then four application patterns. The training walkthrough is conceptual; no conventional model was trained. The JEV experiment was actually run.

## Experiment

100 requests succeeded against pinned model `jev-1.13.0`. The 100-row sample was chosen before inference with seed 20260923: 62 non-survivors and 38 survivors from a public mirror of Kaggle Titanic `train.csv`. Labels and passenger identifiers were excluded from requests. No prompt tuning, no retries, no abstention. The model's returned choice was used as the prediction.

- Accuracy: 72/100; majority baseline 62/100; female-survives heuristic 74/100.
- Confusion matrix (actual rows, predicted columns; non-survival then survival): [[52,10],[18,20]].
- Median client-observed request latency: 370.5 ms; p95: 418 ms; two concurrent workers.
- List-price cost estimate: 49,260 input tokens × $0.042 per million = $0.00206892. Output tokens free. No invoice was inspected.
- Titanic is a famous public dataset and may be in pretraining. This is not a novel-data evaluation or Kaggle leaderboard submission. No LLM comparison was run.

`experiment/manifest.json` freezes the sample, request, dataset SHA-256, and exclusions. `experiment/predictions.csv` contains predictions. Individual passenger JSON files contain all actual requests and responses. `experiment/summary.json` contains metrics.

## Rebuild and reproduce

To rebuild the HTML from the existing assets and saved results, run in order: `python3 build.py`, `python3 extend.py`, `python3 add-results.py`, `python3 finalize.py`, `python3 lighten.py`. Each stage runs once after its preceding stage. No dependencies are needed.

`python3 experiment.py` resumes using cached passenger responses. New uncached calls use JEV_API_KEY or TYPESAFE_API_KEY from the environment; credentials are never saved to artifacts. Changing the sample or prompt requires a new output directory and manifest.

## Verification and placement

HTML structure, image presence, inline JavaScript syntax, and reconciliation of all 100 saved predictions were checked. Browser visual review was blocked by the browser tool's local-URL policy, so layout is not visually verified. The presentation and evidence are stored in docs/presentations/what-is-jev within Transcript Scorecard.

The high-jump illustration was generated for this presentation. Original meme image and technical sources are linked in slide notes.
