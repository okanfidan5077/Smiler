// The series' look. No style references yet (user: "go with what we have and improve on the fly"),
// so this is a deliberate default: clean newspaper-comic cartoon. Change STYLE here to restyle
// everything; keep it free of artist names and copyrighted characters.

export const STYLE =
  "Flat 2D cartoon illustration in the style of a modern newspaper comic strip: clean bold black outlines, " +
  "simple flat colors with soft cel shading, expressive exaggerated faces and body language, slightly oversized heads, " +
  "uncluttered background with only the props the scene needs, bright friendly palette, single panel, centered composition.";

// Qwen-Image honors negative prompts (cfg 4). Text is shown by the app below the image, never in it.
export const NEGATIVE =
  "text, letters, words, numbers, captions, speech bubbles, thought bubbles, signs with writing, labels, logos, watermark, signature, " +
  "photograph, photorealistic, 3d render, realistic skin, blurry, deformed hands, extra fingers, extra limbs, distorted face, " +
  "white eyes without pupils, empty eye sockets, glowing eyes, multiple panels, comic grid, split screen, dividing line, diptych, border";

// Qwen-Image-Edit instruction for panels 2-4: same people and look, new moment.
export const EDIT_PREFIX =
  "Keep exactly the same characters (faces, hair, body shape, clothes and colors), the same art style and the same setting as in the image. " +
  "Redraw the scene so that it shows: ";
