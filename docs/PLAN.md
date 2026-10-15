# Workplace Absurdities Meme Generator: Final Plan

Oct 14, 2026 · Online version: https://claude.ai/code/artifact/99b9bfa4-19ef-4134-8ce6-3e028c7823e6

## Overview

We are building a local AI pipeline that writes and draws original cartoon memes about workplace absurdities in any profession, plus a simple Expo app that shows 2–3 new memes a day. **The quality bar is simple: every published meme must make people smile within a few seconds, with no explanation needed.**

- **Generation:** n8n orchestrates an LLM (local Ollama or cloud, decided by a bake-off) for jokes and the local RTX 5090 (or a cloud API, also decided by bake-off) for images.
- **Storage:** Supabase (Postgres, Storage, pgvector, anonymous auth).
- **Display:** Expo app with a swipe feed, tap-to-reveal panels and like/unlike buttons, and a separate web admin page on your PC for approvals.
- **Scope now:** friends-only, English, generic (no real companies or people), original cartoon art only (no copyrighted templates). A public store release is a later decision once quality is proven.
- **Not in scope yet:** monetization, multiple languages, user accounts beyond anonymous auth.

## Humor model

Every joke is built from four choices, **sector × problem × mechanic × format**, which gives far more variety than imitating examples. Mechanics and the problem bank are inspiration, not rules: a share of runs uses free mode ("surprise me with workplace absurdity"), and we keep whichever mode earns more approvals and likes.

**Sectors:** any profession, e.g. software, hospital, pharmacy, farm, ship, airline, restaurant, school, construction, bank, hotel, police, logistics. The list lives in a table and grows over time.

**Problem bank:** a table of realistic pain points and KPIs per sector ("long ER waiting times", "foxes eating chickens", "too many product returns"). An LLM fills it in occasional batch runs; you can add entries by hand. Usage counts keep the generator from repeating the same problems.

**Mechanics (seed list, extendable):**

| Mechanic | Shape of the joke | Example |
| --- | --- | --- |
| Absurd Fix | Fix the metric, kill the goal | "Tests pass now." "How?" "I deleted the tests." |
| Shiny Object | Abandon the old for the new | Boss eyes the new project, unfinished ones look on |
| Villain's Smile | Leadership happy about staff's loss | Boss posing at the grave of the pay raise |
| Empty Promise | The same bait works every time | Staff bite "be patient, it'll get better" again |
| Ironic Inference | Outsiders read a bad sign as a good sign | "16-hour shifts? Business must be great!" |
| Impending Doom | Disaster sneaking up on calm | The update creeping up on the sleeping website |
| Endless Cycle | The removed problem walks right back in | Fraud thrown out, back in the next frame |
| Misdirected Effort | Heroic work aimed the wrong way | Soldier shields one side, bombs hit from the other |

**Formats:**

- **Single:** one image and one punchline ("Your website can't crash if nobody can reach it").
- **Multi-panel (2–4):** each panel has its own image and line; the app reveals panels one tap at a time.
- **Re-cast template:** the composition of a famous meme, redrawn as original cartoon art.

**Characters:** no fixed cast. The writer picks whoever the joke needs. When a character comes out well, you can save it to a character library with its reference image so the writer can reuse it later.

## Architecture

Everything that generates runs on one local machine with the RTX 5090; only Supabase (and optional cloud model APIs) live outside it. The app never talks to n8n: both sides meet in Supabase, so the local machine needs no public URL.

| Component | Runs on | Role |
| --- | --- | --- |
| n8n | Local PC (Docker) | Orchestrates every pipeline step, schedules runs |
| Ollama | Local PC, 5090 | Local LLM for problem bank, and writer/critic if it wins the bake-off |
| Cloud LLM API | Optional | Writer and critic if local humor is too weak |
| ComfyUI | Local PC, 5090 | Runs the chosen local image model through its API |
| Cloud image API | Optional | Image generation if it clearly wins the bake-off |
| Supabase | Cloud | Postgres + pgvector, Storage for images, anonymous auth, publish schedule |
| Admin web page | Local PC (browser) | Both approval stages, feedback, stats |
| Expo app | Phones (Android APK, iOS via TestFlight, or web/PWA) | Feed and reactions |

**VRAM sequencing:** Ollama and ComfyUI share 32 GB, so a run never uses both at once. n8n does all text work first, unloads the LLM (Ollama `keep_alive: 0`), then renders all images in one batch.

**Availability:** generation only happens while the PC is on. That is fine, because the app reads from the approved backlog in Supabase, which covers days or weeks of publishing.

## n8n pipeline

One n8n workflow takes a meme from seed to publish in ten steps, and GPU time is spent only on jokes you already approved.

```
TEXT (LLM)    Seed ──► Writer ──► Critic ──► Dedupe ──► [Approve text]  (you, on the web)
                          ▲                                   │    │
                          └──── rejected: reasons + notes ────┘    │ approved text only
                                                                   ▼
IMAGES (GPU)  Art director ──► Image gen ──► Vision QA ──► [Final approval] ──► Publish
                                   ▲                              │          (2–3/day from backlog)
                                   └── rejected: re-roll image ───┘
```

**Implementation notes**

- **Writer output** is strict JSON: format, sector, problem, mechanic, panels (line, speaker, scene description), and the intended joke in one sentence (used by the explain test).
- **Approval waits** are not long-running n8n executions: the text run ends after writing drafts to Supabase; a second workflow, triggered on a schedule or by a status change, picks up `text_approved` memes for images.
- **ComfyUI calls** use its HTTP API: queue the workflow JSON, poll history until done, download images, upload to Supabase Storage.
- **Vision QA failures** loop back to image generation automatically (max 2 retries) before a meme reaches you.
- **Problem bank refresh** is a separate, occasional workflow.

## Quality system

The pipeline generates wide and keeps few: each run writes 10–20 concepts and passes on only the best 1–3. Four filters run before anything reaches you.

**1. Critic rubric** (score 1–5 each, plus an overall verdict):

| Criterion | Question the critic answers |
| --- | --- |
| Instant | Is it understood in under 3 seconds, with no explanation? |
| Relatable | Will anyone who has held a job recognize it? |
| Twist | Is the punchline a surprise, not the obvious answer? |
| Visual payoff | Does the image add to the joke, not just decorate it? |
| Not mean | Does it mock situations and systems, not groups of people? |

(The implemented critic prompt also scores **tight**: no wasted words, punchline last.)

**2. Blind "explain this joke" test:** a separate model call sees only the final text (and later, the image) and explains why it is funny. If its explanation does not match the intended joke, the concept is unclear and is rejected.

**3. Dedupe:** every concept is embedded and compared against past memes in pgvector. Anything above a similarity threshold is dropped as a repeat.

**4. Vision QA (after images):** a vision model checks for broken faces and hands, stray text inside the image, and whether the image actually shows what the joke needs.

The critic's own accuracy is tracked: how often its top picks match your approvals. That number is our main measure of "is the system getting funnier?"

## Approval and feedback loop

You approve every meme twice: once as text (fast, no GPU cost) and once with images. Every decision is stored as feedback, so the system learns your taste from day one.

**On the web admin page, per draft:**

- **Approve (→ key):** one keypress or a click.
- **Reject (← key):** then one click or number key on reason chips.
  - Text stage: `not funny` · `unclear` · `seen it` · `weak punchline` · `too mean` · `wrong format`
  - Image stage: `bad faces/hands` · `doesn't match joke` · `style off` · `cluttered`
- **Optional free-text note** on any decision, approve or reject (e.g. "funny but the last line is too long", "make the boss more smug"). This is the richest signal and the writer and critic read it directly.
- **Edit, then approve:** the original and your edited text are both stored, which shows exactly how a joke gets better.
- **Regenerate:** re-roll only the image (text stays approved) or only the punchline.

**How the feedback is used:**

1. **Prompt memory (from day one):** the writer and critic get recent approvals, rejections with reasons and notes, and your edits as examples.
2. **Critic calibration:** we measure agreement between critic scores and your decisions, and tune the rubric when it drifts.
3. **Two signals:** your approval is the quality gate; friends' likes and unlikes are the audience signal. Disagreements between the two show which topics land with whom.
4. **Fine-tuning (later, optional):** after a few hundred decisions, approved vs rejected pairs (plus your edits) can train a LoRA on a local LLM with DPO-style preference training on the 5090, which may close the humor gap between local and cloud models.

## Image generation

The image model is chosen by a side-by-side bake-off, with a preference for local if quality is close. Images never contain text: the app shows all words, which keeps them sharp, editable and translatable later.

**Candidates** (verify current versions and prices when the image bake-off starts):

| Candidate | Where | Why it is on the list |
| --- | --- | --- |
| Qwen-Image / Qwen-Image-Edit | Local (ComfyUI) | Strong prompt adherence; Edit keeps characters consistent from a reference |
| FLUX.2 [dev] | Local (ComfyUI, quantized) | High quality, reference-image support |
| Z-Image Turbo | Local (ComfyUI) | Fast, good for many drafts |
| Gemini image models / GPT Image | Cloud API | Currently among the best at consistent characters and comics |

**Bake-off method:** 5 approved jokes, the same style prompt, every candidate; judge side by side on joke fit, character consistency, cartoon style and artifacts. Cloud cost estimate: a few cents per image, roughly $0.10–0.30 per 4-panel meme including re-rolls.

**Fallback hybrid:** local for drafts and iteration, cloud only for the final render of approved jokes.

**Style:** one fixed cartoon/comic style prompt (and later a style LoRA if needed), applied to every panel so the feed feels like one series. Your earlier Flux results are worth rechecking: FLUX.1 schnell and Flux's default photographic look explain weak cartoon output.

**Panel consistency:** panel 1 is generated first, then used as the reference image for panels 2–4 with an edit-capable model. Characters, clothes and setting stay the same; only action and expressions change. Each panel is stored as its own image so the app can reveal them one by one.

## Supabase data model

Ten tables cover generation, approval, publishing and feedback; images live in a Supabase Storage bucket and rows hold their URLs.

| Table | Key fields | Purpose |
| --- | --- | --- |
| `sectors` | id, name, weight, active | Professions to draw from |
| `problems` | id, sector_id, description, source (llm/manual), times_used | Problem bank |
| `mechanics` | id, name, description, examples | Joke mechanics, extendable |
| `characters` | id, name, description, reference_image_url | Saved characters for reuse |
| `memes` | id, format, sector_id, problem_id, mechanic_id (nullable), mode (seeded/free), status, critic_scores, embedding, publish_at, created_at | One meme; status runs draft → text_approved → images_ready → approved → published (or rejected) |
| `panels` | id, meme_id, position (1–4), text, speaker, image_url, image_prompt | Each panel's line and image; a single-format meme has one panel |
| `feedback` | id, meme_id, stage (text/image), decision, reasons[], note, original_text, edited_text, created_at | Your approval decisions, chips, notes and edits |
| `reactions` | meme_id, device_id, type (like/unlike), created_at | Friends' likes and unlikes |
| `views` | meme_id, device_id, seen_at | Lets the feed show only unseen older memes |
| `generation_runs` | id, models used, prompts, timings, cost, errors | Debugging and cost tracking |

Row-level security: the app can read published memes and write its own reactions and views; only your admin account can read drafts and write feedback. n8n uses the service key.

**Publishing:** a scheduled job (Supabase `pg_cron` or n8n) picks 2–3 approved memes per day from the backlog and sets status to published with `publish_at`.

## Apps: Expo feed and web admin

The app is a vertical swipe feed with tap-to-reveal panels and like/unlike, and nothing else; all approvals happen on a web admin page on your PC. One Expo codebase ships as an Android APK, via TestFlight on iOS (needs a $99/year Apple developer account), or as a web/PWA build.

**Feed**

- Full-screen cards, swipe up for the next meme.
- Today's 2–3 new memes first, then a random mix of older ones this device has not seen.
- Single format: image with the punchline below it.
- Multi-panel: panel 1 and its line show first; each tap reveals the next panel and line, so the punchline lands last.

**Reactions**

- Like and unlike buttons; no accounts, using Supabase anonymous auth per device.

**Share**

- Renders the full meme (all panels plus text) into one image with `react-native-view-shot`, then opens the native share sheet.

**Admin web page**

- A small React page (Vite + supabase-js) running locally on your PC, signed in as the admin account; no public hosting needed.
- Two queues: text drafts and image drafts, each shown with critic scores and the explain-test result.
- Keyboard-driven: → approve, ← reject, number keys pick reason chips, N opens the note field, E edits text inline, R regenerates.
- A stats view: backlog size, approval rate, critic agreement, likes per meme.
- If approving on the go becomes useful later, the same screens can be added to the Expo app.

## Roadmap

Work runs in five phases, starting with prompt writing and bake-offs, so model choices rest on real output rather than guesses. No dates are set; each phase ends at a gate you can check.

| Phase | Work | Gate to move on |
| --- | --- | --- |
| 0. Bake-offs (current) | Writer + critic prompts; LLM bake-off local vs cloud; image bake-off | Models chosen |
| 1. Text pipeline | Seed, writer, critic, dedupe in n8n; Supabase schema; web admin page | About 1 in 3 drafts worth approving |
| 2. Image pipeline | Art director, image generation, panel reference, vision QA, final approval | 4 panels stay consistent |
| 3. Expo app | Swipe feed, tap-to-reveal, like/unlike, share as image, friends install | Friends use it every day |
| 4. Feedback loop | Likes analytics, critic tuning, more sectors and mechanics, optional LoRA | — |

Phase 1 needs approvals before any app exists, so it starts with the web admin page on your PC; the Expo feed comes in Phase 3 and stays display-only. Prompt memory from your feedback is active from Phase 1; Phase 4 adds calibration, analytics and optional fine-tuning.

## Open items and risks

**Open items**

- [ ] Check which Flux model and workflow you used before, and what looked wrong
- [ ] Send more example memes, especially non-IT ones, for the writer's inspiration set
- [ ] Pick the cartoon style reference (2–3 images of the look you want)
- [ ] Decide iPhone distribution: TestFlight ($99/year) or web/PWA for iPhone friends

**Risks**

| Risk | Mitigation |
| --- | --- |
| Jokes are generic or unfunny | Generate wide, critic + explain test, your notes as prompt memory, model bake-off |
| Local models are too weak for humor | Model is a config value; switch writer/critic to a cloud model with low cost at this volume |
| Characters drift between panels | Panel 1 as reference for edit-capable models; vision QA rejects drift |
| Approval becomes a chore | Text-first approval is fast and keyboard-driven; batch sessions; backlog means no daily pressure |
| Repetitive content over time | pgvector dedupe, problem usage counts, new sectors and mechanics |
| Public release later | Original art only, generic content, moderation and store policies reviewed before any launch |
