// ComfyUI graphs in API format, rebuilt from the official templates bundled with ComfyUI 0.18
// (image_qwen_image.json, image_qwen_image_edit_2511.json), without the Lightning LoRAs:
// Qwen-Image 20 steps / cfg 4, Qwen-Image-Edit 40 steps / cfg 4, euler + simple, shift 3.1.

export const MODELS = {
  qwenT2I: "qwen_image_2512_fp8_e4m3fn.safetensors",
  qwenEdit: "qwen_image_edit_2511_fp8mixed.safetensors",
  qwenClip: "qwen_2.5_vl_7b_fp8_scaled.safetensors",
  qwenVae: "qwen_image_vae.safetensors",
  flux: "flux1-dev.safetensors",
};

const seedOr = (seed) => seed ?? Math.floor(Math.random() * 2 ** 32);

// Qwen-Image 2512 text-to-image. Unlike the old Flux setup, cfg 4 means the negative prompt works.
export function qwenText2Image({ prompt, negative, seed, width = 1328, height = 1328, steps = 20, cfg = 4 }) {
  return {
    unet: { class_type: "UNETLoader", inputs: { unet_name: MODELS.qwenT2I, weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: MODELS.qwenClip, type: "qwen_image", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: MODELS.qwenVae } },
    shift: { class_type: "ModelSamplingAuraFlow", inputs: { model: ["unet", 0], shift: 3.1 } },
    pos: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: prompt } },
    neg: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: negative } },
    latent: { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    sample: {
      class_type: "KSampler",
      inputs: { model: ["shift", 0], positive: ["pos", 0], negative: ["neg", 0], latent_image: ["latent", 0], seed: seedOr(seed), steps, cfg, sampler_name: "euler", scheduler: "simple", denoise: 1 },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["vae", 0] } },
    save: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: "smiler/qwen" } },
  };
}

// Qwen-Image-Edit 2511: draws a new panel from a reference image (panel 1), keeping characters,
// clothes and style. `image` is a name returned by uploadImage().
export function qwenEdit({ image, prompt, negative = "", seed, steps = 40, cfg = 4 }) {
  return {
    unet: { class_type: "UNETLoader", inputs: { unet_name: MODELS.qwenEdit, weight_dtype: "default" } },
    clip: { class_type: "CLIPLoader", inputs: { clip_name: MODELS.qwenClip, type: "qwen_image", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: MODELS.qwenVae } },
    shift: { class_type: "ModelSamplingAuraFlow", inputs: { model: ["unet", 0], shift: 3.1 } },
    norm: { class_type: "CFGNorm", inputs: { model: ["shift", 0], strength: 1 } },
    load: { class_type: "LoadImage", inputs: { image } },
    scale: { class_type: "FluxKontextImageScale", inputs: { image: ["load", 0] } },
    pos: { class_type: "TextEncodeQwenImageEditPlus", inputs: { clip: ["clip", 0], vae: ["vae", 0], image1: ["scale", 0], prompt } },
    neg: { class_type: "TextEncodeQwenImageEditPlus", inputs: { clip: ["clip", 0], vae: ["vae", 0], image1: ["scale", 0], prompt: negative } },
    posRef: { class_type: "FluxKontextMultiReferenceLatentMethod", inputs: { conditioning: ["pos", 0], reference_latents_method: "index_timestep_zero" } },
    negRef: { class_type: "FluxKontextMultiReferenceLatentMethod", inputs: { conditioning: ["neg", 0], reference_latents_method: "index_timestep_zero" } },
    latent: { class_type: "VAEEncode", inputs: { pixels: ["scale", 0], vae: ["vae", 0] } },
    sample: {
      class_type: "KSampler",
      inputs: { model: ["norm", 0], positive: ["posRef", 0], negative: ["negRef", 0], latent_image: ["latent", 0], seed: seedOr(seed), steps, cfg, sampler_name: "euler", scheduler: "simple", denoise: 1 },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["vae", 0] } },
    save: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: "smiler/qwen_edit" } },
  };
}

// The user's earlier FLUX.1 [dev] setup with its problems fixed: the style goes in the positive
// prompt (at cfg 1 the negative prompt is ignored), and every panel repeats the cast description
// (FLUX.1 dev has no reference-image input, so panels can still drift). Baseline for the bake-off.
export function fluxText2Image({ prompt, seed, width = 1024, height = 1024, steps = 28, guidance = 3.5 }) {
  return {
    unet: { class_type: "UNETLoader", inputs: { unet_name: MODELS.flux, weight_dtype: "default" } },
    clip: { class_type: "DualCLIPLoader", inputs: { clip_name1: "clip_l.safetensors", clip_name2: "t5xxl_fp16.safetensors", type: "flux", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    pos: { class_type: "CLIPTextEncode", inputs: { clip: ["clip", 0], text: prompt } },
    guide: { class_type: "FluxGuidance", inputs: { conditioning: ["pos", 0], guidance } },
    neg: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["pos", 0] } },
    latent: { class_type: "EmptySD3LatentImage", inputs: { width, height, batch_size: 1 } },
    sample: {
      class_type: "KSampler",
      inputs: { model: ["unet", 0], positive: ["guide", 0], negative: ["neg", 0], latent_image: ["latent", 0], seed: seedOr(seed), steps, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1 },
    },
    decode: { class_type: "VAEDecode", inputs: { samples: ["sample", 0], vae: ["vae", 0] } },
    save: { class_type: "SaveImage", inputs: { images: ["decode", 0], filename_prefix: "smiler/flux" } },
  };
}
