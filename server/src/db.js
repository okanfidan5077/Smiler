// Supabase access for the service (service-role key: bypasses RLS; never leaves this machine).

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { repoRoot, need } from "./env.js";

export const db = createClient(need("SUPABASE_URL"), need("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

export function must({ data, error }, what) {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
}

const labJSON = (p) => JSON.parse(fs.readFileSync(path.join(repoRoot, "meme-lab", p), "utf8"));

// The pipeline catalog from Supabase (so edits in the database take effect), plus layout scores
// learned from approvals. Brands stay in meme-lab/data/brands.json.
export async function loadCatalog() {
  const [sectors, mechanics, layouts, problems, scores] = await Promise.all([
    db.from("sectors").select("id, name").eq("active", true),
    db.from("mechanics").select("name, shape, example").eq("active", true),
    db.from("layouts").select("name, format, layout").eq("active", true),
    db.from("problems").select("sector_id, description"),
    db.from("layout_scores").select("name, score, up, down"),
  ]);
  const sectorRows = must(sectors, "sectors");
  const sectorName = new Map(sectorRows.map((s) => [s.id, s.name]));
  const problemBank = {};
  for (const p of must(problems, "problems")) (problemBank[sectorName.get(p.sector_id)] ??= []).push(p.description);
  return {
    catalog: {
      sectors: sectorRows.map((s) => s.name),
      mechanics: must(mechanics, "mechanics"),
      formats: must(layouts, "layouts"),
      problemBank,
      brands: labJSON("data/brands.json"),
    },
    // score drives which proven layouts get dealt; rated (any up or down) separates proven from untried.
    layoutStats: new Map(must(scores, "layout_scores").map((s) => [s.name, { score: Number(s.score), rated: Number(s.up) + Number(s.down) > 0 }])),
  };
}

// Prompt memory for writer and critic: meme-lab's rated examples first, then the latest admin
// decisions (approvals with any edits, rejections with reasons and notes). The prompts read the
// last 15 of each list, so fresh decisions push out the old lab ratings over time.
export async function loadPromptFeedback() {
  const base = labJSON("data/feedback.json");
  const rows = must(
    await db
      .from("feedback")
      .select("meme_id, decision, reasons, note, edited, created_at, memes(format, template, panels(position, speaker, line, scene))")
      .eq("stage", "text")
      .order("created_at", { ascending: false })
      .limit(200),
    "feedback",
  );
  const seen = new Set();
  const latest = rows.filter((r) => !seen.has(r.meme_id) && seen.add(r.meme_id)).reverse();
  const entry = (r) => ({
    id: r.meme_id,
    format: r.memes?.format,
    template: r.memes?.template,
    panels: r.edited?.panels ?? (r.memes?.panels ?? []).sort((a, b) => a.position - b.position),
    reasons: r.reasons ?? [],
    note: r.note ?? "",
  });
  return {
    liked: [...base.liked, ...latest.filter((r) => r.decision === "approve").map(entry)],
    rejected: [...base.rejected, ...latest.filter((r) => r.decision === "reject").map(entry)],
  };
}
