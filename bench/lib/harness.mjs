/**
 * 极简测试骨架：零依赖、确定性、把“预期红”作为一等公民。
 *
 * 约定：每个 test 带 expect（"pass" | "fail"）。
 *   status === expect  → predicted（符合预注册）
 *   status !== expect  → surprise（唯一需要解释的东西）
 * 这样“已知缺陷”不会淹没“新问题”。
 */

export function suite(name, tests) {
  return { name, tests };
}

export function assert(cond, message) {
  if (!cond) throw new Error(message || "assertion failed");
}

export function eq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || "eq"}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

export function includes(haystack, needle, message) {
  if (!String(haystack).includes(needle)) {
    throw new Error(`${message || "includes"}: missing ${JSON.stringify(needle)}`);
  }
}

export async function runSuite(s) {
  const rows = [];
  for (const t of s.tests) {
    const at = Date.now();
    let status = "pass";
    let error = "";
    try {
      await t.run();
    } catch (e) {
      status = "fail";
      error = String(e && e.message ? e.message : e);
    }
    const expect = t.expect || "pass";
    rows.push({
      suite: s.name,
      id: t.id,
      expect,
      status,
      predicted: status === expect,
      ms: Date.now() - at,
      error,
    });
  }
  return rows;
}

export async function runAll(suites) {
  const rows = [];
  for (const s of suites) rows.push(...(await runSuite(s)));
  return rows;
}
