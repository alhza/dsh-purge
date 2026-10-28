import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function readShippedInject() {
  return fs.readFileSync(path.join(PLUGIN_ROOT, "lib", "default-prompt-inject.zh.md"), "utf8");
}

export function readLiveInject() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  const fp = path.join(home, "prompt-inject.md");
  try {
    return { path: fp, text: fs.readFileSync(fp, "utf8") };
  } catch {
    return { path: fp, text: "" };
  }
}

/**
 * 取 payload 的第一行“有效标识”做去重计数。
 * 跳过空行、尖括号信封、Markdown 标题，剩下的第一行就是这份 payload 的指纹行。
 */
export function injectNeedle(text) {
  const line = String(text || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s && !s.startsWith("<") && !s.startsWith("#"));
  return (line || String(text || "").trim()).slice(0, 80);
}
