import fs from "node:fs";
import path from "node:path";
import { PLUGIN_ROOT } from "../lib/inject.mjs";
import { assert, suite } from "../lib/harness.mjs";

const read = (f) => fs.readFileSync(path.join(PLUGIN_ROOT, f), "utf8");

export const surfaceSuite = suite("surface", [
  {
    id: "own-servers.route-removed",
    expect: "pass",
    run() {
      const idx = read("lib/index.js");
      assert(!idx.includes("/dsh-purge/own-servers"), "dead route still registered");
      assert(!idx.includes("writeAllowText"), "dead writer still imported");
    },
  },
  {
    id: "own-servers.ui-removed",
    expect: "pass",
    run() {
      const cl = read("client.js");
      assert(!cl.includes("own-servers") && !cl.includes("ownServers"), "dead UI still present");
    },
  },
  {
    id: "own-servers.writer-removed",
    expect: "pass",
    run() {
      const net = read("lib/net-scope.js");
      const id = read("lib/identity.js");
      assert(!net.includes("writeAllowText") && !net.includes("allowFilePath"), "allow-list machinery still present");
      assert(!net.includes("ownServerNote"), "ownServerNote still exported");
      assert(!id.includes("OWN_SERVER_MARK") && !id.includes("withOwnServers"), "own-server injection scaffolding still present");
    },
  },
  {
    id: "own-servers.docs-removed",
    expect: "pass",
    run() {
      const shots = read("screenshots.json");
      assert(!shots.includes("own-servers"), "dead screenshots still listed");
    },
  },
  {
    id: "cheat.gate-removed",
    expect: "pass",
    run() {
      const net = read("lib/net-scope.js");
      assert(!net.includes("CHEAT_STRONG") && !net.includes("isCheatTask"), "cheat gate still present");
      assert(!net.includes('taskHit("cheat"'), "cheat branch still wired");
    },
  },
  {
    id: "gate.no-dead-result-shape",
    expect: "pass",
    run() {
      assert(!read("lib/net-scope.js").includes("denyToolResult"), "old tool-result denial shape still present");
    },
  },
  {
    id: "payload.cheat-aligned",
    expect: "pass",
    run() {
      const zh = read("lib/default-prompt-inject.zh.md");
      const en = read("lib/default-prompt-inject.en.md");
      assert(!/外挂[^\n]{0,80}禁止/.test(zh), "zh payload still forbids cheats");
      assert(!/game cheat[^\n]{0,80}forbid/i.test(en), "en payload still forbids cheats");
      assert(!/硬拦|hard[- ]block/i.test(zh + en), "payload still claims a hard gate");
    },
  },
]);
