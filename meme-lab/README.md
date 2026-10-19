# Meme Lab (Phase 0)

Tests the writer and critic prompts for Workplace Absurdities before any image work, and compares local vs cloud models on the same seeds.

Pipeline per seed: **writer** (N concepts) → **critic** (scores, keep/maybe/cut) → top K go to a **blind explainer** (sees only the meme) → **matcher** (did the reader get the intended joke?). Output: `results/<timestamp>/results.json` and a blind rating page, `report.html`.

## Setup

```bash
npm install
```

- **Local:** Ollama with a model pulled on the 5090 machine (`ollama pull qwen3:32b`, or edit `configs/local.json`). If Ollama runs on another PC, set `OLLAMA_URL=http://<that-pc>:11434`.
- **Cloud:** an Anthropic API key in `ANTHROPIC_API_KEY`.

## Run

```bash
node src/run.js --configs mock --seeds 3 --n 4          # pipeline test, no model needed
node src/run.js --configs local --seeds 5 --n 8 --keep 2
node src/run.js --configs local,cloud --seeds 5 --n 8   # bake-off: same seeds, both model sets
```

Options: `--seeds` (sector × mechanic pairs), `--n` (concepts per seed), `--keep` (top concepts the critic passes on), `--free 0.3` (share of seeds with no mechanic), `--rng 42` (repeat the same seeds), `--sector "hospital"` / `--mechanic "Absurd Fix"` (pin one).

## Rate

Open `report.html`. Cards are shuffled and anonymous. Rate 1–5, add chips and notes, then **Reveal** to see which model wrote each and how the critic scored it. Tick "include critic-cut concepts" and rate some of those too, so the summary can tell whether the critic agrees with you.

To read the drafts with a translation in parentheses (a reading aid only; ratings and feedback stay English), run `node src/translate.js results/<timestamp> --lang Turkish` and reopen the report. Ratings already given are kept.

**Export ratings**, then feed them back to the writer and critic:

```bash
node src/import-ratings.js path/to/ratings.json
```

4–5 become "liked" and 1–2 "rejected" examples in `data/feedback.json`; both prompts read the latest 15 of each.

## Files

| Path | What it is |
| --- | --- |
| `prompts/writer.md` | Writer system prompt (`{{mechanics}}`, `{{examples}}`, `{{feedback}}` are filled in) |
| `prompts/critic.md` | Critic rubric and verdict rules |
| `prompts/explainer.md`, `prompts/matcher.md` | Blind clarity test |
| `data/` | Sectors, mechanics, tone examples, feedback |
| `configs/` | Model per role; `price` is USD per 1M input/output tokens for cost estimates |
