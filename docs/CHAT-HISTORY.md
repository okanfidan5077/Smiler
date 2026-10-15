# Planning conversation: summary

Condensed history of the first Claude Code session (Oct 13–15, 2026) that planned this project. It records how each decision was reached, so a new session doesn't reopen settled questions. Current state and decisions: [CLAUDE.md](../CLAUDE.md). Full plan: [PLAN.md](PLAN.md).

## 1. The idea

The user proposed a meme generator: n8n generates scenarios and memes with an AI model, an RTX 5090 generates images, Supabase stores them, and a simple mobile app shows them by scrolling or swiping. n8n is the important, complex part. The theme is workplace shenanigans and absurdities. First example:

> + A lot of unit tests fail in the pipeline, you need to solve it
> - I solved it
> + How?
> - I removed unit tests

Claude suggested: render text outside the image (image models misspell), a recurring cast, a 10-step pipeline with critic, dedupe and human approval, a feedback loop from likes, Expo or Flutter, and a Supabase schema. It asked about format, infrastructure, LLM choice, approval, audience, language, volume and art style.

## 2. First answers

- Text outside the image: yes. Show one person speaking at a time, with the text displayed in the app.
- Fixed cast: no, because jokes can be about **any profession** (pharmacy, farm, ship, doctors...). The same characters may appear, but there is no fixed cast.
- n8n runs locally. LLM local vs cloud: undecided (local may be weak at humor; cloud costs money). Approval required for now. Friends-only first, app store later if it's solid. English. Generate as much as can be approved; show 2–3 per day plus random older ones. Cartoon/comic style.
- More examples: "Website blocked under load → we blocked international access (90% of customers, so −90% sales)"; "DB can't handle billions of orders → deleted the orders table". The format doesn't have to match the examples; a single image with a punchline also works ("Your website will not crash if you block access to your website").

Claude named the pattern **"fix the metric, kill the goal"** (Goodhart's law) and proposed: a problem bank per sector, the same cast as actors in different costumes, a blind bake-off for LLMs, an approval UI instead of Telegram (no public webhook locally), and a backlog with a daily publish job.

## 3. Template memes

The user shared 8 of their own Turkish template memes (`docs/example-memes/`): Moe throws Barney out (fraud keeps coming back), Distracted Boyfriend (the boss chasing new projects over unfinished ones), Grave Selfie (the boss at the grave of the pay raise), Roll Safe (shut down the site and the servers won't crash), Crying Cat Interview (16-hour shifts, so "business must be great"), Baboon and lion (infrastructure about to hit the website with an update), fish bait ("be patient, it'll get better" / staff), and soldier shielding a sleeper.

Claude extracted the **joke mechanics** list and proposed template memes and a sector × problem × mechanic × format generator.

**Correction from the user on #8:** the soldier shields the *wrong* side while the bombs (cyber attacks) hit the exposed sleeper (systems). The security team struggles for nothing. This became the **Misdirected Effort** mechanic.

## 4. Scope settled

- The examples only clarify the aim. Generation should be **creative, not limited** to them. Above all, memes must make people smile; nothing unclear or unfunny.
- **Copyright:** all images will be original, unique cartoons (no real templates).
- Tap to reveal: yes, with up to 4 images revealed one by one.
- ComfyUI quality was poor before, so suggest better alternatives. Use Expo. No cast limit; quality matters most. Like/unlike buttons only.
- English only; everything generic. Company names in the examples mean nothing.

Claude made quality the centerpiece: generate wide and keep few, a critic rubric, a blind "explain this joke" test, two-stage approval (text first, then images), and image-model candidates evaluated in a bake-off.

## 5. Details

- The earlier image attempt was probably Flux (the user will check which one).
- Image generation: compare local and cloud. Cloud is acceptable if cheap, but local would be more satisfying.
- Two-stage approval is good, and the user's responses should be used as feedback.
- The user can optionally write free-text feedback in addition to reason chips.

## 6. Plan document

Claude wrote the final plan as a doc with a pipeline diagram and roadmap. The user commented that approvals should be a **web page rather than in the mobile app**, because they're mostly at a PC. The plan was updated: a local keyboard-driven admin page, with the Expo app as a feed only.

## 7. Phase 0 started

Claude built `meme-lab/`: writer, critic, explainer and matcher prompts; seed data (sectors, mechanics, translated examples); and a Node runner supporting Ollama, Claude and mock providers that produces a blind rating page with export, plus a ratings importer that feeds likes and rejections back into the prompts. It was tested only with the mock provider. The planning PC has an RTX 2080 Super (8 GB), no Ollama running and no API key, so real runs happen on the 5090 PC.

The work was moved to `Documents\SmilerApp`, a CLAUDE.md was written, and the repo was initialized to continue on the other PC.
