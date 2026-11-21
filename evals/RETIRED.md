# RETIRED — 退役任务与 runner

> 目的：给“为什么现在只有 23 条任务”一个可查的答案，避免旧 ID 在脚本示例、注释和文档里继续悬空。
> 状态：2026-11-22。当前任务集见 [README](README.md) 与 `evals/tasks/`。

## 1. 退役任务

| ID | 原用途 | 退役原因 | 现在的替代 |
|---|---|---|---|
| `t02` | 早期 Notepad 基础任务 | 与 `t01`（保存）和 `t03`（Explorer 改名）表面重复；当时没有独立的 oracle 价值 | `t01`、`t03` |
| `t08` | 长链多步任务（历史基线曾记录一次未完成回合输入 8.5M tok） | 没有确定性 oracle，长链噪声大于可判定信号；保留会诱导“步数少=通过”的错误结论 | `t01`、`t05`、`t10`、`x1` 的确定性终态 |

两条任务的 `.md`、setup/oracle/cleanup/simulate 均已删除；仓库不再保留原题面。历史引用只剩：

- `evals/run.mjs` 的旧用法示例（已改为 `t01,t03`）。
- `lib/task.js` 的历史预算注释（已改为“历史基线，任务已退役”）。

**规则**：不要把 `t02`/`t08` 加回 `evals/tasks/`。任务计数由 `tests/tasks.check.mjs` 锁定为 23 条（S1 9 / S2 4 / S3 10 / S4 8，成员 31）。

## 2. 退役 runner

`evals/run.mjs` 是 dsh 0.1.5 时代的 Web UI runner，基于当时的选择器与发送路径；dsh 0.2.2 上会创建空会话并误读步数。它已退役：

- 默认拒绝运行，并提示改用 `evals/headless-run.mjs`。
- 仍保留 `--dry-setup`，只用于本地串 setup/oracle/cleanup，不参与模型评测。
- 任务级评测统一用 `evals/headless-run.mjs`；oracle 双向验证用 `evals/verify-oracles.mjs`。

## 3. 冻结的兼容名（不是退役任务）

以下名字是历史兼容名，继续保留，不代表 S1-S4 的 S4 阶段：

- 环境变量 `S4_TEMP`、`S4_POWERSHELL`、`S4_KEEP`、`S4_KEEP`。
- 任务沙箱 `%USERPROFILE%\.dsh\s4-evals\<taskId>\`。
- 夹具字符串 `S4 Bar Q1`、`S4-T01`、`S4-T16` 等。
- 脚本里的 `S4W32` / `S4NativeMenu` 等类名。

S4 阶段只表示 `isolation: dirty` 的脏桌面任务集；两者不要混用。
