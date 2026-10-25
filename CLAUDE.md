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
| LLM | Local `gemma4:31b` for every role (decided 2026-10-25). Claude wrote better in a blind test (4.08 vs 3.50) but the user chose free local; `configs/hybrid.json` (Claude writer, Gemma judges) is ready if quality dips. Claude Code adds layouts to the catalog instead |
| Images | Undecided: local vs cloud. User prefers local (more satisfying) but accepts cloud if clearly better and cheap. Decide by bake-off |
| Image candidates | Local: Qwen-Image / Qwen-Image-Edit, FLUX.2 [dev], Z-Image Turbo. Cloud: Gemini image models, GPT Image. Verify current versions first |
| Earlier attempt | n8n → ComfyUI API with `flux1-dev` (fp16 T5, euler/simple, 35 steps, cfg 1.0 + FluxGuidance 3.5, 1024², text-only prompt per panel). Result was mediocre. Likely causes: at cfg 1.0 the negative prompt is ignored (no-text / not-photo did nothing), FLUX.1's photo bias with no style anchor, and no reference image, so panels don't match |
| Image path | Try local first. Lead candidate: Qwen-Image for panel 1 + Qwen-Image-Edit-2511 for panels 2–4 (Apache 2.0) |
| Approval | Two-stage: approve text first (no GPU cost), then images. Reason chips + optional free-text note + inline edit + regenerate. All stored as feedback |
| Feedback use | Prompt memory from day one; critic calibration vs user decisions; friends' likes as audience signal; optional later LoRA/DPO fine-tune of a local LLM |
| Reactions in app | Like / unlike only |
| Feed | 2–3 new memes/day from an approved backlog, then random older unseen ones |
| Mobile | Expo (React Native). Android APK; iOS via TestFlight ($99/yr) or web/PWA |
| Infra | n8n, Ollama and ComfyUI all local on the 5090 PC. VRAM: run text first, unload LLM (keep_alive 0), then images. App never talks to n8n; both meet in Supabase |

## Humor model

Jokes = **sector × problem × mechanic × format**, with a share of "free" runs. Mechanics (seed list, extendable) are in `meme-lab/data/mechanics.json`:
Absurd Fix (fix the metric, kill the goal: "tests pass, I deleted the tests"), Shiny Object, Villain's Smile, Empty Promise, Ironic Inference, Impending Doom, Endless Cycle, Misdirected Effort (soldier shielding the wrong side while bombs hit from the other).

The user's original examples (translated, in `meme-lab/data/examples.json`; the original Turkish images are in `docs/example-memes/`, where `1.jpg` is deliberately left out of git because it shows a company name) are the tone reference. Three more were text dialogues: failing unit tests → "I removed the unit tests"; overloaded orders table → "deleted the orders table"; site down under load → "blocked international access" (90% of customers, so sales −90%). The user is a developer, so IT ideas come easily to them; the hard part, and the goal, is equally good jokes for other professions.

## Quality system

Generate wide (10–20 concepts), keep 1–3. Critic rubric (1–5): instant, relatable, twist, tight, visual_payoff, not_mean, plus overall 1–10 and keep/maybe/cut. A blind "explain this joke" test (reader sees only the meme) plus a matcher that compares the reader's explanation with the writer's intended premise. pgvector dedupe. Vision QA on images.

## Roadmap and status

1. **Phase 0: bake-offs**: IN PROGRESS. Writer/critic prompts and test runner are built (`meme-lab/`). First local bake-off ran on the 5090 on 2026-10-19 (`gemma4:31b` vs `qwen3.6:27b`, 5 seeds × 8, same seeds). User's blind ratings of the critic's picks: **Gemma 4.2/5 avg (9 of 10 rated ≥4), Qwen 2.8/5 (4 of 9)**; Gemma also 4× faster. Gemma is the local writer. The user liked single-image jokes where the picture carries the punchline. The user reads drafts more easily with Turkish (`src/translate.js`).
   - **Calibration (`src/calibrate.js`, re-judges rated drafts blind, rated ids excluded from feedback):** the critic's overall score barely tracks the user (Pearson 0.20 → 0.31 after tuning; the 0.70 seen in round 1 was a model effect). The blind reader does: clarity 0.83, smile 0.75. In round 1, every user 4–5 had clarity 5 and every 1–2 had ≤4. So the **gate is now the blind reader** (`GATE` in `src/prompts.js`: clarity 5, smile ≥3). Every reviewed draft gets a blind read; the critic only vetoes not_mean <4 and breaks ties; the matcher is informational. Based on only 19 ratings, so re-check with every new ratings file.
   - Round 2 (Gemma, rng 2027, 6 new sectors, older keep rule): **user avg 4.4/5, 10 of 12 rated ≥4**, up from 4.2. The user likes recast templates (Distracted Boyfriend, Two Buttons, Drake all 5) and short endings where the picture does the rest. Calibration on 31 ratings: the gate passes 19/23 of the user's 4–5s and 0/5 of the 1–2s; critic overall 0.40, kept no bad ones but only half the good ones. Rating keys are `<run started>/<concept id>` because concept ids repeat across runs.
   - Round 3 (tuned gate, rng 2028): **user avg 4.5/5**, but 7 of 12 picks were one shape (cosmetic fix for a real problem), 4 marked "seen it" yet still rated 4–5. User's direction: keep working shapes, also experiment with new cases and formats. So the writer now marks about half its concepts `explore: true`, selection keeps the best proven concept and the best experiment per seed, and a mechanic may fill at most 2 picks per run. The repeated shape is now the mechanic "Cosmetic Cure".
   - Round 4 (rng 2029): **user avg 4.58; experiments 4.67 vs proven 4.50**, so exploring pays. But layouts still repeated (of 46 picks so far: 21 single captions, many "proud person in front, disaster behind"; 15 dialogues; 10 recasts over 7 templates), and generic perks recurred ("too many espresso machine jokes"). User: as many formats as possible, and work-specific absurdities. So: **`data/formats.json`**, a catalog of 42 layouts (23 original, 19 recast templates). Each seed gets 3 layouts dealt from a shuffled deck, and a layout may be picked once per run (`layout` field; it sets format and template). **`data/problems.json`**, 12 concrete problems per sector (generated by `src/problems.js` with Gemma, hand edits kept), 4 per seed go to the writer. Writer and critic ban generic perks (espresso, pizza, wellness app, mood lighting, dark mode) as the centerpiece; the critic caps those at 6. 
   - Round 5 (rng 2030): **user avg 4.73 (best so far), 11 picks in 11 layouts, only 2 "seen it"**; 9 of 11 layouts rated 5. The writer invented a layout ("Interaction Loop": a zookeeper outsmarted by a tortoise, rated 5), now in the catalog as "Outsmarted" (43 layouts). The remaining repeat is "wasted money on luxury while basics fail" (rated 4 with "seen it"). A real brand slipped into a scene description, so brands are now banned in scenes too and the critic vetoes them (not_mean ≤3). The critic still underrates good jokes (gave 5–6 to two the user rated 5), so it stays a tie-breaker only.
   - Rating trend: 4.2 → 4.4 → 4.5 → 4.58 → 4.73.
   - **Round 6, blind Claude test without an API key (rng 2031):** Gemma ran the normal pipeline; Claude Opus 5.5 (the Claude Code session itself) wrote 12 concepts for the same seeds, layouts and problems, before seeing Gemma's, merged with `src/add-concepts.js` and judged by the same Gemma critic and reader. User ratings: **Claude 4.08 (six 5s, 9 of 12 ≥4) vs Gemma 3.50 (two 5s)**. Of Claude's concepts passing the Gemma gate: 4.56. Caveat: the session knew the user's ratings; the API writer gets them through the feedback block. The user liked "problem moved onto someone else" (new mechanic **Problem Relocation**), Clown Makeup and Expanding Brain ("keep all those formats"). The user flagged speech bubbles as hard for image generation, so `validate()` now rejects scenes that need readable text (`TEXT_IN_IMAGE`). `configs/hybrid.json` = Claude writer + Gemma judges, about $0.3 per seed. **Decision (2026-10-25): stay on Gemma** (free, local); the user approves every meme in Phase 1 anyway. Claude's role instead: write layouts for the catalog in the Claude Code session. Catalog now **94 layouts** (17 single, 40 multi-panel, 37 recast), including Desk Relay, Why This Rule Exists, Audit Day, Quiet Shift, Nature Documentary, Movie Trailer, Museum Placard, Zoom Out, Four Seasons, Panik Kalm Panik, Waiting Skeleton, Domino Effect, Iceberg. 
   - **Gate re-calibrated on 90 ratings (rounds 1–6):** the blind-reader gate passes 65/70 of the user's 4–5s and 3/10 of the 1–2s (one of those is now caught by the text-in-image check). Smile has saturated at 3 (never ≥4), so it no longer ranks; the critic's overall score is near useless (0.18). New gate (`passesGate` in `src/prompts.js`): clarity 5, smile ≥3, critic instant ≥4. Ranking: instant + tight + visual_payoff, then overall. Round 7 (rng 2032) is the first run with 94 layouts and this gate.
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
- `configs/`: model per role. `gemma.json` (`gemma4:31b`, thinking off) and `qwen.json` (`qwen3.6:27b`, thinking **on**: with thinking off, Ollama 0.30.10 ignores the JSON schema for it) are the pulled local models; `local.json` still points at the unpulled `qwen3:32b`. `OLLAMA_URL` env for a remote Ollama. Node is at `C:\Program Files\nodejs` (not on the Bash tool's PATH until a new shell). `cloud.json` uses `claude-opus-5-5` (effort high/medium/low per role, server-side refusal fallback on).
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
