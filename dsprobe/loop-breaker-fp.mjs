// 真实中文长文误伤复检：周期检测上线后重跑一遍。
import fs from "node:fs";
import { detectDegenerate } from "file:///D:/Code/DeepSeek/lib/loop-breaker.js";

const files = ["README.zh-CN.md", "REPORT.md", "APPROACH.md", "BREAK-purge.md", "DESIGN-purge.md"];
let bad = 0;
let total = 0;
for (const f of files) {
  const raw = fs.readFileSync(`D:/Code/DeepSeek/${f}`, "utf8");
  for (let start = 0; start + 180 <= Math.min(raw.length, 6000); start += 173) {
    for (const len of [180, 320, 600, 1200]) {
      const seg = raw.slice(start, start + len);
      if (seg.length < len) continue;
      total += 1;
      const r = detectDegenerate(seg);
      if (r.hit) {
        bad += 1;
        if (bad <= 5) console.log("误伤", f, "len=" + len, JSON.stringify(r.reasons));
      }
    }
  }
}
console.log(`样本=${total} 误伤=${bad} 误伤率=${(bad / total * 100).toFixed(2)}%`);
process.exitCode = bad === 0 ? 0 : 1;
