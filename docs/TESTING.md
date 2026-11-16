# TESTING — 测试体系与验证手册

> 目标：让每一类缺陷在**最便宜、最能复现**的层被抓住；真机只验证“离线测不出来”的部分。
> 最近基线：2026-11-16 · `npm test` 22 套 / **483 断言** · `npm run check` **21/21** · `verify-runtime` **17/17**。
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
| 语法/安装脚本 | `npm run check` | 21 JS + 2 bash | 语法错误、Windows glob 失效、install/uninstall 语法 |
| 离线单元/契约 | `npm test` | 22 套 / 483 断言 | 守卫、快照、schema、投递链、配置接线、dispatcher、边界、坐标一致性、观察值/差分、query 只读视图、元素点击 TTL/滑行、from_zoom 映射、目标回显/重复抑制、投递失败/强制前台 L3、观察失败、XAML/对话框回退、菜单未确认/菜单态反馈、文档不置脏提示、轨迹监控、eval 安全、Notepad 标签分类 |
| 运行时（真驱动） | `node verify-runtime.mjs` | 17 项 | 引擎契约、真实截图/图片块、dispatcher 路由、坐标字段、文本/结构化坐标一致 |
| WinUI 键鼠通道 | `node evals/probe-winui-keys.mjs` | 14 组 | Ctrl+A/Alt+F/Alt+Tab 的 hotkey/press_key/菜单回退可达性（UIA selection / 菜单项 / 前台 HWND） |
| from_zoom 映射 | `node evals/probe-from-zoom.mjs` | 1 项 | 真实 zoom padding/缩放后 from_zoom 点击命中按钮 |
| dsh 真机加载 | `dsh --profile headless --patch <probe.yml> ...` | 5 步 | 插件注册、真实工具调用、dispatcher 路由、prompt cache |
| 真桌面闭环 | `node tests/live-action.e2e.mjs 3` | 23 项 × 3 轮 | 真实输入/焦点/窗口选择/剪贴板/验证 |
| 任务级评测 | `node evals/headless-run.mjs --tier smoke` | 10 条任务 | 多步任务收敛、步数/成本、模型行为（Web runner 已退役） |
| oracle 验证 | `node evals/verify-oracles.mjs` | 10 项 | setup 必 ok → 空跑必失败 → simulate 必过 → cleanup 干净 |

## 3. 离线套件（`npm test`）

| 套件 | 断言 | 主要覆盖 |
|---|---:|---|
| `posture.smoke.mjs` | 37 | 零审批姿态、密码硬保护（AX/UIA/结构位/掩码）、极危注记、桌面降级、快照新鲜度 I 系列、执行侧接线、zoom pid/500px/fromZoom、compact 明确失败 |
| `tools.smoke.mjs` | 26 | stop/resume 锁存、verify unknown≠成功、wait_for 超时、clipboard/menu/hover、失败回执（clipboard error_code/supported:false、menu 缺 effect、hover refusal、stop/resume 驱动失败、engineRefusal ok:false、menu 路径分隔/顶层编号指引） |
| `delivery-chain.smoke.mjs` | 12 | 真实 `cuaDeliver`：三级链/恢复、hotkey 不 L3、background/foreground 模式、无 pid、未确认恢复、L3 重试失败不假报完成 |
| `schema.conformance.mjs` | 45 | 22 个工具 / 45 个场景，按声明 schema 严格校验正常/拒绝/驱动错误/降级/query 只读形态 |
| `observe.dedup.mjs` | 17 | summary/brief/off、force、动作后全量、标题/值/enabled/selected/actions 变化、时间噪声 |
| `observe.truth.mjs` | 25 | 输入值外显、密码隐藏、标题/值/字符数差分、降噪 stub 关键控件、同标题多窗口警告、Notepad/记事本别名、Document 正文不泄露、顶层菜单栏不误报“菜单已打开”、文档“不置脏”提示、query 只读/无快照/动作拒绝/不污染差分 |
| `observe.coords.mjs` | 14 | 文本 `@(x,y)` == 结构化 `elements.x/y` == 减窗口原点；`window_id` 精确匹配；同 pid 多窗口 z 序；缺 bounds 时显式降级；Cua/Codex agent overlay 不入选/显式拒绝 |
| `observe.failure.mjs` | 10 | notFound/不同窗口降级保留旧快照；同窗口降级清空；overlay 拒绝保留；suspect 后去重强制全量 |
| `human.click.mjs` | 16 | 元素点击 TTL、background 不滑行、auto 单次/human 5 段/off 零移动、同目标跳过、tokenless 回退、from_zoom 映射/零滑行/缺失与跨窗口拒绝 |
| `action.echo.mjs` | 30 | 坐标/元素回显、重复点击抑制、观察变化放行、actionGuard=off、double_click 不拦、app_launch 启动成功+前置未确认/window_id、stale 清快照、verifyAfterAction 差分/role 变化清快照、输入回读一致/不一致/保存门禁/修正解除、set_value 回读、Document 正文不泄露、菜单栏专用注记/复核菜单态、文档不置脏提示 |
| `delivery.failures.mjs` | 25 | background/foreground/delivery_failed 对 click/type/scroll/drag/set_value 全部 ok:false；纯 unverifiable 仍 ok:true |
| `delivery.foreground.mjs` | 13 | 真实 `cuaDeliver`：force + foreground_unavailable（含驱动抛异常）→ 精确 window_id 的 L3 → 恢复；重试失败如实报未送达；hotkey 也升级；非 foreground 异常保持抛出 |
| `key.xaml.mjs` | 33 | XAML 无 AcceleratorKey 指引；auto 两次 token 点击（各带正确 window_id）；歧义/缺失/非白名单/非 XAML 不回退；投递失败不再 ok:true；对话框 press_key 回退（含未显式前台/失败不再建议 foreground=true）；alt+f/ctrl+a 的 xamlPressFallback 前景回退、菜单优先、清快照与菜单已开拒绝 |
| `menu.receipt.mjs` | 8 | `effect:unverifiable`/effect 缺失必须 ok:false + 先观察；confirmed 成功；数组 path 可用 |
| `trajectory.test.mjs` | 15 | 文本脱敏、驱动归属、AX 树不落盘、computer_do 透明、unverified/stub/suppressed/移动数、动作后复核不误报 repeat_observe、观察提示不伪造 delivery/unverified |
| `eval-safety.mjs` | 41 | 禁止按 Notepad/mspaint 进程名杀；Explorer/Paint 状态化 Open/Close；Notepad ProtectHwnd/orphan seed；标签枚举/ExpectedTabs/owned 对话框/UIA 关闭/测试标签丢弃；同 pid 模态窗口归属证明 |
| `notepad-tabs.test.mjs` | 10 | 纯标签分类：精确/额外用户标签/已修改/未知后缀/双标签/数量不符；Save As 后允许的最终标签；TabState 只清测试路径 |
| `task.tool.mjs` | 17 | 子 agent 请求构造、结构化结果、超时、无服务配方、outputSchema 降级、预算 |
| `config.plumbing.mjs` | 25 | 21 个 Config 键 ↔ `cfg` ↔ 读取点三向比对；行为哨兵 |
| `action-bounds.mjs` | 21 | P0 无快照/窗口绑定/`window_id` 透传/`suspected_noop`/指定窗口 fail-closed/`set_value` payload/密码硬拒 |
| `dispatcher.test.mjs` | 33 | dispatcher/hybrid 注册面、catalog、隐藏工具不可直调、guard/stop/resume、参数校验、图片透传、data 结构化字段、工具面稳定、宿主 schema |
| `package-manifest.test.mjs` | 9 | 包名/仓库、peer/dev 依赖、dsh 兼容范围、发布文件、权限声明、测试脚本 |

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
16. `screenOrigin` 元数据存在；
17. 文本 `@(x,y)` 与结构化 `elements` 坐标一致。

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
node evals/headless-run.mjs --tier smoke --timeout-min 10
node evals/headless-run.mjs --tasks t01 --repeats 3 --timeout-min 10
node evals/headless-run.mjs --tier all --timeout-min 10
node evals/verify-oracles.mjs
```

> `evals/run.mjs` 是 dsh 0.1.5 时代的 Web UI runner，已退役（默认 exit 2）；仅在调试旧 UI 时用 `--allow-legacy-web`。

- 任务集 10 条：冒烟 4（t01/t04/t07/wa2）+ 核心 6（t03/t05/t06/t09/t10 + x1 委派通道）；退役 7 条见 `evals/README.md`。
- oracle 一律 PowerShell/Win32 确定性读，不用模型自评；`setup` 预置到决策点，`oracle` 判定，`cleanup` 清沙箱，`simulate` 用于 AC2 双向验证。
- `verify-oracles` 的判据：setup 必 ok → oracle 空跑必失败 → simulate 后必通过 → cleanup 干净；**2026-11-12 复跑 10/10**（含 `x1`）。若 PowerShell 报 `Add-Type` 找不到 `C:\Windows\TEMP\*.cs`，先把 `TEMP`/`TMP` 指到 `%LOCALAPPDATA%\Temp` 再跑。
- 报告（`evals/report-last.json`）是**真值产物，不入库**；仓库只进 runner/任务/oracle。
- 基线不是通过率承诺：2026-09-16 冒烟组首次运行 t07 pass、其余 timeout，瓶颈在执行面（多窗口/对话框）而非模型档位。

### 6.1 verifyAfterAction A/B（2026-11-16）

只改配置，不改插件默认值。两份 patch 除 `verifyAfterAction` 外必须完全一致；实验 patch 放 `evals/headless-runs/ab/`（`.gitignore` 已覆盖该目录），不提交。

```bash
# 5 轮/臂；建议每轮 --repeats 1 交替 off/auto，而不是一次 repeats=5
node evals/headless-run.mjs --tasks t01 --repeats 5 --timeout-min 12 \
  --patch evals/headless-patch.yml --report evals/headless-runs/ab/off-t01.json
# auto 臂（patch 只多 verifyAfterAction: auto）
node evals/headless-run.mjs --tasks t01 --repeats 5 --timeout-min 12 \
  --patch evals/headless-runs/ab/verify-auto.yml --report evals/headless-runs/ab/auto-t01.json
# 汇总 markers/strategy/median/p90/paired delta
node evals/ab-summary.mjs --dir evals/headless-runs/ab --tasks t01,t05
```

- 交替跑 off/auto（每轮 `--repeats 1` 最稳）抵消机器漂移；两臂不要并发。两臂 patch 必须都固定 `agent-default-model`；dsh 0.2.2 不支持 seed/top_p，temperature 也不在 patch 配置键里，因此重复测试只能按统计分布解读。
- report 现在带 `patchPath/patchSha256/wallMs/innerSteps`；trajectory 分析用 `node evals/analyze-trajectory.mjs <file> --json`，新增 `typeCalls/retypeSame/retypeDiff/nativeObserves/forceObserves/queryObserves/zoomCalls/clipboardCalls/dragCalls/menuCalls/snapshotMismatch/repeatSuppressed/strategy`。
- `snapshotReadsByTool` 按 `driver.parent` 归属统计 `get_window_state`：`computer_click` 的计数含 verifyAfterAction 复核与 XAML 回退扫描；两臂差异主要来自复核。
- 决策规则：pass 不下降；median steps/duration 不恶化超过约 15%；p90 不恶化超过约 25%（n<8 标 `p90Unstable`，不作强结论）；没有新增 dirty/timeout；strategy 分布不更偏 exploratory。否则保持 `off`。
- **2026-11-16 首轮结果**：10/10 pass。t01 off 9/19/52 步（strategy fast/exploratory/exploratory）；auto 66/15/8 步（exploratory/direct/fast）。t05 off 24/34 步；auto 22/26 步。auto 中位略优，但区间重叠、auto 有 533s 尾部、每轮多 2-12 次 click 复核；默认保持 `off`。这组也说明：只报 steps 会把“策略混合”误当噪声，必须同时报 strategy 分布。
- 注意：`supersession=enforce` 下复核刷新 + `markConsumed` 可能产生 `[snapshot_consumed]`；A/B 用默认 `note`。

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
| 离线 | 22 套 / 483 ✅ / 0 ❌ |
| 语法 | 21/21 JS + `bash -n` 两脚本 |
| 运行时 | `verify-runtime` 17/17（Windows 11，cua-driver 0.23.2） |
| dsh 真机 | headless 1 轮 5 步（2 可见/20 隐藏，2026-11-12）；S4 smoke 两轮 7/8（Round 2 4/4）；2026-11-15 t01 原地保存变体曾 **3/3 pass**（37/18/19 步）；观察真值轮 t01 **3/3 pass**（99/9/10 步）；2026-11-16 t01 新题面 **5/5 pass**（17/32/8/19/11 步；中间题面版本 4/5）；t05 **3/3 pass**（26/28/19 步，dirty=false、tabstate restored） |
| 真桌面 | `live-action.e2e` 23/23（2026-09-17） |
| 评测 | `verify-oracles` 2026-11-12 基线 10/10；2026-11-15 18:40 复跑 **10/10**（t03 Explorer 慢关闭重试生效）；任务集 10 条 |
| 打包 | `npm pack --dry-run` 38 文件 |
| 证据 | [VERIFICATION](../VERIFICATION.md) |
