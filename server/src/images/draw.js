// Draws art-directed memes with Qwen. Shared by the service (image-run.js) and the bake-off script.
//
// Single-image memes: Qwen-Image draws the image from its prompt.
// Multi-image memes: Qwen-Image first draws a cast sheet (every character side by side, full body,
// plain background), then Qwen-Image-Edit draws every panel from it, plus panel 1 and the previous
// panel for setting and continuity. A character first seen in panel 2 still looks right in panel 3,
// and all panels share one look and size. (User review 2026-10-29: "in the last image the shocked
// guys should be the electrician and the drywall guy".)
// Work is grouped by model (all Qwen-Image jobs, then all edits) so each model loads once.

import { render, uploadImage } from "./comfy.js";
import { qwenText2Image, qwenEdit } from "./workflows.js";
import { STYLE, NEGATIVE, EDIT_PREFIX } from "./style.js";

const MAX_CAST = 4;

export function castSheetPrompt(cast) {
  const people = cast.slice(0, MAX_CAST);
  return (
    `${STYLE} Character lineup sheet: exactly ${people.length} character${people.length > 1 ? "s" : ""} standing side by side in one row, ` +
    `full body from head to shoes, facing the viewer, evenly spaced and not overlapping, neutral relaxed expressions, plain light grey background, nothing else in the picture. ` +
    `From left to right: ${people.map((c, i) => `${i + 1}. ${c.look}`).join("; ")}.`
  );
}

const castIntro = (cast) =>
  `Reference image 1 is the cast lineup; from left to right: ${cast.slice(0, MAX_CAST).map((c, i) => `${i + 1}. the ${c.role}`).join(", ")}. ` +
  `Reference image 2, if present, is the previous panel of this comic (same setting). `;

// Panel k (0-based) of a multi-image meme: the cast sheet and the previous panel. A third
// reference (panel 1) made Qwen-Edit blend characters' features in testing, so two at most.
const refsFor = (k, castRef, panelRefs) => [castRef, panelRefs[k - 1]].filter(Boolean);

// jobs: [{ meme, art, seed }]. Sets j.pngs (one PNG per art.images entry) and j.castPng, or
// j.failed + j.error. Returns nothing; callers store or save the PNGs.
export async function drawJobs(jobs, log = () => {}) {
  const multi = (j) => j.art.images.length > 1;

  // 1. Qwen-Image: single images, and cast sheets for multi-image memes.
  for (const j of jobs) {
    j.pngs = [];
    try {
      if (multi(j)) {
        [j.castPng] = await render(qwenText2Image({ prompt: castSheetPrompt(j.art.cast), negative: NEGATIVE, seed: j.seed }));
        log(`cast sheet ${j.meme.layout} (${Math.min(j.art.cast.length, MAX_CAST)} characters)\n`);
      } else {
        [j.pngs[0]] = await render(qwenText2Image({ prompt: `${STYLE} ${j.art.images[0].prompt}`, negative: NEGATIVE, seed: j.seed }));
        log(`drew ${j.meme.layout} 1/1\n`);
      }
    } catch (err) {
      Object.assign(j, { failed: true, error: { step: multi(j) ? "cast sheet" : "image 1", message: err.message } });
    }
  }

  // 2. Qwen-Image-Edit: every panel of multi-image memes, from the cast sheet and earlier panels.
  for (const j of jobs.filter((j) => !j.failed && multi(j))) {
    try {
      const castRef = await uploadImage(j.castPng, `smiler_cast_${j.meme.id}.png`);
      const panelRefs = [];
      for (let k = 0; k < j.art.images.length; k++) {
        const images = refsFor(k, castRef, panelRefs);
        const prompt = `${castIntro(j.art.cast)}${EDIT_PREFIX}${j.art.images[k].prompt}`;
        [j.pngs[k]] = await render(qwenEdit({ images, prompt, negative: NEGATIVE, seed: j.seed + k + 1 }));
        panelRefs[k] = await uploadImage(j.pngs[k], `smiler_ref_${j.meme.id}_${k + 1}.png`);
        log(`drew ${j.meme.layout} ${k + 1}/${j.art.images.length}\n`);
      }
    } catch (err) {
      Object.assign(j, { failed: true, error: { step: "panels", message: err.message } });
    }
  }
}
