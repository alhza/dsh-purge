export function renderReport(run) {
  const { meta, rows, metrics, drift } = run;
  const out = [];
  const mark = (r) => (r.status === "pass" ? "✓" : "✗");
  const pred = (r) => (r.predicted ? "命中" : "**意外**");

  out.push("# 链路自证基线");
  out.push("");
  out.push(`- 时间：${meta.at}`);
  out.push(`- 插件：dsh-purge ${meta.pluginVersion}（dshTarget ${meta.dshTarget}）`);
  out.push(`- 宿主：${meta.hostVersion}`);
  out.push(`- Node：${meta.node}`);
  out.push(`- shipped payload：${meta.shippedBytes} B / ${meta.shippedSha}`);
  out.push(`- live override：${meta.livePath}（${meta.liveBytes} B / ${meta.liveSha}）`);
  if (meta.hostVersion !== "unknown" && meta.dshTarget !== "unknown" && meta.hostVersion !== meta.dshTarget) {
    out.push(`- ⚠ 版本错位：dshTarget=${meta.dshTarget}，实测宿主=${meta.hostVersion}`);
  }
  out.push("");

  out.push("## 测试");
  out.push("");
  out.push("| suite | 测试 | 预期 | 实际 | 预注册 | ms | 备注 |");
  out.push("|---|---|---|---|---|---|---|");
  for (const r of rows) {
    out.push(`| ${r.suite} | ${r.id} | ${r.expect} | ${mark(r)} ${r.status} | ${pred(r)} | ${r.ms} | ${r.error || ""} |`);
  }
  out.push("");

  out.push("## 指标");
  out.push("");
  out.push("| 指标 | 值 | 含义 |");
  out.push("|---|---|---|");
  out.push(`| I1 注入完整率 | ${metrics.i1.pass}/${metrics.i1.total} | 6 条结构不变量 × 每个装配夹具 |`);
  out.push(`| I2 声明真实率 | n/a | fact claim 探针尚未接入 |`);
  out.push(`| I3 工具门有效率 | ${metrics.i3.pass}/${metrics.i3.total} | 拒绝契约 + 未入范围放行 |`);
  out.push(`| I4 文本净效果 | n/a | 需要模型采样（Phase 1） |`);
  out.push(`| I5 政策漂移度 | ${drift.drift} | shipped 与 live 结论不同的政策条目数 |`);
  out.push(`| S 死面清理 | ${metrics.surface.pass}/${metrics.surface.total} | own-servers 路由/UI/写入器已移除 |`);
  out.push("");

  out.push("## 政策漂移明细");
  out.push("");
  out.push("| 条目 | shipped | live | 漂移 |");
  out.push("|---|---|---|---|");
  for (const d of drift.rows) {
    out.push(`| ${d.id} | ${d.shipped} | ${d.override} | ${d.drift ? "**是**" : "否"} |`);
  }
  out.push("");

  out.push("## 预注册命中");
  out.push("");
  const surprises = rows.filter((r) => !r.predicted);
  const knownReds = rows.filter((r) => r.expect === "fail");
  out.push(`- 命中：${rows.length - surprises.length}/${rows.length}`);
  if (surprises.length === 0) {
    out.push(knownReds.length
      ? "- 结论：已知缺陷按预期复现，未出现新的结构意外。"
      : "- 结论：全绿。本批已知缺陷已修复，未出现新的结构意外。");
  } else {
    out.push("- **意外项（必须解释）**：");
    for (const r of surprises) {
      out.push(`  - ${r.id}：预期 ${r.expect}，实际 ${r.status}${r.error ? `（${r.error}）` : ""}`);
    }
  }
  if (drift.drift > 0) {
    out.push(`- 未修：I5=${drift.drift}（payload 政策分叉，列入 Phase 1 的 payload 三分）。`);
  }
  out.push("");
  return out.join("\n");
}
