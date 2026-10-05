// loop-breaker 自测：不启动宿主，直接验证判定逻辑与拦截行为。
import {
  detectDegenerate,
  isDegenerateMessage,
  normalizeLoopConfig,
  installLoopBreaker,
  collectInterruptedMessages,
  wrapSessionLoopFilter,
  tailRepeat,
  deltaOf,
} from "file:///D:/Code/DeepSeek/lib/loop-breaker.js";

let pass = 0;
let fail = 0;
const t = (name, fn) => {
  try {
    fn();
    pass += 1;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    fail += 1;
    console.log(`  FAIL  ${name}\n          ${String(e?.message || e).slice(0, 160)}`);
  }
};
const ok = (v, m) => { if (!v) throw new Error(m || "断言失败"); };
const eq = (a, b, m) => { if (a !== b) throw new Error(m || `期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`); };

console.log("=== 1. 配置归一化 ===");
t("默认启用", () => ok(normalizeLoopConfig().enabled));
t("enabled=false 保留", () => eq(normalizeLoopConfig({ enabled: false }).enabled, false));
t("maxTripsPerTurn 钳到 0..10", () => eq(normalizeLoopConfig({ maxTripsPerTurn: 999 }).maxTripsPerTurn, 10));
t("负值钳到 0", () => eq(normalizeLoopConfig({ maxTripsPerTurn: -5 }).maxTripsPerTurn, 0));
t("非法值回落默认", () => eq(normalizeLoopConfig({ minChars: "abc" }).minChars, 180));
t("breakText 空串回落默认", () => ok(normalizeLoopConfig({ breakText: "  " }).breakText.includes("DONE")));

console.log("\n=== 2. 退化判定 ===");
const metaLoop = "让我写。好的，让我写。接下来让我写。现在开始让我写。继续写，让我写。".repeat(8);
t("元指令自循环判命中", () => {
  const v = detectDegenerate(metaLoop);
  ok(v.hit, `未命中: ${JSON.stringify(v)}`);
  ok(
    v.reasons.some((r) => r.startsWith("meta=") || r.startsWith("cycle=")),
    `缺证据: ${v.reasons}`,
  );
});

const realCode = [
  "```python",
  "def guarded_generate(messages, prev, gen):",
  "    out = gen(messages, no_repeat_ngram_size=4)",
  "    if is_loop(out, prev):",
  "        return guarded_generate(messages, prev, gen)",
  "    return out",
  "```",
  "上面这段在检测到退化时丢弃输出、升温度重试。",
].join("\n").repeat(3);
t("真实交付物不误伤", () => {
  const v = detectDegenerate(realCode);
  ok(!v.hit, `误伤: ${JSON.stringify(v)}`);
});

const prose = [
  "角色在雨里站了很久，衣服贴在身上，水顺着发梢往下淌。她没有回头，只是把手里那把刀换了个握法，刀锋朝下。",
  "远处的灯一盏盏灭掉，巷子里只剩下雨声和呼吸。脚步声从拐角传过来，不紧不慢，像是早就知道她在这里。",
  "她数着那声音，一步，两步，三步。第三声落下的时候，她把重心压到后脚，肩胛骨微微绷紧，刀尖抬了半寸。",
  "来的人停在离她五步远的地方，伞面压得很低，看不清脸。雨水从伞骨上滑下来，在地上砸出一小片白雾。",
  "「你等很久了。」那人开口，声音比雨还冷。她没答话，只把刀刃上的一滴水抖掉，落在地上，碎开。",
  "两人之间隔着五步雨幕，谁都没再往前。巷子尽头的灯又灭了一盏，黑暗顺着墙根漫上来，把影子拉得很长。",
  "她先动的。刀锋切开雨线的瞬间，伞也抬了起来，底下是一双没有情绪的眼睛。两样东西在半空中撞上，声音很闷。",
  "火星溅出去，掉进积水里，一明一灭。她借着这股力侧身滑开半步，鞋底在水里划出一道弧，水花扑到墙上。",
  "那人没有追，只是把伞往后收了一点，露出半张脸和一道旧疤。疤从眉骨斜到下颌，在暗处看着像一条裂缝。",
  "「你手抖了。」他说。她低头看自己的手，虎口确实在颤，刀柄上那圈缠布已经被雨水泡透，滑得握不稳。",
  "她把刀换到左手，右手在裤缝上擦了两下，重新握住。这一次她先开口：「你是谁派来的。」对方笑了一下，没回答。",
  "雨忽然大了，砸在伞面上像有人在上面撒石子。两人隔着那片雨声站着，谁也没动，等对方先露出破绽。",
].join("");
t("正常长文不误伤", () => {
  const v = detectDegenerate(prose);
  ok(!v.hit, `误伤: ${JSON.stringify(v)}`);
  ok(v.len > 400, `样本过短: ${v.len}`);
});

t("整段复读会被判退化", () => {
  const v = detectDegenerate(prose.repeat(4));
  ok(v.hit, `复读未命中: ${JSON.stringify(v)}`);
  ok(v.reasons.some((r) => r.startsWith("self=")), `缺 self 证据: ${v.reasons}`);
});

t("短文本不判", () => {
  const v = detectDegenerate("让我写。好的。");
  ok(!v.hit, "短文本不应命中");
  eq(v.len, 7);
});

t("阈值可调：收紧后长文也能命中", () => {
  const v = detectDegenerate(metaLoop, { metaRatio: 0.02 });
  ok(v.hit, "收紧阈值后应命中");
});

t("重复句自相似可单独触发", () => {
  const same = "这句话会原样再出现一次，用来测自相似度。".repeat(12);
  // 关掉周期检测与元话语两条路径，单独检验 self 这条路。
  const v = detectDegenerate(same, { metaRatio: 0.9, cycleRepeats: 50 });
  ok(v.hit, `自相似未命中: ${JSON.stringify(v)}`);
  ok(v.reasons.some((r) => r.startsWith("self=")), `缺 self 证据: ${v.reasons}`);
});

console.log("\n=== 3. 消息层判定 ===");
const asMsg = (text) => ({
  id: "m1",
  role: "assistant",
  content: [{ type: "text", text }],
});
t("退化的 assistant 消息可判", () => ok(isDegenerateMessage(asMsg(metaLoop))));
t("含交付物的 assistant 消息不判", () => ok(!isDegenerateMessage(asMsg(realCode))));
t("用户消息不判", () => ok(!isDegenerateMessage({ role: "user", content: [{ type: "text", text: metaLoop }] })));
t("空内容不判", () => ok(!isDegenerateMessage(asMsg(""))));

console.log("\n=== 3b. interrupted 只认事件 data（引用身份） ===");
const loopMsg = asMsg(metaLoop);
const goodMsg = asMsg(realCode);
const eventLog = [
  { seq: 1, type: "assistant/message", data: { message: loopMsg, interrupted: true } },
  { seq: 2, type: "assistant/message", data: { message: goodMsg } },
];
const fakeSession = {
  snapshotEvents() { return eventLog; },
};
t("collectInterruptedMessages 只收 interrupted 的那条", () => {
  const set = collectInterruptedMessages(fakeSession);
  eq(set.size, 1);
  ok(set.has(loopMsg), "应包含被截断的消息");
  ok(!set.has(goodMsg), "不应包含完整消息");
});
t("消息对象上不带 interrupted 字段", () => {
  ok(loopMsg.interrupted === undefined, "interrupted 不应挂在 message 上");
});

console.log("\n=== 3c. derive 过滤器端到端 ===");
const filterSession = {
  id: "s1",
  snapshotEvents() { return eventLog; },
  deriveMessages() { return [loopMsg, goodMsg]; },
};
wrapSessionLoopFilter(filterSession, () => normalizeLoopConfig());
const filtered = filterSession.deriveMessages();
t("退化的 interrupted 消息被摘掉", () => ok(!filtered.includes(loopMsg)));
t("完整消息保留", () => ok(filtered.includes(goodMsg)));
t("过滤后长度正确", () => eq(filtered.length, 1));
t("包装幂等", () => {
  wrapSessionLoopFilter(filterSession, () => normalizeLoopConfig());
  ok(filterSession.__dshPurgeLoopFilter === true);
});
t("enabled=false 时不过滤", () => {
  const s2 = {
    id: "s2",
    snapshotEvents() { return eventLog; },
    deriveMessages() { return [loopMsg, goodMsg]; },
  };
  wrapSessionLoopFilter(s2, () => normalizeLoopConfig({ enabled: false }));
  eq(s2.deriveMessages().length, 2);
});

console.log("\n=== 4. 端到端：模拟宿主事件流 ===");
const listeners = new Map();
const mockCtx = {
  on(evt, fn) { listeners.set(evt, fn); return () => listeners.delete(evt); },
};

const cancelled = [];
const followed = [];
const liveLoopMsg = { id: "a1", role: "assistant", content: [{ type: "text", text: metaLoop }] };
const liveGoodMsg = { id: "a2", role: "assistant", content: [{ type: "text", text: realCode }] };
let sessionEvents = [
  { seq: 1, type: "assistant/message", data: { message: liveLoopMsg, interrupted: true } },
  { seq: 2, type: "assistant/message", data: { message: liveGoodMsg } },
];
let derivedMessages = [
  { id: "u1", role: "user", content: [{ type: "text", text: "写点东西" }] },
  liveLoopMsg,
  liveGoodMsg,
];
const mockSession = {
  id: "s1",
  snapshotEvents() { return sessionEvents; },
  deriveMessages() { return derivedMessages; },
};
const mockAgent = {
  id: "s1",
  session: mockSession,
  cancel(reason, options) { cancelled.push({ reason, options }); },
  followup(msg) { followed.push(msg); },
};

const runtime = installLoopBreaker(mockCtx, { getConfig: () => normalizeLoopConfig() });
t("注册了流监听与 pre-step", () => {
  ok(listeners.has("agent/assistant-stream"), "缺 assistant-stream");
  ok(listeners.has("agent/pre-step"), "缺 pre-step");
});

const emitStream = (frame) => listeners.get("agent/assistant-stream")({ agent: mockAgent, frame });
const runStep = (messages) => listeners.get("agent/pre-step")({ agent: mockAgent, messages }, () => undefined);

runStep([]);
const attemptId = "a1";
emitStream({ type: "start", attemptId, revision: 1, turn: 1, step: 1 });
for (let i = 0; i < 60; i += 1) {
  emitStream({
    type: "chunk",
    attemptId,
    revision: 1,
    index: i,
    time: i,
    chunk: { type: "text-delta", index: 0, text: "让我写。好的，接下来现在开始继续写。" },
  });
}
t("空转时触发 cancel", () => ok(cancelled.length > 0, "未打断"));
t("cancel 带 keepInbox 保住用户排队输入", () => {
  eq(cancelled[0].reason.kind, "user");
  eq(cancelled[0].options.keepInbox, true);
});
t("打断后推了兑现约束", () => {
  ok(followed.length > 0, "未 followup");
  ok(followed[0].content[0].text.includes("DONE"), "约束文案不含终止判据");
  eq(followed[0].source.summary, "loop-breaker");
});

console.log("\n=== 5. 历史层摘除（走真实事件形状） ===");
runStep([]);
const after = mockSession.deriveMessages();
t("退化的 interrupted 消息被摘掉", () => ok(!after.includes(liveLoopMsg)));
t("正常完整消息保留", () => ok(after.includes(liveGoodMsg)));
t("用户消息保留", () => ok(after.some((m) => m.id === "u1")));
t("derive 包装是幂等的", () => ok(mockSession.__dshPurgeLoopFilter === true));

console.log("\n=== 6. 无 interrupted 事件时不误伤 ===");
sessionEvents = [{ seq: 1, type: "assistant/message", data: { message: liveLoopMsg } }];
const after2 = mockSession.deriveMessages();
t("没有 interrupted 标记就不摘", () => ok(after2.includes(liveLoopMsg)));

console.log("\n=== 7. 预算与复位 ===");
cancelled.length = 0;
const cfgTight = normalizeLoopConfig({ maxTripsPerTurn: 1 });
runtime.dispose();
const runtime2 = installLoopBreaker(mockCtx, { getConfig: () => cfgTight });
const emit2 = (frame) => listeners.get("agent/assistant-stream")({ agent: mockAgent, frame });
runStep([]);
emit2({ type: "start", attemptId: "a2", revision: 1, turn: 1, step: 1 });
for (let i = 0; i < 40; i += 1) {
  emit2({
    type: "chunk",
    attemptId: "a2",
    revision: 1,
    index: i,
    time: i,
    chunk: { type: "text-delta", index: 0, text: "让我写。好的，接下来现在开始继续写。" },
  });
}
t("maxTripsPerTurn=1 时只打断一次", () => eq(cancelled.length, 1, `实际 ${cancelled.length}`));
t("tripsOf 记账正确", () => eq(runtime2.tripsOf(mockAgent), 1));

console.log("\n=== 8. 尾部周期复读 ===");
t("短周期重放被判命中", () => {
  const v = detectDegenerate("Emit. Writing. Go. OK. Let me write. ".repeat(12));
  ok(v.hit, JSON.stringify(v));
  ok(v.reasons.some((r) => r.startsWith("cycle=")), `缺 cycle 证据: ${v.reasons}`);
});
t("tailRepeat 认得出短周期", () => {
  const c = tailRepeat("Emit. Writing. Go. ".repeat(10), 64, 800);
  ok(c.repeats >= 6, `repeats=${c.repeats}`);
});
t("tailRepeat 在正常长文上不误报", () => {
  const c = tailRepeat(prose, 64, 800);
  ok(c.repeats < 6, `误报 repeats=${c.repeats}`);
});
t("周期复读不吃交付物豁免（复读代码也要拦）", () => {
  const v = detectDegenerate("```js\nconst a = 1;\n```\n".repeat(8));
  ok(v.hit, "复读的代码块应被拦");
});

console.log("\n=== 9. deltaOf 覆盖两个通道 ===");
t("text-delta 归到 text", () => {
  const d = deltaOf({ type: "chunk", chunk: { type: "text-delta", index: 0, text: "hi" } });
  eq(d.channel, "text");
  eq(d.text, "hi");
});
t("reasoning-delta 归到 reasoning", () => {
  const d = deltaOf({ type: "chunk", chunk: { type: "reasoning-delta", index: 0, text: "想" } });
  eq(d.channel, "reasoning");
  eq(d.text, "想");
});
t("其他帧返回 null", () => {
  eq(deltaOf({ type: "start" }), null);
  eq(deltaOf({ type: "chunk", chunk: { type: "usage", usage: {} } }), null);
});

console.log("\n=== 10. 纯思维链空转（回归：之前漏掉的形态）===");
const rListeners = new Map();
const rCtx = { on(evt, fn) { rListeners.set(evt, fn); return () => rListeners.delete(evt); } };
const rCancelled = [];
const rFollowed = [];
const rSession = { id: "s2", snapshotEvents: () => [], deriveMessages: () => [] };
const rAgent = {
  id: "s2",
  session: rSession,
  cancel(r) { rCancelled.push(r); },
  followup(m) { rFollowed.push(m); },
};
installLoopBreaker(rCtx, { getConfig: () => normalizeLoopConfig() });
const emitR = (frame) => rListeners.get("agent/assistant-stream")({ agent: rAgent, frame });
rListeners.get("agent/pre-step")({ agent: rAgent, messages: [] }, () => undefined);
emitR({ type: "start", attemptId: "r1", revision: 1, turn: 1, step: 1 });
for (let i = 0; i < 60; i += 1) {
  emitR({
    type: "chunk",
    attemptId: "r1",
    revision: 1,
    index: i,
    time: i,
    chunk: { type: "reasoning-delta", index: 0, text: "Emit. Writing. Go. OK. Let me write. " },
  });
}
t("可见正文为空、思维链空转也要打断", () => ok(rCancelled.length > 0, "思维链空转未被拦截"));
t("打断后同样推兑现约束", () => ok(rFollowed.length > 0, "未 followup"));

console.log(`\n=== 汇总 ===`);
console.log(`  PASS ${pass}   FAIL ${fail}`);
console.log(fail === 0 ? "  ✓ 全部通过" : "  ✗ 有失败项");
process.exitCode = fail === 0 ? 0 : 1;
