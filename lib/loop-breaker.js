import { randomUUID } from "node:crypto";
import zlib from "node:zlib";

/**
 * 元指令自循环看门狗。
 *
 * 循环之所以自我强化：空转输出被 append 进 session，下一轮 derive 时它就成了
 * 上下文里最一致的延续。所以拦截必须发生在「提交之前」和「写回历史之前」两处。
 *
 * 这里用两层：
 *   1. 流式层 —— agent/assistant-stream 的 text-delta 实时累计，判退化即 cancel，
 *      把这次 attempt 截断，空转正文来不及完整落盘。
 *   2. 历史层 —— 包 session.deriveMessages，把被判退化且 interrupted 的 assistant
 *      消息从模型请求里摘掉，不让它污染下一轮先验。
 */

/** 承诺型元话语：只表达「将要写」，不承担兑现义务。 */
const META_PHRASES = [
  "让我", "我将", "我将要", "接下来", "现在开始", "开始执行", "开始写",
  "继续写", "继续执行", "第一步", "下面我", "我先", "我需要先", "我会先",
  "好的，", "好的,", "那么我", "先来", "再来", "然后我",
];

const META_RE = new RegExp(META_PHRASES.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gu");

const DEFAULTS = Object.freeze({
  enabled: true,
  /** 单轮最多打断次数，防止看门狗自己变成循环。 */
  maxTripsPerTurn: 3,
  /** 累计到多少字符才开始判。太短时任何统计都不可靠。 */
  minChars: 180,
  /** 每增长多少字符复查一次，避免每个 chunk 都跑 gzip。 */
  checkEvery: 60,
  /** 元话语字符占比阈值。 */
  metaRatio: 0.06,
  /** 自相似阈值：后半段与前文 n-gram 重合度。 */
  selfOverlap: 0.5,
  /** 压缩率低于此值判为低熵退化。 */
  compressFloor: 0.3,
  /** 尾部周期复读：重复单元最大长度。 */
  cycleMaxUnit: 64,
  /** 尾部周期复读：重复单元最小长度。单字符连排是分隔线/缩进，不是循环。 */
  cycleMinUnit: 4,
  /** 尾部周期复读：同一单元连排多少次即定罪。 */
  cycleRepeats: 6,
  /** 尾部周期复读的观察窗口。 */
  cycleWindow: 800,
  /** 交付物信号：出现这些说明在真产出，直接豁免。 */
  deliverableSignal: /```|^\s{0,3}(?:[-*]|\d+\.)\s|function |const |import |class |def |SELECT |curl |nmap /mu,
  breakText: [
    "上一轮是元话语空转，没有交付物，已经作废。",
    "直接输出正文，第一个字符就是交付内容；不要写“让我/好的/接下来/现在开始”这类话。",
    "不要重复此前出现过的句子。确实没有内容可写时，只输出 DONE。",
  ].join(""),
});

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function clampNum(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function normalizeLoopConfig(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const text = typeof src.breakText === "string" && src.breakText.trim() ? src.breakText.trim() : DEFAULTS.breakText;
  return {
    enabled: src.enabled !== false,
    maxTripsPerTurn: clampInt(src.maxTripsPerTurn, DEFAULTS.maxTripsPerTurn, 0, 10),
    minChars: clampInt(src.minChars, DEFAULTS.minChars, 40, 4000),
    checkEvery: clampInt(src.checkEvery, DEFAULTS.checkEvery, 10, 2000),
    metaRatio: clampNum(src.metaRatio, DEFAULTS.metaRatio, 0.01, 0.5),
    selfOverlap: clampNum(src.selfOverlap, DEFAULTS.selfOverlap, 0.2, 0.95),
    compressFloor: clampNum(src.compressFloor, DEFAULTS.compressFloor, 0.05, 0.6),
    cycleMaxUnit: clampInt(src.cycleMaxUnit, DEFAULTS.cycleMaxUnit, 2, 256),
    cycleMinUnit: clampInt(src.cycleMinUnit, DEFAULTS.cycleMinUnit, 2, 64),
    cycleRepeats: clampInt(src.cycleRepeats, DEFAULTS.cycleRepeats, 3, 50),
    cycleWindow: clampInt(src.cycleWindow, DEFAULTS.cycleWindow, 200, 8000),
    breakText: text,
    // 正则不是可序列化配置，固定用内置的那条，不允许被外部覆盖掉。
    deliverableSignal: DEFAULTS.deliverableSignal,
  };
}

function grams(text, n = 6) {
  const out = new Set();
  for (let i = 0; i + n <= text.length; i += 1) out.add(text.slice(i, i + n));
  return out;
}

function overlapOf(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit += 1;
  return hit / Math.min(a.size, b.size);
}

function compressRatio(text) {
  try {
    const raw = Buffer.byteLength(text, "utf8");
    if (raw < 256) return 1;
    return zlib.gzipSync(Buffer.from(text, "utf8"), { level: 6 }).length / raw;
  } catch {
    return 1;
  }
}

/**
 * 尾部最短重复周期。
 *
 * 真实的空转是以极短周期重放同一串 token（"Emit. Writing. Go." 这种），
 * 正常文本的结尾不可能把同一个 64 字符以内的单元连排 6 次。
 */
export function tailRepeat(body, maxUnit = 64, window = 800, minUnit = 4) {
  const text = String(body || "");
  const tail = text.length > window ? text.slice(-window) : text;
  const hasContent = /[\p{L}\p{N}]/u;
  let best = { unit: 0, repeats: 0 };
  for (let p = Math.max(1, minUnit); p <= maxUnit; p += 1) {
    if (tail.length < p * 2) break;
    const unit = tail.slice(-p);
    // 纯分隔符/空白/标点的重复不算循环：表格线、缩进、代码注释框都会这样。
    if (!hasContent.test(unit)) continue;
    let repeats = 1;
    let i = tail.length - p;
    while (i - p >= 0 && tail.slice(i - p, i) === unit) {
      repeats += 1;
      i -= p;
    }
    if (repeats > best.repeats) best = { unit: p, repeats };
  }
  return best;
}

/**
 * 判一段文本是否已经退化成空转。
 * 只在「没有任何交付物信号」时才判，避免把正常长文误伤。
 */
export function detectDegenerate(text, config = {}) {
  const cfg = normalizeLoopConfig(config);
  const body = String(text || "");
  const len = body.length;

  // 尾部周期复读是结构性证据，比任何统计量都硬：不受 minChars 限制，
  // 也不吃交付物豁免——把同一段代码复读 6 遍本身就是要拦的循环。
  const cycle = tailRepeat(body, cfg.cycleMaxUnit, cfg.cycleWindow, cfg.cycleMinUnit);
  if (cycle.repeats >= cfg.cycleRepeats) {
    return {
      hit: true,
      score: 0.9,
      reasons: [`cycle=${cycle.unit}x${cycle.repeats}`],
      len,
      channel: "cycle",
    };
  }

  if (len < cfg.minChars) return { hit: false, score: 0, reasons: [], len };
  if (cfg.deliverableSignal.test(body)) return { hit: false, score: 0, reasons: [], len };

  const reasons = [];
  let score = 0;

  const metaChars = (body.match(META_RE) || []).reduce((n, hit) => n + hit.length, 0);
  const metaRatio = metaChars / len;
  if (metaRatio > cfg.metaRatio) {
    score += 0.4;
    reasons.push(`meta=${metaRatio.toFixed(3)}`);
  }

  const half = Math.floor(len / 2);
  const tailOverlap = overlapOf(grams(body.slice(half)), grams(body.slice(0, half)));
  if (tailOverlap > cfg.selfOverlap) {
    // 自相似单独不足以定罪：排比、复沓、重复的场景描写都会重合。
    score += 0.35;
    reasons.push(`self=${tailOverlap.toFixed(2)}`);
  }

  const ratio = compressRatio(body);
  if (ratio < cfg.compressFloor) {
    score += 0.3;
    reasons.push(`gzip=${ratio.toFixed(3)}`);
  }

  return { hit: score >= 0.4, score: Number(score.toFixed(2)), reasons, len };
}

/** 判一条已落盘的 assistant 消息是否该从历史里摘掉。 */
export function isDegenerateMessage(message, config = {}) {
  if (!message || message.role !== "assistant") return false;
  const content = Array.isArray(message.content) ? message.content : [];
  const text = content
    .filter((b) => b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
  if (!text.trim()) return false;
  return detectDegenerate(text, config).hit;
}

/**
 * 收集「被截断的 assistant 消息」的对象引用。
 *
 * `interrupted: true` 挂在事件 data 上，不在 message 上（见 dsh-session 的
 * deriveEventMessage：assistant/message 只返回 event.data.message），所以只能
 * 从事件流里拿引用身份来认，不能读 message.interrupted。
 */
export function collectInterruptedMessages(session) {
  const out = new Set();
  if (!session || typeof session.snapshotEvents !== "function") return out;
  let events = [];
  try {
    events = session.snapshotEvents() || [];
  } catch {
    return out;
  }
  for (const event of events) {
    if (event?.type !== "assistant/message") continue;
    if (event.data?.interrupted !== true) continue;
    const message = event.data.message;
    if (message && typeof message === "object") out.add(message);
  }
  return out;
}

/**
 * 取这一帧的增量文本，并标明来自哪个通道。
 *
 * 关键盲区：思维链走的是 `reasoning-delta`，不是 `text-delta`。
 * 只盯 text-delta 会完全看不见 CoT 里的空转，而 CoT 恰恰是最容易
 * 自循环的地方——元指令自循环几乎都发生在这一层。
 */
export function deltaOf(frame) {
  if (!frame || frame.type !== "chunk") return null;
  const chunk = frame.chunk;
  if (!chunk) return null;
  if (chunk.type === "text-delta" && typeof chunk.text === "string") {
    return { channel: "text", text: chunk.text };
  }
  if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") {
    return { channel: "reasoning", text: chunk.text };
  }
  return null;
}

function makeBreakMessage(text) {
  return {
    id: `dsh-purge-loopbreak-${randomUUID()}`,
    role: "user",
    content: [{ type: "text", text }],
    source: {
      kind: "plugin",
      plugin: "dsh-purge",
      form: "notice",
      summary: "loop-breaker",
    },
  };
}

function sessionOf(agent) {
  const session = agent?.session;
  return session && typeof session === "object" ? session : null;
}

function agentIdOf(agent) {
  return agent?.id || agent?.session?.id || "";
}

/**
 * 历史层：把退化且被截断的 assistant 消息从 derive 结果里摘掉。
 * 与 rewind 的 wrapSessionDeriveMessages 同构，但只摘「事件标了 interrupted
 * 且内容判为退化」的消息，正常的完整回答一律不动。
 *
 * deriveMessages 的产物是同一批 message 对象引用（deepFreeze 也在同一批上做），
 * 所以用引用身份匹配才可靠。
 */
export function wrapSessionLoopFilter(session, getConfig) {
  if (!session || typeof session.deriveMessages !== "function" || session.__dshPurgeLoopFilter) {
    return session;
  }
  const orig = session.deriveMessages.bind(session);
  session.deriveMessages = function deriveMessagesWithoutLoop() {
    const messages = orig();
    if (!Array.isArray(messages)) return [];
    const cfg = typeof getConfig === "function" ? getConfig() : {};
    if (cfg.enabled === false) return messages;
    const interrupted = collectInterruptedMessages(session);
    if (interrupted.size === 0) return messages;
    return messages.filter((message) => {
      if (!interrupted.has(message)) return true;
      return !isDegenerateMessage(message, cfg);
    });
  };
  session.__dshPurgeLoopFilter = true;
  return session;
}

export function installLoopBreaker(ctx, options = {}) {
  const getConfig = typeof options.getConfig === "function"
    ? options.getConfig
    : () => normalizeLoopConfig(options.config);
  const log = typeof options.log === "function" ? options.log : () => {};

  /** 每个 agent 的实时状态：当前 attempt 的累计文本与打断次数。 */
  const live = new Map();
  const tripped = new Set();

  function listen(event, handler) {
    if (typeof ctx?.on !== "function") return null;
    try {
      return ctx.on(event, handler, { global: true });
    } catch {
      try {
        return ctx.on(event, handler);
      } catch {
        return null;
      }
    }
  }

  function slotOf(agent) {
    const id = agentIdOf(agent);
    if (!id) return null;
    let slot = live.get(id);
    if (!slot) {
      slot = {
        turn: 0,
        trips: 0,
        attemptKey: "",
        text: "",
        reason: "",
        checkedAt: { text: 0, reasoning: 0 },
      };
      live.set(id, slot);
    }
    return slot;
  }

  function resetForTurn(slot, turn) {
    if (!slot || slot.turn === turn) return;
    slot.turn = turn;
    slot.trips = 0;
    slot.attemptKey = "";
    slot.text = "";
    slot.reason = "";
    slot.checkedAt = { text: 0, reasoning: 0 };
  }

  const offStream = listen("agent/assistant-stream", (payload) => {
    const cfg = getConfig();
    if (cfg.enabled === false) return;
    const agent = payload?.agent;
    const frame = payload?.frame;
    if (!agent || !frame) return;

    const slot = slotOf(agent);
    if (!slot) return;

    if (frame.type === "start") {
      resetForTurn(slot, frame.turn);
      slot.attemptKey = String(frame.attemptId ?? "");
      slot.text = "";
      slot.reason = "";
      slot.checkedAt = { text: 0, reasoning: 0 };
      return;
    }
    if (frame.type === "end") {
      // 被我们截断过的 attempt 记下来，交给历史层摘除。
      if (slot.attemptKey) tripped.add(`${agentIdOf(agent)}:${slot.attemptKey}`);
      return;
    }

    const delta = deltaOf(frame);
    if (!delta) return;
    if (String(frame.attemptId ?? "") !== slot.attemptKey) {
      slot.attemptKey = String(frame.attemptId ?? "");
      slot.text = "";
      slot.reason = "";
      slot.checkedAt = { text: 0, reasoning: 0 };
    }

    // 两个通道各存各的：CoT 空转不能用可见正文的统计量去发现。
    const side = delta.channel === "reasoning" ? "reason" : "text";
    slot[side] += delta.text;
    const buf = slot[side];
    if (buf.length - slot.checkedAt[delta.channel] < cfg.checkEvery) return;
    slot.checkedAt[delta.channel] = buf.length;

    const verdict = detectDegenerate(buf, cfg);
    if (!verdict.hit) return;
    if (slot.trips >= cfg.maxTripsPerTurn) return;

    slot.trips += 1;
    log("loop-breaker trip", {
      agent: agentIdOf(agent),
      turn: slot.turn,
      channel: delta.channel,
      trips: slot.trips,
      score: verdict.score,
      reasons: verdict.reasons,
      len: verdict.len,
    });

    // 1) 截断这次 attempt：空转正文来不及完整提交。
    // keepInbox 保住用户已排队的输入，只掐掉当前这一轮的空转。
    try {
      if (typeof agent.cancel === "function") agent.cancel({ kind: "user" }, { keepInbox: true });
    } catch { /* ignore */ }

    // 2) 换一条兑现约束重推，用户消息也会清掉重复守卫的计数。
    try {
      if (typeof agent.followup === "function") agent.followup(makeBreakMessage(cfg.breakText));
    } catch { /* ignore */ }
  });

  const offStep = listen("agent/pre-step", ({ agent, messages }, next) => {
    const slot = slotOf(agent);
    if (slot) {
      const freshHuman = Array.isArray(messages)
        && messages.some((m) => m?.source?.kind === "user");
      if (freshHuman) {
        slot.trips = 0;
        slot.attemptKey = "";
        slot.text = "";
        slot.reason = "";
        slot.checkedAt = { text: 0, reasoning: 0 };
      }
    }
    const session = sessionOf(agent);
    if (session) wrapSessionLoopFilter(session, getConfig);
    return typeof next === "function" ? next() : undefined;
  });

  return {
    /** 供自测与状态展示：某段文本是否已判退化。 */
    inspect(text) {
      return detectDegenerate(text, getConfig());
    },
    tripsOf(agent) {
      return slotOf(agent)?.trips ?? 0;
    },
    dispose() {
      try { offStream?.(); } catch { /* ignore */ }
      try { offStep?.(); } catch { /* ignore */ }
      live.clear();
      tripped.clear();
    },
  };
}

export const LOOP_BREAKER_DEFAULTS = DEFAULTS;
