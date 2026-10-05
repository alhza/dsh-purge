// 对抗性边界验证：真循环必须抓住，正常输出必须放过。
import { detectDegenerate } from "file:///D:/Code/DeepSeek/lib/loop-breaker.js";

const cases = [
  ["英文元指令循环", "Let me write this. Okay, now I will start. Next I will proceed. ".repeat(20), true],
  ["纯复读无元话语词", "她推开门走进去，屋里没有人。她推开门走进去，屋里没有人。".repeat(14), true],
  ["短元话语不判", "让我写。好的。接下来。现在开始。", false],
  ["含代码块豁免", "让我先说明。".repeat(30) + "\n```js\nconst a = 1;\n```", false],
  ["含列表项豁免", "让我先说。".repeat(30) + "\n- 第一项\n- 第二项\n- 第三项", false],
  ["边界样本", "让我写。好的，让我写。".repeat(20), true],
  [
    "正常技术说明（有真实变化）",
    "看门狗挂在流式事件上，逐段累计文本。判定用三个信号加权：元话语占比、"
    + "前后半段的自相似度、以及 gzip 压缩率。任一项越界不足以定罪，"
    + "因为排比和复沓会拉高自相似，中文本身又天然压缩率高。"
    + "所以真正触发需要两项同时成立，或者元话语占比明显超标。"
    + "一旦触发，先 cancel 截断这次 attempt，让空转正文来不及完整落盘；"
    + "再用 followup 推一条兑现约束，把“直接输出正文”钉死在下一步。"
    + "历史层则包住 deriveMessages，按引用身份把被截断的退化消息摘掉，"
    + "不让它成为下一轮先验。三道闸门合起来，循环才真的断得掉。",
    false,
  ],
];

let fail = 0;
for (const [name, text, expectHit] of cases) {
  const r = detectDegenerate(text);
  const ok = r.hit === expectHit;
  if (!ok) fail += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  期望hit=${expectHit} 实际=${r.hit}  ${JSON.stringify(r.reasons)}`);
}
console.log(fail === 0 ? "\n  全部符合预期" : `\n  ${fail} 项不符预期`);
process.exitCode = fail === 0 ? 0 : 1;
