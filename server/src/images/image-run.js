// One image run: approved jokes (status text_approved) -> Gemma art direction -> unload Gemma ->
// Qwen-Image draws each meme's first image -> Qwen-Image-Edit draws the rest from it -> JPEG ->
// Supabase Storage -> meme_images, status images_ready (the admin page's image queue).
// Work is grouped by model (all first images, then all edits) so each model loads once, and
// ComfyUI's memory is freed at the end so the next text run has the GPU.

import crypto from "node:crypto";
import { db, must } from "../db.js";
import { loadConfig } from "../text-run.js";
import { artDirect, imageCount } from "./art-director.js";
import { comfyUp, render, uploadImage, freeMemory } from "./comfy.js";
import { qwenText2Image, qwenEdit, MODELS } from "./workflows.js";
import { STYLE, NEGATIVE, EDIT_PREFIX } from "./style.js";
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

async function store(memeId, position, png, prompt, seed, model) {
  const { jpeg, width, height } = toJpeg(png);
  const path = `${memeId}/${crypto.randomUUID()}.jpg`;
  const up = await db.storage.from("memes").upload(path, jpeg, { contentType: "image/jpeg", upsert: false });
  if (up.error) throw new Error(`storage upload: ${up.error.message}`);
  const url = db.storage.from("memes").getPublicUrl(path).data.publicUrl;
  must(await db.from("meme_images").insert({ meme_id: memeId, position, url, path, prompt, seed, model, width, height }), "store image");
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
  const blueprints = new Map(must(await db.from("layouts").select("name, composition").not("composition", "is", null), "blueprints").map((l) => [l.name, l.composition]));

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
        const art = await artDirect(writer, m, comp);
        must(await db.from("memes").update({ art }).eq("id", m.id), "store art");
        jobs.push({ meme: m, art, seed: Math.floor(Math.random() * 2 ** 31), pngs: [] });
        log(`art ${m.layout} (${imageCount(m, comp)} image${imageCount(m, comp) > 1 ? "s" : ""})\n`);
      } catch (err) {
        errors.push({ meme: m.id, step: "art", message: err.message });
      }
    }
    await unloadLlm();

    // 2. First images (Qwen-Image), then later panels from them (Qwen-Image-Edit).
    for (const j of jobs) {
      try {
        [j.pngs[0]] = await render(qwenText2Image({ prompt: `${STYLE} ${j.art.images[0].prompt}`, negative: NEGATIVE, seed: j.seed }));
        log(`drew ${j.meme.layout} 1/${j.art.images.length}\n`);
      } catch (err) {
        j.failed = true;
        errors.push({ meme: j.meme.id, step: "image 1", message: err.message });
      }
    }
    for (const j of jobs.filter((j) => !j.failed && j.art.images.length > 1)) {
      try {
        const ref = await uploadImage(j.pngs[0], `smiler_ref_${j.meme.id}.png`);
        for (let k = 1; k < j.art.images.length; k++) {
          [j.pngs[k]] = await render(qwenEdit({ image: ref, prompt: `${EDIT_PREFIX}${j.art.images[k].prompt}`, negative: NEGATIVE, seed: j.seed + k }));
          log(`drew ${j.meme.layout} ${k + 1}/${j.art.images.length}\n`);
        }
      } catch (err) {
        j.failed = true;
        errors.push({ meme: j.meme.id, step: "later panels", message: err.message });
      }
    }

    // 3. Upload and hand over to the image queue.
    let drawn = 0, images = 0;
    for (const j of jobs.filter((j) => !j.failed)) {
      try {
        await clearImages(j.meme.id);
        for (const [k, png] of j.pngs.entries()) {
          await store(j.meme.id, k + 1, png, j.art.images[k].prompt, j.seed + k, k === 0 ? MODELS.qwenT2I : MODELS.qwenEdit);
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
