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
3. images: one prompt per image, in order. Each prompt is self-contained: name each character with their full look from the cast sheet, what they are doing, their facial expression (exaggerated, cartoon-readable), where they stand, camera framing (wide, medium or close-up), and the key props. The image that carries the punchline must make the payoff obvious at a glance: push the key reaction to the extreme, like a totally blank stare, a jaw on the floor, a deeply bored eye-roll, or a smug grin, so the face alone tells the joke.
4. Framing: when the joke's payoff is a place, object or result (a missing building, a tiny cupcake, a collapsing shelf), frame the shot medium or wide so that payoff is large and clearly recognizable; never crop it to a sliver behind a big face. Keep every mood from the writer's scene notes and exaggerate it, never swap it for cheerfulness. When the payoff is something missing or removed, draw what remains so the absence reads instantly: the bare steel skeleton or concrete foundation of a removed building with one lonely doorframe still standing, an empty shelf with dust outlines of what was there, a wheel-less car on blocks. An empty lot or a plain wall reads as nothing. When the joke lives in the scene rather than on a face (the floors are gone, the room is chaos), draw the people small and full-body and let the scene fill most of the frame: wide shot, payoff dominant.
5. Calm versus chaos: when someone is calm, proud or oblivious while things go wrong around them, the chaos must fill at least half the image and be loud: several disasters at once, all typical of this job (a fire station: hoses spraying loose, alarm lights flashing, a truck on blocks, smoke; a warehouse: racks toppling like dominoes, boxes raining down, a forklift on its side). One small problem in a corner reads as nothing. Leave out big empty props (blank boards, empty walls) that steal space from the chaos.
6. Recurring characters: when someone appeared in an earlier panel, describe them again with exactly the same look from the cast sheet and give their position, so the illustrator can match them to the earlier panel (never replace them with unnamed bystanders). Each character's look should be distinctive at a glance (hair, build, clothing color), so no two characters could be confused.
7. Editor feedback: lessons_from_recent_image_reviews are notes the editor wrote about earlier drawings; apply them wherever they fit this meme. editor_notes_on_the_previous_drawing are about this exact meme and override everything else.

Every image is one continuous scene: place things with depth words ("behind him to the right", "in the background"), never with "left half / right half of the frame" or "split", which the illustrator draws as two separate panels.

Show emotions with concrete, drawable cues, never with abstract words:
- tired / exhausted: heavy-lidded half-closed eyes with dark circles, slumped shoulders, messy hair, yawning, propped up on elbows
- bored: chin resting on hand, eyes rolled up, flat mouth, slouching
- smug: one raised eyebrow, half-closed eyes, sly closed-mouth grin
- shocked: eyes wide with tiny pupils, jaw dropped, hands on cheeks
- panicked: sweat drops, wide eyes, gritted teeth, hands gripping hair
- confused: one eyebrow up, head tilted, finger scratching head
Never write "hollow eyes", "blank eyes", "empty eyes" or "dead eyes": the illustrator draws them as white eyes without pupils.

Rules: never ask for any written text, letters, numbers, signs, labels, screens with words, speech or thought bubbles; show meaning with objects, colors, icons and expressions instead (a red error icon, a towering stack of forms). Paper, sheets, screens and signs are always blank or show only simple shapes and colors; never describe what is printed or written on them, even if the joke mentions it (the caption under the picture carries the words). No real brands, logos, companies or real people. 40 to 90 words per prompt.

Recast meme templates come with a blueprint: one description per image. Follow the blueprint exactly: the same people or animals, positions, poses, gestures, facial expressions and framing. The joke works because readers recognize that composition, and the labels (shown under the image) say who stands for what. So never replace a character with the thing its label names: if a label is "AI software", the person stays a person; adapt only clothing and small props to the workplace. In recast prompts, refer to each character only by their visual role from the blueprint ("the young man", "his girlfriend", "the woman in the red dress"), never by a label or job title, and never add props that illustrate a label (no stacks of papers for "bugs"). Start every recast prompt with the exact number of people or animals, e.g. "Exactly three people:", and describe each one once. Never name the original meme or its people.`;

// Prompts that describe readable writing (quoted words, "printed instructions", "font", ...).
const WRITING = /["“][^"”]{3,}["”]|\b(printed|written|handwritten|lettering|font|reads|says|saying|titled|labeled|labelled|caption|headline)\b/i; // not "text": prompts often say "no text"

const EERIE_EYES = /\b(hollow|blank|empty|dead|vacant|lifeless|glazed[- ]over)\s+(eyes|stares?|gazes?|eyed)\b/gi;

// How many images a meme needs: recast templates follow their blueprint (one image per entry,
// usually one composition; the app lists the labels); singles one image; multi-panel memes one
// image per panel.
export const imageCount = (meme, composition) =>
  meme.format === "multi_panel" ? meme.panels.length : meme.format === "recast_template" ? Math.max(1, composition?.length ?? 1) : 1;

// composition: the layout's blueprint (layouts.composition), or null.
// notes: { this_meme: [...], recent: [...] } from the editor's image reviews (db.loadImageNotes).
export async function artDirect(role, meme, composition = null, notes = { this_meme: [], recent: [] }) {
  const panels = [...meme.panels].sort((a, b) => a.position - b.position);
  const brief = {
    format: meme.format,
    layout: meme.layout,
    template: meme.template || undefined,
    sector: meme.sector,
    joke: meme.premise,
    panels: panels.map((p) => ({ speaker: p.speaker, line: p.line, [notes.this_meme?.length ? "old_scene_notes" : "scene"]: p.scene })),
    images_needed: imageCount(meme, composition),
    ...(notes.recent?.length ? { lessons_from_recent_image_reviews: notes.recent } : {}),
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
  // A redraw request leads the brief: Gemma kept following the writer's scene when the editor's
  // note sat in the middle of the JSON (a "zoom out, only one floor left" note was ignored).
  const changeRequest = notes.this_meme?.length
    ? `EDITOR'S CHANGE REQUEST FOR THIS MEME. The editor saw the previous drawing and asks:\n${notes.this_meme.map((n) => `- ${n}`).join("\n")}\n` +
      `Design the images around this request. The old scene notes below are only background; where they conflict with the request, the request wins.\n\n`
    : "";
  const user = changeRequest + JSON.stringify(brief, null, 2);
  let { data } = await generateJSON({ ...role, temperature: 0.4 }, { system, user, schema, kind: "art-director" });
  // Text in images came back in a review (a vet's printed instructions). If a prompt still asks for
  // readable writing, ask once more with the offending prompts quoted.
  const texty = data.images.filter((im) => WRITING.test(im.prompt));
  if (texty.length) {
    const retry = `${user}\n\nYour previous prompts asked for readable writing, which the illustrator cannot draw: ${texty.map((im) => JSON.stringify(im.prompt)).join(" ")}\nRewrite all prompts so every paper, sheet, screen and sign is blank or shows only shapes and colors.`;
    ({ data } = await generateJSON({ ...role, temperature: 0.4 }, { system, user: retry, schema, kind: "art-director" }));
  }
  if (data.images.length < brief.images_needed) throw new Error(`art director returned ${data.images.length} of ${brief.images_needed} images`);
  // Safety net for the eye wording Qwen renders as pupil-less white eyes (user review: tired nurses
  // came out eerie).
  for (const im of data.images) im.prompt = im.prompt.replace(EERIE_EYES, "heavy-lidded, half-closed tired eyes with dark circles");
  return { ...data, blueprint: brief.blueprint ?? null, images: data.images.slice(0, brief.images_needed) };
}
