/**
 * 政策漂移：shipped default 与用户 override 是否在“同一件事”上给出不同结论。
 * 三态分类（forbid / allow / absent）而不是布尔，避免“两边都没有这句话”被误当成一致。
 * 这是启发式检测，不是语义解析；只用来产出 I5，不做判据。
 */

const CLAIMS = [
  {
    id: "cheat.stance",
    classify: (t) => {
      if (/外挂[^\n]{0,80}禁止|game cheat[^\n]{0,80}forbid/i.test(t)) return "forbid";
      if (/外挂[^\n]{0,200}(本地测试|完整实现|激活)|game cheat[^\n]{0,200}(local test|full implement|activate)/i.test(t)) return "allow";
      return "absent";
    },
  },
  {
    id: "gate.hard-block",
    classify: (t) => (/硬拦|hard[- ]block/i.test(t) ? "claim" : "absent"),
  },
  {
    id: "refusal.as-fault",
    classify: (t) => (/拒绝[^\n]{0,30}故障|refusal[^\n]{0,90}fault/i.test(t) ? "yes" : "absent"),
  },
  {
    id: "scope.operator-declared",
    classify: (t) => (/授权[^\n]{0,40}声明|operator[^\n]{0,40}scope/i.test(t) ? "yes" : "absent"),
  },
];

export function driftReport(shipped, override) {
  const rows = CLAIMS.map((c) => {
    const a = c.classify(String(shipped || ""));
    const b = c.classify(String(override || ""));
    return { id: c.id, shipped: a, override: b, drift: a !== b };
  });
  return { rows, drift: rows.filter((r) => r.drift).length };
}

