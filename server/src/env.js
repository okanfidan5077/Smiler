// Loads the repo-root .env (git-ignored) and exposes required settings with clear errors.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const envFile = path.join(repoRoot, ".env");
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

export function need(name) {
  const value = process.env[name];
  if (!value || value.includes("your-")) {
    throw new Error(`${name} is not set. Copy .env.example to .env in ${repoRoot} and fill it in.`);
  }
  return value;
}

export const settings = {
  port: Number(process.env.SERVER_PORT ?? 8787),
  // Docker Desktop forwards host.docker.internal to the host's loopback, so n8n reaches a
  // loopback-bound service without exposing it to the network.
  host: process.env.SERVER_HOST ?? "127.0.0.1",
  config: process.env.PIPELINE_CONFIG ?? "gemma",
  translateTo: process.env.TRANSLATE_TO ?? "Turkish",
  adminOrigin: process.env.ADMIN_ORIGIN ?? "http://localhost:5173",
};
