# TESTING — 测试体系与验证手册

> 目标：让每一类缺陷在**最便宜、最能复现**的层被抓住；真机只验证“离线测不出来”的部分。
> 最近基线：2026-11-14 · `npm test` 10 套 / **232 断言** · `npm run check` **16/16** · `verify-runtime` **16/16**。
> 证据报告见 [VERIFICATION](../VERIFICATION.md)；Windows 专项见 [WINDOWS](WINDOWS.md)。

## 1. 原则

1. **按层测试**：纯逻辑用离线桩；驱动契约用真实 `cuaDeliver` + 注入 `call`；GUI 行为用真机；任务级能力用 S4 oracle。
2. **看退出码**：`npm test` 用 `&&` 串联，某一套中途抛异常时，前面几套的输出仍然全绿。判据一律是 `npm test; echo $?` 或 `set -e`，不能只 grep 输出。
3. **拒绝“测复刻”**：投递链测试直接执行真实 `lib/cua.js`，通过 `opts.call` 注入假驱动；不复制一份实现来测。
4. **schema 严格校验**：dsh 0.2.2 对工具输出做 `additionalProperties:false` 校验；离线用与宿主语义对齐的校验器覆盖每种返回形态。
5. **动作语义 fail-closed**：`unknown` 不是成功；结构化拒绝不能上报为成功；`suspected_noop` 终态失败。
6. **测试窗口按标题清理**：Win11 记事本单进程多标签，绝不按进程名杀；清理失败如实报告。

## 2. 测试层

| 层 | 命令 | 规模 | 能抓住什么 |
|---|---|---|---|
| 语法/安装脚本 | `npm run check` | 16 JS + 2 bash | 语法错误、Windows glob 失效、install/uninstall 语法 |
| 离线单元/契约 | `npm test` | 10 套 / 232 断言 | 守卫、快照、schema、投递链、配置接线、dispatcher、边界 |
| 运行时（真驱动） | `node verify-runtime.mjs` | 16 项 | 引擎契约、真实截图/图片块、dispatcher 路由、坐标字段 |
| dsh 真机加载 | `dsh --profile headless --patch <probe.yml> ...` | 5 步 | 插件注册、真实工具调用、dispatcher 路由、prompt cache |
| 真桌面闭环 | `node tests/live-action.e2e.mjs 3` | 23 项 × 3 轮 | 真实输入/焦点/窗口选择/剪贴板/验证 |
| 任务级评测 | `node evals/run.mjs --tier smoke` | 10 条任务 | 多步任务收敛、步数/成本、模型行为 |
| oracle 验证 | `node evals/verify-oracles.mjs` | 10 项 | setup 必 ok → 空跑必失败 → simulate 必过 → cleanup 干净 |

## 3. 离线套件（`npm test`）

| 套件 | 断言 | 主要覆盖 |
|---|---:|---|
| `posture.smoke.mjs` | 35 | 零审批姿态、密码硬保护（AX/UIA/结构位/掩码）、极危注记、桌面降级、快照新鲜度 I 系列、执行侧接线 |
| `tools.smoke.mjs` | 15 | stop/resume 锁存、verify unknown≠成功、wait_for 超时、clipboard、menu、hover 两种 scope |
| `delivery-chain.smoke.mjs` | 12 | 真实 `cuaDeliver`：三级链/恢复、hotkey 不 L3、background/foreground 模式、无 pid、未确认恢复 |
| `schema.conformance.mjs` | 44 | 22 个工具 / 44 个场景，按声明 schema 严格校验正常/拒绝/驱动错误/降级形态 |
| `observe.dedup.mjs` | 18 | summary/brief/off、force、动作后全量、标题/值/enabled/selected/actions 变化、时间噪声 |
| `task.tool.mjs` | 18 | 子 agent 请求构造、结构化结果、超时、无服务配方、outputSchema 降级、预算 |
| `config.plumbing.mjs` | 26 | 16 个 Config 键 ↔ `cfg` ↔ 读取点三向比对；11 组行为哨兵 |
| `action-bounds.mjs` | 22 | P0 无快照/窗口绑定/`window_id` 透传/`suspected_noop`/指定窗口 fail-closed/`set_value` payload/密码硬拒 |
| `dispatcher.test.mjs` | 32 | dispatcher/hybrid 注册面、catalog、隐藏工具不可直调、guard/stop/resume、参数校验、图片透传、工具面稳定、宿主 schema |
| `package-manifest.test.mjs` | 10 | 包名/仓库、peer/dev 依赖、dsh 兼容范围、发布文件、权限声明、测试脚本 |

### 3.1 共享脚手架

`tests/lib/harness.mjs` 提供：

- `makeWorkCopy()`：把 `index.js` + `lib/` 复制到 `.dsh-test/<prefix>-*`，保证 `@deepseek-ai/schemastery` 能沿目录树解析；
- `writeStubDriver()`：用可编程源码覆盖工作副本的 `lib/cua.js`；
- `makeCtx()`：捕获注册、提供假 `attachments`/`llm`/`approval` 服务与 `exec`；
- `validateSchema()`：与 dsh 严格语义对齐（`additionalProperties:false`、`required`、`type`、`oneOf`、`enum`、`items`），且按 JSON 往返后的值校验；
- `makeChecks()`：统一 `✅/❌` 记录与失败计数。

### 3.2 为什么 schema conformance 这么重

dsh 0.2.2 会对工具输出做严格校验。观测降级回执曾漏声明 `window/elementCount/mode/elements/visualOnly/driverAccess`，导致 `screen_zoom` 的降级路径整次 `invalid output`——工具等于不可用。`schema.conformance` 把实现可能返回的每种形态都对着声明 schema 校验；新增字段/新工具必须同时加场景。

`delivery-chain` 曾经用一份复刻的 `cuaDeliver` 测复刻，真实实现改动测不出来；现在通过 `opts.call` 注入假驱动，直接覆盖真实函数（P0-0）。

## 4. 运行时验证（真驱动）

```bash
node verify-runtime.mjs
```

前提：`cua-driver` 可用；当前桌面有可见窗口；Node 22。

检查项（16 个断言）：

1. dispatcher 可见工具 = `computer_do` + `screen_observe`；
2. catalog 覆盖 20 个隐藏工具；
3. 注册面仍只有 2 个；
4. `screen_observe` 含 `native` 模式；
5. `screen_zoom` 在 catalog 中；
6. 无快照动作被拒；
7. `screen_observe(ax)` 真实引擎返回树；
8. `native` + text-only route 优雅拒绝；
9. `native` + image route 图片落盘；
10. native render 产出 `{type:"image"}` 内容块；
11. `screen_zoom` 区域截图；
12. `screen_zoom` 经 dispatcher 的 render 图片块；
13. vision 无 key 优雅降级；
14. 坐标语义标注（`窗口截图物理像素`）；
15. `coordinateSpace === 'window-screenshot-px'`；
16. `screenOrigin` 元数据存在。

注意：脚本只读观察，不执行桌面动作；窗口每次从 `list_windows(on_screen_only)` 发现，不写死 PID；选择时跳过 `0×0` shell 弹窗与驱动自身窗口。

### 4.1 dsh 真机加载（headless）

```bash
dsh --profile headless --patch "<工作区>/_probe-win-cu-deepseek.yml" \
  --permission-mode read-only --approval-policy never \
  "调用 computer_do(action='status')，把返回原文贴出来"
```

- `headless` 默认禁用 `credentials`（`id: credentials disabled: true`）；探针 patch 必须显式启用，否则会在 LLM 路由报 `MISSING_CREDENTIAL`，不是插件加载错误。
- 2026-11-12 实测：dsh 0.2.2-rc.1 + 默认 DeepSeek 通道，1 轮 5 步完成 `status` / `screen_observe` / `catalog` / 隐藏 `computer_wait`；2 可见/20 隐藏；`cacheReadTokens` 6528→7296。
- 探针 patch 在仓库外，不入库；详细证据见 [VERIFICATION](../VERIFICATION.md) §2.1。

### 4.2 headless S4 smoke（绕过 Web runner）

```bash
node evals/headless-run.mjs --tier smoke --timeout-min 10
```

复用 setup/oracle/cleanup，逐条保存 `evals/headless-runs/<stamp>/<task>-r<n>.jsonl`，统计 pass/fail、工具错误、未验证、超时。前置：headless profile 可解析 `dsh-win-computer-use`；`DSH_BIN` 可覆盖 dsh entry；`TEMP/TMP` 自动归一化。

2026-11-12 两轮 smoke：

| 轮次 | 上限 | 结果 | 备注 |
|---|---:|---|---|
| Round 1（一次性 runner） | 8min | **3/4** | `t01/t04/t07` pass；`wa2` fail（57 调用，Archive） |
| Round 2（`headless-run.mjs`） | 10min | **4/4** | `t01` 41 调用/err 7/unverified 13；`t04` 23/0/10；`t07` 5/0/2；`wa2` 72/12/16（到点但 oracle pass） |

两轮合计 **7/8（87.5%）**。`wa2` 对时间预算敏感（8min fail → 10min pass）；工具错误计数含探索性重试，不等同于插件缺陷，但值得做轨迹分析。

> **Web runner 已退役**：`evals/run.mjs` 的 UI 选择器/发送路径基于 dsh 0.1.5；在 0.2.2 上创建空会话、`steps` 误读。现在默认拒绝运行并提示改用 headless runner（`--allow-legacy-web` 仅旧 UI 调试，`--dry-setup` 仍可用）。S4 基线统一用 `headless-run.mjs`。

## 5. 真桌面闭环

```bash
node tests/live-action.e2e.mjs 3
```

设计要点：

- 用**唯一命名临时文件**打开记事本，做确定性窗口选择，避免桌面已有多个记事本时选错；
- 流程：observe(ax) → 找文档元素 → `computer_type`（`effect:confirmed`）→ **脚本自读 UIA 文档文本含标记**（独立见证）→ `computer_verify` 窗口谓词 satisfied / 自输入文本 `unknown+untrusted_source` → 未知参数拒绝 → 剪贴板往返 → `computer_wait`；
- 不杀进程：Win11 记事本可能同时持有用户未保存文档；脚本只报告残留标签，由人工关闭；
- 最近一次：23/23（2026-09-17，重设计后；旧版 30/30 已退役）。

## 6. S4 任务级评测（`evals/`）

```bash
node evals/run.mjs --tier smoke --max-steps 40 --timeout-min 8
node evals/run.mjs --group authored|waa|all
node evals/verify-oracles.mjs
```

- 任务集 10 条：冒烟 4（t01/t04/t07/wa2）+ 核心 6（t03/t05/t06/t09/t10 + x1 委派通道）；退役 7 条见 `evals/README.md`。
- oracle 一律 PowerShell/Win32 确定性读，不用模型自评；`setup` 预置到决策点，`oracle` 判定，`cleanup` 清沙箱，`simulate` 用于 AC2 双向验证。
- `verify-oracles` 的判据：setup 必 ok → oracle 空跑必失败 → simulate 后必通过 → cleanup 干净；**2026-11-12 复跑 10/10**（含 `x1`）。若 PowerShell 报 `Add-Type` 找不到 `C:\Windows\TEMP\*.cs`，先把 `TEMP`/`TMP` 指到 `%LOCALAPPDATA%\Temp` 再跑。
- 报告（`evals/report-last.json`）是**真值产物，不入库**；仓库只进 runner/任务/oracle。
- 基线不是通过率承诺：2026-09-16 冒烟组首次运行 t07 pass、其余 timeout，瓶颈在执行面（多窗口/对话框）而非模型档位。

## 7. 新增测试/工具

新增工具时至少补：

1. `schema.conformance`：正常/守卫拒绝/驱动拒绝/降级等返回形态；
2. `dispatcher.test`：若隐藏，校正 catalog 与可见/隐藏数量；若热工具，校正 hybrid 面；
3. `action-bounds`：无快照、窗口绑定、参数缺失/未知参数；
4. `config.plumbing`：若新增配置键，补 schema↔cfg↔读取点与行为哨兵；
5. `package-manifest`：若新增发布文件/依赖/权限，更新断言；
6. 真机：`verify-runtime`（只读）与必要的 live e2e。

改工具描述/参数时，建议在**仓库外**跑一次性工具面 JSON dump（描述/参数/输出 schema/render/execute arity），改前存基线、改后 diff；工具面是模型看到的全部接口，漂移即回归。

## 8. 排障

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERR_MODULE_NOT_FOUND @deepseek-ai/schemastery` | `node_modules/@deepseek-ai` 为空 | `npm install`（peer/dev 依赖已声明） |
| `npm test` 输出全绿但退出码非 0 | 只看了前面套件输出 | `npm test; echo $?`；用 `set -e` |
| schema 测试报 `undeclared property` | 输出多返回了字段，schema 未声明 | 补 schema 或删字段；保持 `additionalProperties:false` |
| 真机 native 整次失败 | 宿主严格输出校验 + 降级字段漏声明 | 跑 `schema.conformance` 的降级场景 |
| live e2e 选错窗口 | 桌面有同名/残留记事本 | 用唯一命名临时文件；按标题精确匹配，不按进程名 |
| 截图断言 0B | 选中了 `0×0` shell 弹窗 | 选择窗口时要求 `bounds.width/height > 0` |
| `verify-runtime` 13/16 | 驱动自身/空窗口被选中 | 排除 `cua-driver` 进程名与 `0×0` 窗口 |
| evals 某个任务超时 | 残留窗口/驱动 daemon 挂死 | 先 `maintain.mjs`/`stop-stale.mjs`；清理残留后复跑 |
| Windows 动态 import 报绝对路径 | ESM 需要 URL | 用 `pathToFileURL()` |

## 9. 当前基线

| 项 | 值 |
|---|---|
| 离线 | 10 套 / 232 ✅ / 0 ❌ |
| 语法 | 16/16 JS + `bash -n` 两脚本 |
| 运行时 | `verify-runtime` 16/16（Windows 11，cua-driver 0.23.2） |
| dsh 真机 | headless 1 轮 5 步（2 可见/20 隐藏，2026-11-12）；S4 smoke 两轮 7/8（Round 2 4/4） |
| 真桌面 | `live-action.e2e` 23/23（2026-09-17） |
| 评测 | `verify-oracles` 10/10；任务集 10 条 |
| 打包 | `npm pack --dry-run` 32 文件 |
| 证据 | [VERIFICATION](../VERIFICATION.md) |
