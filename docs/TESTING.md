# TESTING — 测试体系与验证手册

> 目的：让每一类缺陷在**最便宜、最能复现**的层被抓住；真机只验证“离线测不出来”的部分。
> 读者：贡献者、维护者。
> 状态：当前实现（最后核对 2026-11-18：`npm test` 26 套 / **634 项检查**；`npm run check` 语法 26/26 + 文档一致性；`verify-runtime` **18/18**）。
> 相关：[VERIFICATION](../VERIFICATION.md) · [EVIDENCE](EVIDENCE.md) · [WINDOWS](WINDOWS.md) · [DRIVER-SDK](DRIVER-SDK.md)。

## 1. 原则

1. **按层测试**：纯逻辑用离线桩；驱动契约用真实 `cuaDeliver` + 注入 `call`；GUI 行为用真机；任务级能力用 S4 oracle。
2. **看退出码**：`npm test` 用 `&&` 串联，某一套中途抛异常时，前面几套的输出仍然全绿。判据一律是 `npm test; echo $?` 或 `set -e`，不能只 grep 输出。
3. **拒绝“测复刻”**：投递链测试直接执行真实 `lib/cua.js`，通过 `opts.call` 注入假驱动；不复制一份实现来测。
4. **schema 严格校验**：dsh 0.2.2 对工具输出做 `additionalProperties:false` 校验；离线用与宿主语义对齐的校验器覆盖每种返回形态。
5. **动作语义 fail-closed**：`unknown` 不是成功；结构化拒绝不能上报为成功；`suspected_noop` 终态失败。
6. **测试窗口按标题/HWND 清理**：Win11 记事本单进程多标签，绝不按进程名杀；清理失败如实报告。

## 2. 测试层

| 层 | 命令 | 规模 | 能抓住什么 |
|---|---|---|---|
| 语法/安装脚本 | `npm run check` | 26 JS（含 lib/driver）+ 2 bash + 文档检查 | 语法错误、Windows glob 失效、install/uninstall 语法、文档漂移 |
| 离线单元/契约 | `npm test` | 26 套 / 634 项检查 | 守卫、快照、schema、投递链、配置接线、dispatcher、边界、坐标一致性、观察值/差分、query 只读、元素点击 TTL、from_zoom、modifier/私有拖拽、capture-only、回执真实性、eval 安全、驱动归一化 |
| 运行时（真驱动） | `node verify-runtime.mjs` | 18 项 | 引擎契约、真实截图/图片块、dispatcher 路由、坐标一致、native 快照 id |
| WinUI 键鼠通道 | `node evals/probe-winui-keys.mjs` | 14 组 | Ctrl+A/Alt+F/Alt+Tab 的 hotkey/press_key/菜单回退可达性 |
| from_zoom 映射 | `node evals/probe-from-zoom.mjs` | 1 项 | 真实 zoom padding/缩放后 from_zoom 点击命中按钮 |
| modifier 手势 | `node evals/probe-modifier.mjs` | 3 项 | click element/坐标的 Ctrl 到达；0.23.2 driver drag modifier 不进入目标；0.52.13 原生 delivered |
| 组合键前台 | `node evals/probe-combo-foreground.mjs` | 1 项 | blocker 前台时插件 `key()` 自动前台目标并把 Ctrl+V 送进 WinForms |
| 私有拖拽 | `node evals/probe-private-drag.mjs` | 1 项 × 3 轮 | 真实插件 → helper → WinForms down/move/up 均读到修饰键，drop 后无卡键 |
| 驱动形态 | `node evals/probe-driver-shape.mjs` | 1 项 | 默认/显式 tree_format、window_bounds、frame/screenshot_frame、session、zoom MIME、click 回执 |
| native freshness | `node evals/probe-native-freshness.mjs` | 2 项 | 文本变化后 driver 截图与插件 native 图的 hash/字节数是否更新 |
| dsh 真机加载 | `dsh --profile headless --patch ...` | 5 步 | 插件注册、真实工具调用、dispatcher 路由、prompt cache |
| 真桌面闭环 | `node tests/live-action.e2e.mjs 3` | 23 项 × 3 轮 | 真实输入/焦点/窗口选择/剪贴板/验证 |
| 任务级评测 | `node evals/headless-run.mjs --tier smoke` | 17 条任务 | 多步任务收敛、步数/成本、模型行为（Web runner 已退役） |
| oracle 验证 | `node evals/verify-oracles.mjs` | 17 项（可 SKIP/ENV） | setup 必 ok → 空跑必失败 → simulate 必过 → cleanup 干净 |

## 3. 离线套件（`npm test`）

| 套件 | 断言 | 主要覆盖 |
|---|---:|---|
| `posture.smoke.mjs` | 37 | 零审批姿态、密码硬保护（AX/UIA/结构位/掩码）、极危注记、桌面降级、快照新鲜度、执行侧接线、zoom pid/500px/fromZoom、compact 明确失败 |
| `tools.smoke.mjs` | 26 | stop/resume 锁存、verify unknown≠成功、wait_for 超时、clipboard/menu/hover、失败回执、engineRefusal、menu 路径指引 |
| `delivery-chain.smoke.mjs` | 12 | 真实 `cuaDeliver`：三级链/恢复、hotkey 不 L3、background/foreground 模式、无 pid、未确认恢复、L3 重试失败不假报完成 |
| `schema.conformance.mjs` | 47 | 23 个工具 / 47 个场景，按声明 schema 严格校验正常/拒绝/驱动错误/降级/query 只读/窗口激活/modifier click 形态 |
| `observe.dedup.mjs` | 17 | summary/brief/off、force、动作后全量、标题/值/enabled/selected/actions 变化、时间噪声 |
| `observe.truth.mjs` | 25 | 输入值外显、密码隐藏、标题/值/字符数差分、降噪 stub 关键控件、同标题多窗口警告、中英别名、Document 正文不泄露、顶层菜单栏、文档不置脏、query 只读/旧快照已清除 |
| `observe.coords.mjs` | 20 | 文本 `@(x,y)` == 结构化 `elements.x/y` == 减窗口原点；window_id 精确匹配；同 pid 多窗口 z 序；缺 bounds 降级；overlay 过滤；z 序提示；源图尺寸提示；native 快照 id + 全局单例；跨窗口旧 id 拒绝 |
| `key.xaml.mjs` | 37 | XAML 无 AcceleratorKey 指引；auto 两次 token 点击；歧义/缺失/非白名单不回退；投递失败不 ok:true；对话框 press_key 回退；alt+f/ctrl+a 的 xamlPressFallback；组合键默认前台 |
| `menu.receipt.mjs` | 8 | `effect:unverifiable`/effect 缺失必须 ok:false + 先观察；confirmed 成功；数组 path 可用 |
| `human.click.mjs` | 23 | 元素点击 TTL、background 不滑行、auto 单次/human 5 段/off 零移动、同目标跳过、tokenless 回退、from_zoom 映射/缺失/跨窗口拒绝、modifier 规范化/自动前台/非法值 |
| `action.echo.mjs` | 39 | 坐标/元素回显、密码值隐藏、重复点击抑制、观察变化放行、actionGuard=off、double_click 不拦、modifier 签名区分、app_launch 语义、activate、stale 清快照、verifyAfterAction、输入回读/保存门禁、set_value、Document 不泄露、菜单注记、无 Document type 保留快照 |
| `delivery.failures.mjs` | 27 | background/foreground/delivery_failed 对 click/type/scroll/drag/set_value 全部 ok:false；纯 unverifiable 仍 ok:true；`background_delivery_failed` 是升级建议 |
| `delivery.foreground.mjs` | 21 | 真实 `cuaDeliver`：force + foreground_unavailable → 精确 window_id 的 L3 → 恢复；重试失败如实报未送达；hotkey 升级；非 foreground 异常保持抛出；force + unverified 指针前置单次；type 不前置 |
| `observe.failure.mjs` | 10 | notFound/不同窗口降级保留旧快照；同窗口降级清空；overlay 拒绝保留；suspect 后去重强制全量 |
| `trajectory.test.mjs` | 18 | 文本脱敏、驱动归属、AX 树不落盘、computer_do 透明、unverified/stub/suppressed/移动数、动作后复核不误报、modifier 独立签名、driver 手势参数保留 |
| `eval-safety.mjs` | 65 | 禁止按进程名杀；Explorer/Paint/Office/浏览器状态化 Open/Close；Notepad ProtectHwnd/orphan seed；标签枚举/ExpectedTabs/owned 对话框/UIA 关闭/测试标签丢弃；同 pid 模态归属；dirty helper/Downloads hash 清理 |
| `notepad-tabs.test.mjs` | 10 | 纯标签分类：精确/额外用户标签/已修改/未知后缀/双标签/数量不符；Save As 后允许的最终标签；TabState 只清测试路径 |
| `task.tool.mjs` | 17 | 子 agent 请求构造、结构化结果、超时、无服务配方、outputSchema 降级、预算 |
| `config.plumbing.mjs` | 32 | 24 个 Config 键 ↔ `cfg` ↔ 读取点三向比对；行为哨兵；数字 window/window_id 提示归属 |
| `action-bounds.mjs` | 37 | 无快照/窗口绑定/window_id 透传/suspected_noop/指定窗口 fail-closed/set_value/密码硬拒；drag steps/duration/from_zoom/zoom 缺失/非法参数；modifier/dwell 私有路由、屏幕坐标、modifier+from_zoom 拒绝、缺 frame 拒绝 |
| `dispatcher.test.mjs` | 36 | dispatcher/hybrid 注册面、catalog、隐藏工具不可直调、guard/stop/resume、参数校验、图片透传、data 字段、工具面稳定、宿主 schema、click modifier/drag from_zoom+steps、通用快照前置描述 |
| `driver.normalize.mjs` | 23 | 0.23.2 与 0.53 fixtures 归一化一致；未知字段保留；坐标空间校准 |
| `driver.capabilities.mjs` | 20 | 版本/能力/请求映射/自适应学习 |
| `driver.transport.mjs` | 12 | fake spawn：超时/非 JSON/contract/session/结构化退出 |
| `driver.compat.mjs` | 6 | 真实 observe/refresh + 注入 transport 的端到端兼容 |
| `package-manifest.test.mjs` | 9 | 包名/仓库、peer/dev 依赖、dsh 兼容范围、发布文件、权限声明、测试脚本 |

合计 **634** 项；新增/删除断言后以 `npm test` 实际输出为准，并同步 `tests/docs.facts.json`。

### 3.1 共享脚手架

`tests/lib/harness.mjs` 提供：

- `makeWorkCopy()`：把 `index.js` + `lib/` 复制到 `.dsh-test/<prefix>-*`，保证 `@deepseek-ai/schemastery` 能沿目录树解析；
- `writeStubDriver()`：用可编程源码覆盖工作副本的 `lib/cua.js`；
- `makeCtx()`：捕获注册、提供假 `attachments`/`llm`/`approval` 服务与 `exec`；
- `validateSchema()`：与 dsh 严格语义对齐（`additionalProperties:false`、`required`、`type`、`oneOf`、`enum`、`items`），且按 JSON 往返后的值校验；
- `makeChecks()`：统一 `✅/❌` 记录与失败计数。

### 3.2 为什么 schema conformance 这么重

dsh 0.2.2 会对工具输出做严格校验。观测降级回执曾漏声明 `window/elementCount/mode/elements/visualOnly/driverAccess`，导致 `screen_zoom` 的降级路径整次 `invalid output`——工具等于不可用。`schema.conformance` 把实现可能返回的每种形态都对着声明 schema 校验；新增字段/新工具必须同时加场景。

`delivery-chain` 曾经用一份复刻的 `cuaDeliver` 测复刻，真实实现改动测不出来；现在通过 `opts.call` 注入假驱动，直接覆盖真实函数。

## 4. 运行时验证（真驱动）

```bash
node verify-runtime.mjs
```

前提：`cua-driver` 可用；当前桌面有可见窗口；Node 22。检查项（18）：

1. dispatcher 可见工具 = `computer_do` + `screen_observe`；
2. catalog 覆盖 21 个隐藏工具；
3. 注册面仍只有 2 个；
4. `screen_observe` 含 native 模式；
5. `screen_zoom` 在 catalog 中；
6. 无快照动作被拒（`[snapshot_missing]`）；
7. `screen_observe(ax)` 真实引擎返回树；
8. 文本 `@(x,y)` 与结构化 `elements` 坐标一致；
9. `native` + text-only route 优雅拒绝；
10. `native` + image route 图片落盘；
11. native 文本回显当前快照 id；
12. native render 产出 `{type:"image"}` 内容块；
13. `screen_zoom` 区域截图；
14. `screen_zoom` 经 dispatcher 的 render 图片块；
15. vision 无 key 优雅降级；
16. 坐标语义标注（窗口截图原图像素）；
17. `coordinateSpace === 'window-screenshot-px'`；
18. `screenOrigin` 元数据存在。

脚本只读观察，不执行桌面动作；窗口每次从 `list_windows(on_screen_only)` 发现，不写死 PID；选择时跳过 `0×0` shell 弹窗与驱动自身窗口。

### 4.1 dsh 真机加载（headless）

```bash
dsh --profile headless --patch "<repo>/evals/headless-patch.yml" \
  --permission-mode read-only --approval-policy never \
  "调用 computer_do(action='status')，把返回原文贴出来"
```

- `headless` 默认禁用 `credentials`；overlay 必须显式启用，否则会在 LLM 路由报 `MISSING_CREDENTIAL`，不是插件加载错误。
- 2026-11-12 实测：dsh 0.2.2-rc.1 + 默认 DeepSeek 通道，1 轮 5 步完成 `status` / `screen_observe` / `catalog` / 隐藏 `computer_wait`；当时 2 可见/20 隐藏；`cacheReadTokens` 6528→7296。
- 证据见 [EVIDENCE](EVIDENCE.md) §7.1。

### 4.2 headless S4 smoke

```bash
node evals/headless-run.mjs --tier smoke --timeout-min 10
```

复用 setup/oracle/cleanup，逐条保存 `evals/headless-runs/<stamp>/<task>-r<n>.jsonl`，统计 pass/fail、工具错误、未验证、超时。前置：headless profile 可解析 `dsh-win-computer-use`；`DSH_BIN` 可覆盖 dsh entry；`TEMP/TMP` 自动归一化。2026-11-12 两轮 smoke **7/8**（Round 2 4/4）；详见 [EVIDENCE](EVIDENCE.md) §7.3。

> **Web runner 已退役**：`evals/run.mjs` 的 UI 选择器/发送路径基于 dsh 0.1.5；在 0.2.2 上创建空会话、`steps` 误读。现在默认拒绝运行并提示改用 headless runner（`--allow-legacy-web` 仅旧 UI 调试，`--dry-setup` 仍可用）。

## 5. 真桌面闭环

```bash
node tests/live-action.e2e.mjs 3
```

设计要点：

- 用**唯一命名临时文件**打开记事本，做确定性窗口选择，避免桌面已有多个记事本时选错；
- 流程：observe(ax) → 找文档元素 → `computer_type`（`effect:confirmed`）→ **脚本自读 UIA 文档文本含标记**（独立见证）→ `computer_verify` 窗口谓词 satisfied / 自输入文本 `unknown+untrusted_source` → 未知参数拒绝 → 剪贴板往返 → `computer_wait`；
- 不杀进程：Win11 记事本可能同时持有用户未保存文档；脚本只报告残留标签，由人工关闭；
- 最近一次：23/23（2026-09-17，重设计后）；0.52.13 canary 33/33（详见 [EVIDENCE](EVIDENCE.md) §3.2）。

## 6. S4 任务级评测（`evals/`）

```bash
node evals/headless-run.mjs --tier smoke --timeout-min 10
node evals/headless-run.mjs --tasks t01 --repeats 3 --timeout-min 10
node evals/headless-run.mjs --tier all --timeout-min 10
node evals/verify-oracles.mjs
```

- 任务集 17 条：冒烟 4（t01/t04/t07/wa2）+ 核心 6（t03/t05/t06/t09/t10 + x1 委派通道）+ dirty 7（t11 Paint/t12 PPT/t13 论文/t14 Excel/t15 Explorer/t16 表单/t17 PDF 摘录）；退役任务见 [evals/README](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/evals/README.md)。
- oracle 一律 PowerShell/Win32 确定性读，不用模型自评；`setup` 预置到决策点，`oracle` 判定，`cleanup` 清沙箱，`simulate` 用于 AC2 双向验证。
- `verify-oracles` 判据：setup 必 ok → oracle 空跑必失败 → simulate 后必通过 → cleanup 干净；**2026-11-12 复跑 10/10**（含 `x1`）；2026-11-15 18:40 复跑 **10/10**。若 PowerShell 报 `Add-Type` 找不到 `C:\Windows\TEMP\*.cs`，先把 `TEMP`/`TMP` 指到 `%LOCALAPPDATA%\Temp`。
- 报告（`evals/report-last*.json`）是**真值产物，不入库**；仓库只进 runner/任务/oracle。
- 基线不是通过率承诺；逐轮结果见 [EVIDENCE](EVIDENCE.md)。

### 6.1 verifyAfterAction A/B

只改配置，不改插件默认值。两份 patch 除 `verifyAfterAction` 外必须完全一致；实验 patch 放 `evals/headless-runs/ab/`（gitignore），不提交。

```bash
node evals/headless-run.mjs --tasks t01 --repeats 5 --timeout-min 12 \
  --patch evals/headless-patch.yml --report evals/headless-runs/ab/off-t01.json
node evals/headless-run.mjs --tasks t01 --repeats 5 --timeout-min 12 \
  --patch evals/headless-runs/ab/verify-auto.yml --report evals/headless-runs/ab/auto-t01.json
node evals/ab-summary.mjs --dir evals/headless-runs/ab --tasks t01,t05
```

- 交替跑 off/auto（每轮 `--repeats 1` 最稳）抵消机器漂移；两臂不要并发。两臂 patch 必须都固定 `agent-default-model`；dsh 0.2.2 不支持 seed/top_p，重复测试只能按统计分布解读。
- report 带 `patchPath/patchSha256/wallMs/innerSteps`；trajectory 分析用 `node evals/analyze-trajectory.mjs <file> --json`。
- 决策规则：pass 不下降；median steps/duration 不恶化超过约 15%；p90 不恶化超过约 25%（n<8 标 `p90Unstable`）；没有新增 dirty/timeout；strategy 分布不更偏 exploratory。否则保持 `off`。
- 2026-11-16 首轮 **10/10 pass**；auto 中位略优但有 533s 尾部、每轮多 2–12 次复核，默认保持 `off`。详见 [EVIDENCE](EVIDENCE.md) §5.3。

### 6.2 脏桌面套件（t11-t17）

这组任务不建干净 VM/专用 Windows 用户，直接使用当前桌面和用户已打开的应用；通过 task md 的 `- **isolation: dirty**` 跳过 Notepad TabState backup。用户已有 Notepad/Paint/Office/浏览器窗口不关；只关闭 setup 记录的“测试新建 HWND/文档”，证明不了就 `leftover + dirty`。

| id | 任务 | 依赖 | oracle |
|---|---|---|---|
| t11 | Paint 鼠绘复刻 | Paint + 浏览器参考窗 | PNG 800x600 + 三色 ROI mask/bbox/覆盖率容差 |
| t12 | PPT 布局复刻 | PowerPoint + 浏览器参考窗 | 单页 16:9 seed + 预填 title/subtitle + 3 个灰色占位柱 + `seedHash` 变化 + PPTX XML 文本/颜色/位置（无 COM） |
| t13 | 论文下载 | 用户浏览器 + 网络 | 用户 Downloads 中新增 PDF 的 SHA-256 |
| t14 | Excel 数据+柱状图 | Excel | XLSX XML 单元格 + chart part；seedHash 未变 |
| t15 | Explorer 多文件整理 | Explorer | 精确文件系统终态（8 文件，先重命名再移动） |
| t16 | 本地浏览器表单 | 用户浏览器 + 本地 server | result.json 精确字段 |
| t17 | PDF 定位+摘录 | 浏览器 PDF + Excel | XLSX A1 精确文本（不 Trim）+ seedHash 未变；setup UIA page-3 readiness |

```bash
node evals/verify-oracles.mjs --tasks t11,t12,t13,t14,t15,t16,t17
node evals/headless-run.mjs --tasks t15 --repeats 5 --timeout-min 20 --patch evals/headless-patch.yml
```

- `ac2: none`（t12/t13/t14/t17）在 verify-oracles 中显示 **SKIP**，表示 setup/oracle-empty/cleanup 已验，但无 simulate；不是假 PASS。
- setup ENV（应用缺失/网络不可达/浏览器不能新开窗口）在 headless-run 记 `verdict=env`，不混入 pass/fail。
- t13 复用用户浏览器：下载目录是真实 Downloads；oracle/cleanup 只考虑任务开始后新增且哈希匹配的 PDF，绝不删除用户已有文件。
- 逐轮步数与失败样本见 [EVIDENCE](EVIDENCE.md) §2–§5；模型行为分析见 [TRAJECTORY-ANALYSIS](TRAJECTORY-ANALYSIS.md)。

## 7. 回归守门（代表性缺陷）

| # | 缺陷 | 根因 | 守门 |
|---|---|---|---|
| 1 | 插件整棵树加载失败 | 丢了 `defineTool()` 返回值；原始字面量被 `assertSupportedJsonSchema` 拒 | 真机 headless 探针（离线假注册表无校验） |
| 2 | 所有工具调用报 `reading 'kind'` | 订阅 `tools/post-execute` waterfall 却不调 `next()` | 真机探针 + 约定：只订阅 `tools/result` |
| 3 | 观测降级整次 `invalid output` | 降级回执字段未声明 | `schema.conformance` 降级场景 |
| 4 | 结构化拒绝被当成功 | `{refusal:{code}}`/`effect:refused` 分散判断 | `receipt.js` 单一出口 + schema 拒绝场景 |
| 5 | 坐标点击整体偏移 | 元素 frame 是屏幕 px，点击是窗口截图 px | 坐标标定 + observe 输出换算 |
| 6 | Windows 密码框保护静默失效 | guard 只匹配 macOS 角色 | `roles.js` 三态 + sidecar 结构位 |
| 7 | 结构密码标记标错相邻元素 | 旧假设“窗口本地+原点换算” | A6 端到端 + 屏幕坐标直配 |
| 8 | `type`/`key` 盲发前台 | 无 element/无快照时退回 desktop | `action-bounds` P0-1/2 |
| 9 | `suspected_noop` 报成功 | `engineRefusal` 未识别 | `action-bounds` P0-4 + `receipt` |
| 10 | 指定窗口未匹配却观察最前窗口 | 静默回退 | `action-bounds` P0-5 |
| 11 | 观察降噪误判“未变” | 旧哈希只看 label | `observe.dedup` 值/enabled/selected/actions |
| 12 | 投递链测试测的是复刻 | 测试替换整个 `lib/cua.js` | `delivery-chain` 真实函数 + `opts.call` |
| 13 | 文本元素坐标与点击空间不一致 | `renderLine` 用原始 frame，结构元素已减原点 | `observe.coords` + `verify-runtime` #8 |
| 14 | `menu` 把 `effect:unverifiable` 报成功 | 只判 refusal | `menu.receipt` |
| 15 | eval setup/cleanup 危及用户 Notepad | 按进程名/宽匹配杀 | `eval-safety` + `Open/Close-TestNotepad` |
| 16 | 元素点击绕过 TTL + 滑行偏移 | 快照存屏幕坐标；resolve 不查 freshness | `human.click` + `observe.coords` |
| 17 | 投递失败被当成功 | `engineRefusal` 不认 delivery codes | `delivery.failures` + `delivery-chain` |
| 18 | 新 Notepad 窗口恢复用户标签 | 只比较 HWND 新旧 | `notepad-tabs` + `eval-safety` |
| 19 | 元素点击滑行跨屏大弧线 | 屏幕坐标起点未减窗口原点 | `human.click` + trajectory |
| 20 | 另存为文件名盲区导致保存循环 | observe 用 `label || value`，隐藏旧值 | `observe.truth` + `action.echo` |
| 21 | 强制前台失败后无路可走 | force 直接返回，不尝试 `bring_to_front` | `delivery.foreground` + `delivery-chain` |
| 22 | 连续点击同一目标 | 回执 unverifiable + 无重复抑制 | `action.echo` + `loopGuard` |
| 23 | 5 段滑行 15–18s/点击 | 驱动单次移动 2–3s；旧 auto 仍 5 段 | `human.click` + `cursorMotion` |
| 24 | 轨迹工具计数翻倍 | 外壳与内层都记 `tool_end` | `trajectory.test` |
| 25 | 裸 `screenshot_context_missing` 假成功 | `engineRefusal` 不认裸 code | `action.echo` E31/E32 + `action-bounds` D11/D12 |
| 26 | native 观察无 snapshot id | 只 ax 分支打印 id | `observe.coords` C19/C20 + `verify-runtime` #11 |
| 27 | 密码框点击回显值 | `describeClickTarget` 未查 `is_password` | `action.echo` E33 |

## 8. 新增测试/工具

新增工具时至少补：

1. `schema.conformance`：正常/守卫拒绝/驱动拒绝/降级等返回形态；
2. `dispatcher.test`：若隐藏，校正 catalog 与可见/隐藏数量；若热工具，校正 hybrid 面；
3. `action-bounds`：无快照、窗口绑定、参数缺失/未知参数；
4. `config.plumbing`：若新增配置键，补 schema↔cfg↔读取点与行为哨兵；
5. `package-manifest`：若新增发布文件/依赖/权限，更新断言；
6. `docs/TOOLS.md` / `docs/CONFIGURATION.md` / `docs/ERRORS.md`：同步契约；跑 `npm run docs:check`；
7. 真机：`verify-runtime`（只读）与必要的 live e2e。

改工具描述/参数时，建议在**仓库外**跑一次性工具面 JSON dump（描述/参数/输出 schema/render/execute arity），改前存基线、改后 diff；工具面是模型看到的全部接口，漂移即回归。

## 9. 排障

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERR_MODULE_NOT_FOUND @deepseek-ai/schemastery` | `node_modules/@deepseek-ai` 为空 | `npm install`（peer/dev 依赖已声明） |
| `npm test` 输出全绿但退出码非 0 | 只看了前面套件输出 | `npm test; echo $?`；用 `set -e` |
| schema 测试报 `undeclared property` | 输出多返回了字段 | 补 schema 或删字段；保持 `additionalProperties:false` |
| 真机 native 整次失败 | 宿主严格输出校验 + 降级字段漏声明 | 跑 `schema.conformance` 的降级场景 |
| live e2e 选错窗口 | 桌面有同名/残留记事本 | 用唯一命名临时文件；按标题精确匹配，不按进程名 |
| 截图断言 0B | 选中 `0×0` shell 弹窗 | 选择窗口要求 `bounds > 0` |
| `verify-runtime` 失败 | 驱动自身/空窗口被选中 | 排除 `cua-driver` 进程名与 `0×0` 窗口 |
| evals 某个任务超时 | 残留窗口/驱动 daemon 挂死 | 先 `maintain.mjs`/`stop-stale.mjs`；清理残留后复跑 |
| Windows 动态 import 报绝对路径 | ESM 需要 URL | 用 `pathToFileURL()` |
| `docs:check` 报链接/数字不一致 | 文档漂移 | 按 file:line 修；数字以 `tests/docs.facts.json` 为准 |

## 10. 当前基线

| 项 | 值 |
|---|---|
| 离线 | 26 套 / 634 ✅ / 0 ❌ |
| 语法 | 26/26 JS + `bash -n` 两脚本 + 文档检查 |
| 运行时 | `verify-runtime` 18/18（Windows 11；0.23.2 基线 + 0.52.13 canary） |
| dsh 真机 | headless 1 轮 5 步（2 可见/21 隐藏；2026-11-12 当时 20 隐藏）；S4 smoke 两轮 7/8（Round 2 4/4）；t01 新题面 5/5；t05 3/3 |
| dirty 真机 | 最新：t11 70 步 pass、t12 100 步 pass（2026-11-18，0.52.13 + opencode-go）；t14/t15/t17 见 EVIDENCE |
| 真桌面 | `live-action.e2e` 23/23（2026-09-17） |
| 评测 | `verify-oracles` 2026-11-15 18:40 复跑 10/10；17 条任务；AC2 `ac2:none` 的 SKIP 不是 PASS |
| 打包 | 以 `npm pack --dry-run --json` 为准；当前值见 `tests/docs.facts.json` |

> 逐轮时间线、工具计数、失败模式见 [EVIDENCE](EVIDENCE.md)；模型行为分析见 [TRAJECTORY-ANALYSIS](TRAJECTORY-ANALYSIS.md)；当前矩阵见 [VERIFICATION](../VERIFICATION.md)。
