// PNG -> JPEG (quality 88) with Pillow from ComfyUI's Python, so no image library is needed in
// Node. A 1328px panel goes from about 1.5 MB to about 250 KB, which keeps Supabase Storage small.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";

const python = () => process.env.COMFY_PYTHON ?? "C:/AI_TOOLS/ComfyUI/ComfyUI/venv/Scripts/python.exe";

export function toJpeg(png) {
  const base = path.join(os.tmpdir(), `smiler-${crypto.randomUUID()}`);
  fs.writeFileSync(`${base}.png`, png);
  try {
    const r = spawnSync(python(), ["-c", `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
im.save(sys.argv[2], "JPEG", quality=88, optimize=True)
print(im.width, im.height)
`, `${base}.png`, `${base}.jpg`], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`JPEG conversion failed: ${r.stderr || r.error}`);
    const [width, height] = r.stdout.trim().split(" ").map(Number);
    return { jpeg: fs.readFileSync(`${base}.jpg`), width, height };
  } finally {
    fs.rmSync(`${base}.png`, { force: true });
    fs.rmSync(`${base}.jpg`, { force: true });
  }
}
