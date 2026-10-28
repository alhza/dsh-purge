import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runAll } from "./lib/harness.mjs";
import { PLUGIN_ROOT, readLiveInject, readShippedInject } from "./lib/inject.mjs";
import { driftReport } from "./lib/policy-drift.mjs";
import { renderReport } from "./report.mjs";
import { assembledSuite } from "./tests/assembled.mjs";
import { surfaceSuite } from "./tests/surface.mjs";
import { toolGateSuite } from "./tests/tool-gate.mjs";

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex").slice(0, 16);
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const pkg = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "package.json"), "utf8"));

function hostVersion() {
  const candidates = [
    path.join(os.homedir(), "AppData", "Local", "Programs", "DeepSeek Harness", "resources", "app", "dsh", "package.json"),
    path.join(process.env.LOCALAPPDATA || "", "Programs", "DeepSeek Harness", "resources", "app", "dsh", "package.json"),
  ];
  for (const fp of candidates) {
    try {
      return JSON.parse(fs.readFileSync(fp, "utf8")).version || "unknown";
    } catch {
      /* 试下一个 */
    }
  }
  return "unknown";
}

const shipped = readShippedInject();
const live = readLiveInject();
const rows = await runAll([assembledSuite, toolGateSuite, surfaceSuite]);
const drift = driftReport(shipped, live.text);

const byId = (id) => rows.find((r) => r.id === id);
const assembledRows = rows.filter((r) => r.suite === "assembled");
const i1 = { pass: assembledRows.filter((r) => r.status === "pass").length, total: assembledRows.length };
const i3Parts = [byId("gate.denies-by-contract")?.status === "pass", byId("gate.allows-unscoped")?.status === "pass"];
const i3 = { pass: i3Parts.filter(Boolean).length, total: i3Parts.length };
const surfaceRows = rows.filter((r) => r.suite === "surface");
const surface = { pass: surfaceRows.filter((r) => r.status === "pass").length, total: surfaceRows.length };
const surprises = rows.filter((r) => !r.predicted);

const meta = {
  at: new Date().toISOString(),
  pluginVersion: pkg.version,
  dshTarget: pkg.dshTarget || "unknown",
  hostVersion: hostVersion(),
  node: process.version,
  shippedBytes: Buffer.byteLength(shipped),
  shippedSha: sha(shipped),
  livePath: live.path,
  liveBytes: Buffer.byteLength(live.text),
  liveSha: sha(live.text),
};

const run = { meta, rows, drift, metrics: { i1, i3, surface } };
const outDir = path.join(PLUGIN_ROOT, "bench", "runs", stamp());
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "results.json"), `${JSON.stringify(run, null, 2)}\n`, "utf8");
const report = renderReport(run);
fs.writeFileSync(path.join(outDir, "report.md"), `${report}\n`, "utf8");

console.log(report);
console.log(`\nresults: ${path.join(outDir, "results.json")}`);
console.log(`report : ${path.join(outDir, "report.md")}`);
console.log(`surprises: ${surprises.length}`);
process.exit(surprises.length === 0 ? 0 : 1);
