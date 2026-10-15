# SmilerApp: Workplace Absurdities meme generator

Context for Claude Code. This project was planned in an earlier session on another PC; this file carries everything decided there. How the decisions were reached: [docs/CHAT-HISTORY.md](docs/CHAT-HISTORY.md). The full plan is in [docs/PLAN.md](docs/PLAN.md) (also published as a doc: https://claude.ai/code/artifact/99b9bfa4-19ef-4134-8ce6-3e028c7823e6).

## What we are building

An AI pipeline that writes and draws **original cartoon memes about workplace absurdities in any profession** (IT, hospital, pharmacy, farm, ship, airline, restaurant, ...), plus a simple Expo app that shows 2–3 new memes a day.

- **Quality bar:** every published meme must make people smile within a few seconds with no explanation. Quality matters more than volume or imitation of examples.
- **Generation:** n8n (local) orchestrates an LLM for jokes and image generation on an RTX 5090.
- **Storage:** Supabase (Postgres + pgvector, Storage, anonymous auth).
- **Display:** Expo app, feed only. **Approvals happen on a separate local web admin page** (the user is usually at a PC).

## Decisions made with the user

| Topic | Decision |
| --- | --- |
| Audience | Friends-only first; public app store release only if quality is proven |
| Language | English only for now (user's own examples were Turkish, the app is EN) |
| Content | Generic only: no real companies, people, or politics. Company names in the examples meant nothing |
| Art | Original cartoon/comic style. No copyrighted meme templates; famous compositions may be redrawn as original art ("re-cast templates") |
| Text | Never rendered inside images. The app shows text below the image (one speaker line at a time) |
| Formats | single (image + punchline), multi_panel (2–4 panels, tap to reveal one by one), recast_template |
| Characters | No fixed cast. The writer picks whoever the joke needs; good characters can be saved to a library for reuse |
| Examples | The user's examples show tone, not limits. The generator should be creative beyond them |
| LLM | Undecided: local Ollama vs cloud (Claude). Decide by blind bake-off. Hybrid likely (local for problem bank, cloud for writer/critic) |
| Images | Undecided: local vs cloud. User prefers local (more satisfying) but accepts cloud if clearly better and cheap. Decide by bake-off |
| Image candidates | Local: Qwen-Image / Qwen-Image-Edit, FLUX.2 [dev], Z-Image Turbo. Cloud: Gemini image models, GPT Image. Verify current versions first |
| Earlier attempt | User tried ComfyUI with Flux before (unsure which variant) and quality was poor; likely schnell or wrong workflow. User will check |
| Approval | Two-stage: approve text first (no GPU cost), then images. Reason chips + optional free-text note + inline edit + regenerate. All stored as feedback |
| Feedback use | Prompt memory from day one; critic calibration vs user decisions; friends' likes as audience signal; optional later LoRA/DPO fine-tune of a local LLM |
| Reactions in app | Like / unlike only |
| Feed | 2–3 new memes/day from an approved backlog, then random older unseen ones |
| Mobile | Expo (React Native). Android APK; iOS via TestFlight ($99/yr) or web/PWA |
| Infra | n8n, Ollama and ComfyUI all local on the 5090 PC. VRAM: run text first, unload LLM (keep_alive 0), then images. App never talks to n8n; both meet in Supabase |

## Humor model

Jokes = **sector × problem × mechanic × format**, with a share of "free" runs. Mechanics (seed list, extendable) are in `meme-lab/data/mechanics.json`:
Absurd Fix (fix the metric, kill the goal: "tests pass, I deleted the tests"), Shiny Object, Villain's Smile, Empty Promise, Ironic Inference, Impending Doom, Endless Cycle, Misdirected Effort (soldier shielding the wrong side while bombs hit from the other).

The user's original examples (translated, in `meme-lab/data/examples.json`; the original Turkish images are in `docs/example-memes/`) are the tone reference. Three more were text dialogues: failing unit tests → "I removed the unit tests"; overloaded orders table → "deleted the orders table"; site down under load → "blocked international access" (90% of customers, so sales −90%). The user is a developer, so IT ideas come easily to them; the hard part, and the goal, is equally good jokes for other professions.

## Quality system

Generate wide (10–20 concepts), keep 1–3. Critic rubric (1–5): instant, relatable, twist, tight, visual_payoff, not_mean, plus overall 1–10 and keep/maybe/cut. A blind "explain this joke" test (reader sees only the meme) plus a matcher that compares the reader's explanation with the writer's intended premise. pgvector dedupe. Vision QA on images.

## Roadmap and status

1. **Phase 0: bake-offs**: IN PROGRESS. Writer/critic prompts and test runner are built (`meme-lab/`). Not yet run against a real model.
2. Phase 1: text pipeline in n8n + Supabase schema + **web admin page** for approvals.
3. Phase 2: image pipeline (art director, image gen with panel 1 as reference for 2–4, vision QA, final approval).
4. Phase 3: Expo app (feed, tap-to-reveal, like/unlike, share as one rendered image).
5. Phase 4: feedback loop (analytics, critic tuning, more sectors/mechanics, optional LoRA).

Gates: models chosen → about 1 in 3 drafts worth approving → 4 panels stay consistent → friends use it daily.

## meme-lab (Phase 0 tool)

Node 24, ESM, only dependency `@anthropic-ai/sdk`. See `meme-lab/README.md`.

```bash
cd meme-lab && npm install
node src/run.js --configs mock --seeds 3 --n 4          # pipeline test, no model
node src/run.js --configs local,cloud --seeds 5 --n 8   # bake-off
node src/import-ratings.js path/to/ratings.json         # feed ratings back into prompts
```

- `prompts/`: writer, critic, explainer, matcher. Placeholders `{{mechanics}}`, `{{examples}}`, `{{feedback}}` are filled at run time.
- `configs/`: model per role. `local.json` uses Ollama `qwen3:32b` (change to whatever is pulled; `OLLAMA_URL` env for a remote Ollama). `cloud.json` uses `claude-opus-5-5` (effort high/medium/low per role, server-side refusal fallback on).
- `results/<timestamp>/report.html`: blind rating page (1–5, chips, notes, reveal, export). Results are git-ignored.
- `data/feedback.json`: liked/rejected examples fed into writer and critic (latest 15 of each).

## Next steps

1. On the 5090 PC: install Ollama, pull a ~30B model, run the bake-off (also set `ANTHROPIC_API_KEY` for the cloud side; roughly $0.25 per seed on Opus 5.5).
2. User rates the report, exports, imports ratings; tune prompts with the user (critic rubric first if it disagrees with the user).
3. User checks which Flux variant/workflow they used before; then plan the image bake-off.
4. The user will send more example memes, especially non-IT ones; add them to `data/examples.json`.

## Working with this user

- Discuss and propose first, then build; they like being asked focused questions with a recommendation.
- They are a developer; concise technical answers are fine.
- Open item from the plan: iPhone distribution choice (TestFlight vs PWA) and a 2–3 image cartoon style reference.
