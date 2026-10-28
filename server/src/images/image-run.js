// One image run: approved jokes (status text_approved) -> Gemma art direction (with blueprints and
// the editor's image notes) -> unload Gemma -> Qwen draws (draw.js: cast sheet + panels for
// multi-image memes) -> JPEG -> Supabase Storage -> meme_images, status images_ready (the admin
// page's image queue). ComfyUI's memory is freed at the end so the next text run has the GPU.

import crypto from "node:crypto";
import { db, must, loadImageNotes } from "../db.js";
import { loadConfig } from "../text-run.js";
import { artDirect, imageCount } from "./art-director.js";
import { comfyUp, freeMemory } from "./comfy.js";
import { drawJobs } from "./draw.js";
import { placeLabels } from "./labels.js";
import { MODELS } from "./workflows.js";
import { STYLE } from "./style.js";
import { toJpeg } from "./jpeg.js";

async function unloadLlm() {
  const base = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const models = new Set(Object.values(loadConfig()).filter((r) => r?.provider === "ollama").map((r) => r.model));
  for (const model of models) await fetch(`${base}/api/generate`, { method: "POST", body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => {});
}

// Removes a meme's previous images (a redraw replaces them).
async function clearImages(memeId) {
  const old = must(await db.from("meme_images").select("path").eq("meme_id", memeId), "old images");
  if (old.length) await db.storage.from("memes").remove(old.map((o) => o.path));
  must(await db.from("meme_images").delete().eq("meme_id", memeId), "delete old images");
}

async function upload(memeId, png, name) {
  const { jpeg, width, height } = toJpeg(png);
  const path = `${memeId}/${name}-${crypto.randomUUID()}.jpg`;
  const up = await db.storage.from("memes").upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
  if (up.error) throw new Error(`storage upload: ${up.error.message}`);
  return { path, url: db.storage.from("memes").getPublicUrl(path).data.publicUrl, width, height };
}

// ids: specific memes (redraws from the admin page); otherwise the oldest `limit` approved jokes.
export async function runImages({ limit = 6, ids = [], log = () => {} } = {}) {
  if (!(await comfyUp())) throw new Error("ComfyUI is not running on 127.0.0.1:8188 (start-review.cmd starts it)");
  const fields = "id, format, layout, template, sector, premise, panels(position, speaker, line, scene)";
  const memes = must(
    ids.length
      ? await db.from("memes").select(fields).in("id", ids)
      : await db.from("memes").select(fields).eq("status", "text_approved").order("created_at", { ascending: true }).limit(limit),
    "approved memes",
  );
  if (!memes.length) return { drawn: 0, images: 0, errors: [] };
  const templates = must(await db.from("layouts").select("name, composition, anchors").not("composition", "is", null), "blueprints");
  const blueprints = new Map(templates.map((l) => [l.name, l.composition]));
  const anchorsOf = new Map(templates.map((l) => [l.name, l.anchors]));
  const imageNotes = await loadImageNotes();

  const [run] = must(await db.from("generation_runs").insert({ kind: "image", config: { model: MODELS, style: STYLE }, params: { limit, ids } }).select("id"), "create run");
  const t0 = Date.now();
  const errors = [];
  const jobs = [];
  try {
    // 1. Art direction with Gemma, then free the GPU for Qwen.
    const writer = loadConfig().writer;
    for (const m of memes) {
      try {
        const comp = blueprints.get(m.layout) ?? null;
        const art = await artDirect(writer, m, comp, imageNotes.forMeme(m.id));
        // Recast templates: where each label sits on the picture (drawn by the app, not the model).
        if (m.format === "recast_template") art.labels = await placeLabels(writer, m, anchorsOf.get(m.layout));
        jobs.push({ meme: m, art, seed: Math.floor(Math.random() * 2 ** 31) });
        log(`art ${m.layout} (${imageCount(m, comp)} image${imageCount(m, comp) > 1 ? "s" : ""})\n`);
      } catch (err) {
        errors.push({ meme: m.id, step: "art", message: err.message });
      }
    }
    await unloadLlm();

    // 2. Draw.
    await drawJobs(jobs, log);
    for (const j of jobs.filter((j) => j.failed)) errors.push({ meme: j.meme.id, ...j.error });

    // 3. Upload and hand over to the image queue. The cast sheet is kept with the art direction:
    // it is the start of a character library for reuse.
    let drawn = 0, images = 0;
    for (const j of jobs.filter((j) => !j.failed)) {
      try {
        await clearImages(j.meme.id);
        const art = { ...j.art };
        if (j.castPng) art.cast_sheet_url = (await upload(j.meme.id, j.castPng, "cast")).url;
        must(await db.from("memes").update({ art }).eq("id", j.meme.id), "store art");
        const multi = j.art.images.length > 1;
        for (const [k, png] of j.pngs.entries()) {
          const f = await upload(j.meme.id, png, `panel${k + 1}`);
          must(
            await db.from("meme_images").insert({
              meme_id: j.meme.id, position: k + 1, url: f.url, path: f.path, prompt: j.art.images[k].prompt,
              seed: j.seed + (multi ? k + 1 : 0), model: multi ? MODELS.qwenEdit : MODELS.qwenT2I, width: f.width, height: f.height,
            }),
            "store image",
          );
          images++;
        }
        must(await db.from("memes").update({ status: "images_ready" }).eq("id", j.meme.id), "status images_ready");
        drawn++;
      } catch (err) {
        errors.push({ meme: j.meme.id, step: "upload", message: err.message });
      }
    }
    const stats = { memes: memes.length, drawn, images, seconds: Math.round((Date.now() - t0) / 1000) };
    must(await db.from("generation_runs").update({ status: "done", stats, errors, finished_at: new Date().toISOString() }).eq("id", run.id), "finish run");
    return { run_id: run.id, ...stats, errors };
  } catch (err) {
    await db.from("generation_runs").update({ status: "failed", errors: [...errors, { message: err.message }], finished_at: new Date().toISOString() }).eq("id", run.id);
    throw err;
  } finally {
    await freeMemory();
  }
}
