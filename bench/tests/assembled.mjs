import { rewritePromptAssembly } from "../../lib/identity.js";
import { FIXTURES, buildFixture } from "../lib/fixtures.mjs";
import { INVARIANTS } from "../invariants.mjs";
import { injectNeedle, readLiveInject, readShippedInject } from "../lib/inject.mjs";
import { assert, suite } from "../lib/harness.mjs";

const shipped = readShippedInject();
const cases = FIXTURES.map((f) => ({ kind: f.name, fixture: f, inject: shipped }));

// 本机真实 override 也跑一遍：链路最终服务的是它，不是 shipped default。
const live = readLiveInject();
if (live.text.trim()) {
  cases.push({ kind: "live", fixture: buildFixture("live"), inject: live.text, path: live.path });
}

const tests = [];
for (const c of cases) {
  let out = null;
  let joined = "";
  let hostJoined = "";
  let error = "";
  try {
    out = rewritePromptAssembly(c.fixture.assembled, c.inject, {
      capabilityProtocol: true,
      dropMnemon: true,
      context: c.fixture.context,
    });
    const texts = out.sections.map((s) => (typeof s.text === "string" ? s.text : ""));
    joined = texts.join("\n\n");
    // 只扫“宿主段”：payload 自己可能引用拒绝话术当例子，不能算残留。
    const needle = injectNeedle(c.inject);
    const hostTexts = out.sections
      .filter((s) => {
        const t = typeof s.text === "string" ? s.text : "";
        return !needle || !t.includes(needle);
      })
      .map((s) => (typeof s.text === "string" ? s.text : ""));
    hostJoined = hostTexts.join("\n\n");
  } catch (e) {
    error = String(e && e.message ? e.message : e);
  }
  for (const inv of INVARIANTS) {
    tests.push({
      id: `${c.kind}/${inv.id}`,
      expect: "pass",
      run() {
        assert(!error, `rewrite failed: ${error}`);
        const r = inv.check({ out, joined, hostJoined, inject: c.inject, fixture: c.fixture });
        assert(r.ok, r.detail);
      },
    });
  }
}

export const assembledSuite = suite("assembled", tests);
