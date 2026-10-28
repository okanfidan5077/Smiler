// Art director: turns an approved meme's scene notes into image prompts. It fixes a cast sheet
// (exact looks) and a setting first, then writes one self-contained prompt per image, so the same
// people appear in every panel. Runs on the pipeline's writer model (Gemma) before any GPU image
// work; the caller unloads the LLM afterwards.

import { generateJSON } from "../../../meme-lab/src/llm.js";

const str = { type: "string" };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const schema = obj({
  cast: { type: "array", items: obj({ role: str, look: str }) },
  setting: str,
  images: { type: "array", items: obj({ prompt: str }) },
});

const system = `You are the art director of a cartoon meme series about workplace absurdities. An illustrator will draw each image from your prompt alone, without seeing the joke text. The joke's words are shown by the app under the picture, never inside it.

1. cast: every character who appears, by role, with a fixed look: age, build, hair, skin tone, clothing with colors, one distinctive trait. Be specific so the same person can be redrawn identically. Vary genders, ages and skin tones naturally across the cast.
2. setting: the one place where everything happens, with the few props the joke needs.
3. images: one prompt per image, in order. Each prompt is self-contained: name each character with their full look from the cast sheet, what they are doing, their facial expression (exaggerated, cartoon-readable), where they stand, camera framing (wide, medium or close-up), and the key props. The image that carries the punchline must make the payoff obvious at a glance.

Rules: never ask for any written text, letters, numbers, signs, labels, screens with words, speech or thought bubbles; show meaning with objects, colors, icons and expressions instead (a red error icon, a towering stack of forms). No real brands, logos, companies or real people. 40 to 90 words per prompt.

Recast meme templates come with a blueprint: one description per image. Follow the blueprint exactly: the same people or animals, positions, poses, gestures, facial expressions and framing. The joke works because readers recognize that composition, and the labels (shown under the image) say who stands for what. So never replace a character with the thing its label names: if a label is "AI software", the person stays a person; adapt only clothing and small props to the workplace. In recast prompts, refer to each character only by their visual role from the blueprint ("the young man", "his girlfriend", "the woman in the red dress"), never by a label or job title, and never add props that illustrate a label (no stacks of papers for "bugs"). Start every recast prompt with the exact number of people or animals, e.g. "Exactly three people:", and describe each one once. Never name the original meme or its people.`;

// How many images a meme needs: recast templates follow their blueprint (one image per entry,
// usually one composition; the app lists the labels); singles one image; multi-panel memes one
// image per panel.
export const imageCount = (meme, composition) =>
  meme.format === "multi_panel" ? meme.panels.length : meme.format === "recast_template" ? Math.max(1, composition?.length ?? 1) : 1;

// composition: the layout's blueprint (layouts.composition), or null.
export async function artDirect(role, meme, composition = null) {
  const panels = [...meme.panels].sort((a, b) => a.position - b.position);
  const brief = {
    format: meme.format,
    layout: meme.layout,
    template: meme.template || undefined,
    sector: meme.sector,
    joke: meme.premise,
    panels: panels.map((p) => ({ speaker: p.speaker, line: p.line, scene: p.scene })),
    images_needed: imageCount(meme, composition),
    ...(meme.format === "recast_template" && composition ? { blueprint: composition } : {}),
    note:
      meme.format === "recast_template"
        ? composition?.length > 1
          ? "One image per blueprint entry, in order. The panels above are the labels; when their count matches, panel N belongs to image N."
          : "One image of the whole composition from the blueprint; each panel above is a label placed on part of it."
        : meme.format === "single"
          ? "One image; the line is the caption under it."
          : "One image per panel, same cast and setting throughout.",
  };
  const { data } = await generateJSON({ ...role, temperature: 0.4 }, { system, user: JSON.stringify(brief, null, 2), schema, kind: "art-director" });
  if (data.images.length < brief.images_needed) throw new Error(`art director returned ${data.images.length} of ${brief.images_needed} images`);
  return { ...data, blueprint: brief.blueprint ?? null, images: data.images.slice(0, brief.images_needed) };
}
