# Smiler: Workplace Absurdities

AI-written cartoon memes about workplace absurdities in any profession. Project context and decisions: [CLAUDE.md](CLAUDE.md). Plan: [docs/PLAN.md](docs/PLAN.md).

| Folder | What it is |
| --- | --- |
| `meme-lab/` | Prompt lab and the text pipeline library (`src/pipeline.js`): writer, critic, blind-reader gate, layouts, selection |
| `server/` | Local pipeline service: runs the pipeline with Gemma, writes drafts to Supabase, scores layouts from approvals |
| `supabase/migrations/` | Database schema and row-level security |
| `admin/` | Local web admin page for approvals (keyboard driven) |
| `n8n/` | n8n workflow that calls the service on a schedule |

## Phase 1 setup

1. **Supabase:** create a free project at supabase.com. Under Authentication > Users, add your admin user (email + password).
2. **`.env`:** copy `.env.example` to `.env` and fill in the URL, anon key, service-role key, `DATABASE_URL` (session pooler URI with your DB password) and `ADMIN_EMAIL`. `.env` is git-ignored.
3. **Database:**
   ```bash
   cd server && npm install && npm run migrate
   npm run seed -- path/to/ratings.json path/to/ratings1.json ...
   ```
   `migrate` applies the schema and registers `ADMIN_EMAIL` as admin. `seed` loads sectors, mechanics, layouts and problems, and turns meme-lab rating exports into starting layout scores.
4. **Service** (needs Ollama with `gemma4:31b`): `cd server && npm start`. It listens on `127.0.0.1:8787`.
5. **Admin page:** `cd admin && npm install && npm run dev`, then open http://localhost:5173.
6. **n8n:** import `n8n/text-pipeline.json` (or ask Claude to import it). It runs daily at 03:00 once activated, and has a manual trigger for testing.

## Admin keys

→ / A approve · ← / X reject, then 1–7 reason chips and Enter · E edit lines · R three new punchline options · N note · T Turkish · D details · S skip · U undo last.

Every decision is stored in `feedback`. Approvals raise a layout's score, rejections lower it, and the next runs deal high-scoring layouts more often (unproven ones still get explored). The writer and critic also read your latest decisions, reasons and notes as prompt memory.
