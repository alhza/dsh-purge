# 链路自证协议 v0

状态：Phase 0 预注册（跑之前写死，跑完不改）。
目的：把“链路脆”从论述变成**可复现的红测**；红线即证据，绿线即验收。

---

## 1. 被测链路

```
host sections → rewritePromptAssembly → 装配结果 → 工具门 → 会话状态
     S1 结构          S2 语义          S3 执行       S4 数据
```

Phase 0 只覆盖 S1、S3、S4 中可离线判定的部分；S2（模型输出）留到 Phase 1。

## 2. 预注册假设

| # | 假设 | 判据 | 预期 |
|---|---|---|---|
| H1 | 结构不变量在合成夹具上成立 | 6 条不变量 × 5 个夹具全过 | 全绿 |
| H2 | tool gate 的返回不符合宿主契约 | `gate.denies-by-contract` 返回的 `kind !== "deny"` | **红** |
| H3 | own-servers 写入不落盘 | `writeAllowText` 回读不一致 | **红** |
| H4 | shipped 与 live override 存在政策漂移 | `driftReport().drift > 0` | 漂移 ≥ 1 |

已知证据（运行前）：
- `net-scope.js:831-846` 返回 `{isError, content, output, text}`；宿主 `dsh-tools/lib/types/index.js:885-898` 读 `decision.kind` / `decision.reason`。
- 实测：`pwsh` 参数带 `8.8.8.8` / `example.com` 未被拦。
- `net-scope.js:441-444` 的 `writeAllowText()` 忽略参数、返回空文本。
- 本机 override 允许游戏外挂，shipped default 1.1.74 起禁止。

## 3. 测试清单（预注册）

- `assembled`：`standard|minimal|redteam|subagent|live` × 6 条不变量，全部 `expect: pass`
  - `inject.once`：payload 指纹行在最终装配里恰好出现 1 次
  - `identity.absent`：`harness:identity` 段与宿主身份句都消失
  - `inject.first`：首段 order = -100000
  - `closure.exactly-once`：`</project_instructions>` 数量等于规范化后的期望值
  - `tail.after-closer`：闭合标签之后仍有内容（注入未吞段）
  - `denial.absent`：宿主拒绝/失败关闭话术不残留
- `tool-gate`：`gate.arms` pass；`gate.detects-public-ip` pass；`gate.denies-by-contract` **fail**
- `own-servers`：`own-servers.persists` **fail**

## 4. 指标

| 指标 | 定义 | Phase 0 |
|---|---|---|
| I1 注入完整率 | assembled 通过数 / 总数 | 有值 |
| I2 声明真实率 | fact claim 探针通过率 | n/a（未接） |
| I3 控制面有效率 | (gate deny + own-servers 持久化) / 2 | 有值 |
| I4 文本净效果 | treatment − baseline 完成率（含 CI） | n/a（Phase 1） |
| I5 政策漂移度 | shipped 与 live 结论不同的政策条目数 | 有值 |

## 5. 纪律（防止自欺）

1. 预期先写，跑完不改；改预期要单独提交并注明原因。
2. `status !== expect` 记为 **surprise**，是唯一需要解释的输出；进程退出码只看 surprise。
3. 夹具是受控输入，不代表真实宿主；真实装配抓包列入 Phase 1。
4. 评分规则先于采样确定（Phase 1），不按结果调参。
5. 每次运行落盘 `results.json` + `report.md`，含 payload 哈希与宿主版本。

## 6. 阶段

- Phase 0（本次）：结构不变量 + 两个已知红测 + 政策漂移。
- Phase 1：40 条 probe × 5 次 × 3 臂（empty/host/inject），产出 I4 与置信区间。
- Phase 2：冲突注入（权限/身份/事实三类反证），量化“模型醒来”的幅度。
- Phase 3：把 I1–I5 接进 CI，任一 surprise 即红。

---

## 7. 修订 v0.1（2026-10-28，修复后）

v0 基线：37 项中 34 项命中，2 红（`gate.denies-by-contract`、`own-servers.persists`），留档 `runs/20261028-205131`。

本轮修复后，预注册按“修复验收”重写：

| 项 | v0 | v0.1 | 原因 |
|---|---|---|---|
| `gate.denies-by-contract` | fail | **pass** | 返回值改成宿主契约 `{kind:"deny", reason}` |
| `gate.allows-unscoped` | — | **pass** | 新增：未入范围的普通会话不得被公网门误伤 |
| `own-servers.persists` | fail | 删除 | 功能按 local-lab-only 定位整体移除 |
| `surface.*`（3 条） | — | **pass** | 路由 / UI / 写入器均已移除 |

同步改动：`dshTarget` 从 `0.2.1-rc.2` 对齐到实测 `0.2.1-rc.3`。

未修项：**I5 仍为 2**。payload 里的“禁止外挂 / 硬拦”仍与 live override 分叉。这是产品级决策（payload 三分：persona / policy / style），不在本轮代码修复范围，列入 Phase 1。

**这一版的意义**：把“预期红”翻成“预期绿”，证明修复被同一套断言接住，而不是靠肉眼确认。

---

## 8. 修订 v0.2（2026-10-28，payload / I5）

v0.1 遗留 I5=2（外挂禁令、硬拦声明）。本轮把这项政策面统一：

| 项 | v0.1 | v0.2 |
|---|---|---|
| 外挂硬拦（`CHEAT_STRONG` / `isCheatTask`） | 代码内拦截 | **移除**：不再进 scope、不再合成拒绝 |
| shipped payload Rule 1 | 禁止 | **本地测试，给实现与步骤** |
| shipped payload 意图映射 | 禁止 | **激活 Rule 1** |
| “硬拦已挂在会话门口”声明 | 有 | **删除** |
| I5 政策漂移度 | 2 | **预期 0** |

新增回归断言：`cheat.gate-removed`、`payload.cheat-aligned`。它们防止“删了代码、文案又长回来”或反过来。

I5 的条目改为三态（`forbid` / `allow` / `absent`）：v0.2 期望 `cheat.stance = allow / allow`，而不是“两边都检测不到”。

未变：公网门（攻击/红队轮次只准私网）保持原样，I3 仍应 2/2。

### v0.2 清理补充（同日）

- 删除 identity 里的 `OWN_SERVER_MARK` / `withOwnServers`、net-scope 的 `ownServerNote`（注入侧最后一点死脚手架）。
- 删除 `docs/preview/own-servers*.png` 与 `screenshots.json` 中的两条记录。
- S 指标从 5 条扩到 6 条（新增 docs 清理断言）。
- **过程记录**：这次清理误删了 `isRangeTarget`，被 `gate.detects-public-ip` 当场抓住（`isRangeTarget is not defined`），随后恢复。这是验证环第一次抓住“清理引入的回归”，不是被测系统的新问题。



