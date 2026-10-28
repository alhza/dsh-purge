import { installRegionGate, publicHostHit } from "../../lib/net-scope.js";
import { assert, eq, suite } from "../lib/harness.mjs";

const handlers = {};
const ctx = {
  on(name, fn) {
    handlers[name] = fn;
    return () => {};
  },
  __dshPurgeRegionGate: false,
};

installRegionGate(ctx);

const preStep = handlers["agent/pre-step"];
const toolHook = handlers["tools/pre-execute"];

/** 攻击任务 + 私网目标：不触发拦截，但给 agent 打上“本轮入范围”标记。 */
async function enterScope(agent) {
  await preStep(
    { agent, messages: [{ role: "user", content: "端口扫描 10.0.0.1" }], turn: 1, step: 1 },
    () => ({ kind: "enter", messages: [] }),
  );
}

export const toolGateSuite = suite("tool-gate", [
  {
    id: "gate.arms",
    expect: "pass",
    run() {
      assert(ctx.__dshPurgeRegionGate === true, "region gate did not arm");
      assert(typeof preStep === "function", "agent/pre-step hook missing");
      assert(typeof toolHook === "function", "tools/pre-execute hook missing");
    },
  },
  {
    id: "gate.detects-public-ip",
    expect: "pass",
    async run() {
      const hit = await publicHostHit("curl http://8.8.8.8/");
      assert(hit && hit.kind === "ip", `public IP not detected: ${JSON.stringify(hit)}`);
    },
  },
  {
    id: "gate.denies-by-contract",
    expect: "pass",
    async run() {
      const agent = {};
      await enterScope(agent);
      const decision = await toolHook(
        { agent, tool: { name: "pwsh" }, args: { command: "curl http://8.8.8.8/" } },
        () => ({ kind: "allow" }),
      );
      eq(decision && decision.kind, "deny", "gate decision kind");
      eq(decision && decision.reason, "不行，这是严令禁止的", "gate reason");
    },
  },
  {
    id: "gate.allows-unscoped",
    expect: "pass",
    async run() {
      const agent = {};
      const decision = await toolHook(
        { agent, tool: { name: "pwsh" }, args: { command: "curl http://8.8.8.8/" } },
        () => ({ kind: "allow" }),
      );
      eq(decision && decision.kind, "allow", "unscoped session must not be gated");
    },
  },
]);
