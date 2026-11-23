# 评测任务手册（S1-S4）

> 目的：定义 S1-S4 测试阶段、任务成员、oracle 契约、runner、verdict 语义与 dirty 规则；逐轮运行结果见 [docs/EVIDENCE.md](../docs/EVIDENCE.md)。
> 读者：维护者/评测者。`evals/` **不进入 npm 发布包**。
> 状态：内部开发手册（最后核对 2026-11-23）。P2 已落地：`variants`/`S4_VARIANT` 参数化、`probe-platform`、虚拟桌面 BLOCKED。
> 相关：[TESTING](../docs/TESTING.md) · [TRAJECTORY-ANALYSIS](../docs/TRAJECTORY-ANALYSIS.md) · [WINDOWS](../docs/WINDOWS.md) · [COVERAGE](COVERAGE.md)。

> **命名说明（2026-11-19）**：本文的 S1-S4 是**测试阶段**，S4 只表示 Dirty 阶段。旧文档里的 `S4` 指 0.5.4 的整套评测系统，已全局改称 `eval`；旧 `S2` 是像素定位修订，`S3a`/`S3b` 是视觉断言/观察者工作流，均改为描述性名称。`S4_*` 环境变量、`~/.dsh/s4-evals/` 与 `S4 Bar` 等 fixture 字符串是冻结兼容名，不代表新阶段。

## 1. 阶段与任务

| 阶段 | 定义 | 非任务层 | 任务成员 |
|---|---|---|---|
| **S1 基础功能** | 单应用、确定性终态、基本 UI 原语 | 离线 33 套 / 1021；`verify-runtime` 18；`live-action.e2e` 33；`probe-winui-keys` | t01/t03/t04/t05/t06/t07/t09/t10/t21/wa2（10） |
| **S2 像素定位** | 坐标、像素、拖拽、zoom/from_zoom | `observe.coords`、`human.click`、`action-bounds` 坐标用例；`probe-from-zoom`/`probe-modifier`/`probe-private-drag`/`probe-driver-shape`/`probe-native-freshness` | t11 / dpi01 / p01 / p02 / p03（5） |
| **S3 覆盖面任务集** | 多应用/文件/Office/浏览器/委派/导航/对话框/恢复/安全契约 | — | t12–t20、t22、t23、w01/w02/sec01–sec04/rec01–rec03/combo01/combo02/b01/term01/a11y01/x1（26） |
| **S4 Dirty 能力任务集** | 脏桌面下的任务收敛、焦点、用户状态保留与清理 | `probe-combo-foreground` | t11–t18/t23/sec01–sec04/combo01/combo02/rec02/rec03（17） |

**阶段是成员标签，可重叠**：`S1 10 / S2 5 / S3 26 / S4 17`，成员合计 **58**，唯一任务 **41**。t11 = S2+S4；t12–t18 = S3+S4；t23/sec01–sec04/combo01/combo02/rec02/rec03 也含 S4；x1 = S3。

边界必须明确：

- **S2 的 p01-p03 需要 image 能力**（native/zoom/vision）；text-only 路由会失败，不写 ENV。
- **S4 已给 t11-t18 / t23 / sec01–sec04 / combo01 加 sentinel**：setup 打开测试自建的最小化窗口 + sentinel 文件，oracle 断言窗口/身份/文件未变；cleanup 只关测试自建对象。`isolation: both` 的任务在 clean 模式不建 sentinel，在 dirty 模式建。
- **t13 仍是真实网络下载，`ac2:none`**；t18 是本地 HTTP 下载，`ac2:full`，覆盖下载链路的正向验证。
- S3 的 t12-t18 同时是 dirty 任务；S3 测覆盖面，S4 测脏桌面执行，两者是不同维度。

## 2. 任务表

| id | 任务 | stages | tier | isolation | AC2 | 备注 |
|---|---|---|---|---|---|---|
| t01 | Notepad 输入两行并原地保存 | S1 | smoke | notepad | full | 唯一命名 seed |
| t03 | Explorer 就地重命名 | S1 | core | notepad | full | 有 `keep.txt` 哨兵 |
| t04 | Calculator 多步乘法 | S1 | smoke | notepad | full | oracle 绑定 owned HWND |
| t05 | Notepad 另存为 + ANSI | S1 | core | notepad | full | 非 ASCII `é` 才证明 ANSI |
| t06 | 剪贴板粘贴保存 | S1 | core | notepad | full | |
| t07 | 窗口最大化并保持 | S1 | smoke | notepad | full | oracle 绑定 setup HWND |
| t09 | Paint 填充纯红并保存 | S1 | core | notepad | full | 不杀 mspaint |
| t10 | 两 Notepad 文档内容互换 | S1 | core | notepad | full | 双文件 state |
| t11 | Paint 鼠绘复刻 | S2, S4 | core | dirty | full | PNG ROI mask |
| dpi01 | 第二屏窗口点击 | S2 | core | clean | full | 第二屏 fixture；无第二屏 ENV |
| t12 | PPT 16:9 布局复刻 | S3, S4 | core | dirty | full | PPTX fixture simulate |
| t13 | 论文下载 + SHA-256 | S3, S4 | core | dirty | none | 真实网络；只删新增匹配 PDF |
| t14 | Excel 表格 + 原生柱状图 | S3, S4 | core | dirty | full | XLSX fixture simulate |
| t15 | Explorer 8 文件整理 | S3, S4 | core | dirty | full | 文件系统终态 |
| t16 | 本地浏览器表单 | S3, S4 | core | dirty | full | result.json |
| t17 | PDF 句子摘录到 Excel | S3, S4 | core | dirty | full | A1 精确文本；fixture simulate |
| t18 | 本地 PDF 下载 | S3, S4 | core | dirty | full | 本地 HTTP + hash-pinned fixture |
| t19 | Explorer 地址栏导航 | S3 | core | notepad | full | 从用户目录导航到沙箱；允许 Notepad 另存为（不证明 Explorer 新建） |
| t20 | 对话框取消/确认链 | S3 | core | notepad | full | WinForms confirm/cancel；允许 Tab/Enter/Escape 选择按钮 |
| t21 | Calculator 除法 | S1 | smoke | clean | full | 第二条 Calculator；3 个 variant 不同除法 |
| t22 | PPT 标题/副标题编辑 | S3 | core | clean | full | 第二条 PowerPoint；seed 与目标文本 3 个 variant |
| t23 | 三按钮/嵌套对话框 | S3, S4 | core | both | full | 第二条 WinForms；clean/dirty 双模式 |
| w01 | Word 编辑并原地保存 | S3 | core | clean | full | DOCX XML oracle |
| w02 | Word Save As 新路径 | S3 | core | clean | full | 源 seed hash 不变 |
| sec01 | 密码框硬拒绝 | S3, S4 | core | both | full | 密码长度 0 + 普通框正向控制 |
| sec02 | allowedApps 拒绝 | S3, S4 | core | both | full | Notepad 允许 + PowerShell fixture 拒绝 |
| sec03 | stop/resume 锁存 | S3, S4 | core | both | full | Click 计数恰为 1 |
| sec04 | 快照 TTL 拒绝 | S3, S4 | core | both | full | 正向控制 + 过期点击计数 0 |
| rec01 | 从 draft 恢复 | S3 | core | clean | full | 应用关闭后重开并保存 final.txt |
| combo01 | PDF→Excel→PPT | S3, S4 | core | dirty | full | 三应用链；A1=42 + PPT 文本 |
| combo02 | 下载 CSV→Excel→图表 | S3, S4 | core | dirty | full | 本地 CSV + XLSX 图表 |
| rec02 | 模态恢复 | S3, S4 | core | both | full | 关闭模态后继续 |
| rec03 | 断网重试 | S3, S4 | core | dirty | full | 首次 500，重试成功 |
| term01 | PowerShell 终端 | S3 | core | clean | full | 控制台输入 + 文件 oracle |
| a11y01 | 键盘-only 完成 | S3 | core | clean | full | 无鼠标；UIA 名称/键盘焦点；3 个输入 variant |
| b01 | 浏览器多标签表单 | S3 | core | clean | full | 本地 tabs + form |
| p01 | 无坐标 canvas 目标点击 | S2 | core | notepad | full | 红圆/格子 C2 |
| p02 | 像素 token 读取输入 | S2 | core | notepad | full | canvas code P02-7K9 |
| p03 | screen_zoom 小目标点击 | S2 | core | notepad | full | D3 / from_zoom |
| wa2 | 设文件隐藏（WAA 本地化） | S1 | smoke | notepad | full | 时间预算敏感 |
| x1 | 委派通道集成验证 | S3 | core | notepad | full | 必须 `computer_task` |

## 3. 目录约定

```text
evals/
  tasks/            41 个任务 md（id = 文件名前缀）
  setup/            41 个 setup.ps1
  oracle/           41 个 oracle.ps1
  cleanup/          41 个 cleanup.ps1
  simulate/         40 个 simulate.ps1（t13 仍 ac2:none）
  variants/         参数化任务数据（t21/t22/a11y01 各 3 个 variant；唯一数据源）
  fixtures/         t12/t14/t17/t18/combo01 成功态夹具（测试输入，不是测量产物）
  mutate/           release.ps1 + apply.ps1（oracle 变异，不是任务）
  lib/              common.ps1 / tabstate.ps1 / image.ps1 / office.ps1 / sentinel.ps1 / security-fixture.ps1 / env-info.ps1 / win-gaps.ps1 / form-server.mjs / cdp.mjs / run.mjs
  headless-run.mjs  当前 runner（--stage / --tasks / --tier / --isolation / --variants）
  verify-oracles.mjs  AC2 双向验证（--variants 对声明任务逐 variant 跑）
  oracle-mutation.mjs 错误但像成功的产物必须让 oracle 失败
  ac6-summary.mjs   per-task token/步数汇总
  analyze-trajectory.mjs / analyze-sessions.mjs / ab-summary.mjs
  probe-*.mjs       真机探针（不加入 npm test）；probe-modal-* 是模态根因，probe-native-dialog 是私有原生对话框后端，probe-common-dialogs 覆盖 Open/Save/Font/Color/Print，probe-gesture-truth 对比 driver/private 手势，probe-wpf-dialog/probe-chromium-dialogs 覆盖 WPF/浏览器 UI，probe-cross-il 是 UIPI/跨 IL 探针，probe-background-input 是实验性后台输入，probe-platform 是只读平台/套件可用性，probe-ptc-web 是临时 Web profile + WPF fixture 的 PTC 四阶段真机探针
  headless-patch.yml / headless-patch.opencode.yml / headless-patch-xamlfallback.yml
  headless-patch.sec02.yml / headless-patch.sec04.yml  安全负向任务的 allowedApps / ttlMs overlay
  COVERAGE.md / coverage.json  热点覆盖矩阵（当前 12 个热点）
  RETIRED.md        退役任务/runner 台账
  BLOCKED.md        未覆盖/无法证明的能力（不计入 pass）
  headless-runs/    运行产物（gitignore）
  verify-runs/      验证产物（gitignore）
  mutation-runs/    变异产物（gitignore）
```

- 任务沙箱：`%USERPROFILE%\.dsh\s4-evals\<taskId>\`（历史命名，冻结）。
- `run.mjs` 是 dsh 0.1.5 时代的 Web runner，已退役；默认拒绝运行并指向 `headless-run.mjs`。它不识别 `--stage`，`--dry-setup` 仍可用于只跑 setup/oracle/cleanup 链。
- runner 从仓库 `package.json` 读插件版本；`pluginVersion` 不是从 web profile 读。

## 4. 环境知识

通用窗口/标签清理规则（绝不按进程名杀、WM_CLOSE 限制、TabState 隔离）见 [WINDOWS §7](../docs/WINDOWS.md)；以下是 eval 侧的执行细则：

1. **TEMP**：若 `TEMP=C:\Windows\TEMP`，PowerShell `Add-Type` 可能报“未能找到源文件 …*.cs”；跑 eval 前把 `TEMP`/`TMP` 指到 `%LOCALAPPDATA%\Temp`。
2. **Notepad TabState**：Win11 Notepad 会从 `TabState/*.bin` 恢复会话；**新 HWND 不等于干净窗口**。runner 在非 dirty 任务前 `tabstate.ps1 backup`，每个任务前清 eval bin，全部任务后 `restore`。
3. **用户窗口**：已有 Notepad/Paint/Office/浏览器窗口不关；只关 setup 记录的测试 HWND/标签；证明不了就 `leftover + dirty`。
4. **浏览器**：t13/t16/t17 复用用户会话；`--new-window` 后要求新 HWND；只关该 HWND；t13 只删任务开始后新增且 SHA-256 匹配的 PDF；绝不关浏览器进程/窗口。
5. **PowerPoint/Excel 单实例**：只关 setup 记录的测试 HWND；oracle 只读 OOXML ZIP/XML，不实例化 COM；禁止 `Quit`/`Presentations.Close` 全部。
6. **Paint 11 标签页**：要求测试 seed 的唯一 HWND/标签；只能并入用户窗口时 setup 记 ENV 或 cleanup dirty。

## 5. 模型通道

- 基线 overlay `headless-patch.yml`：启用 `credentials`，模型 `deepseek-official/deepseek-flash`。
- 2026-11-20：默认 DeepSeek 通道返回 `QUOTA` 402（余额不足），本轮 t19/t20/p01-p03/AC6 真跑改用 opencode overlay；ENV 不记为任务失败。
- opencode overlay `headless-patch.opencode.yml`：`llm-pi-ai` provider `opencode-go`、模型 `deepseek-v4.1-flash`、1M context / 128K output / text+image；必须带请求头 `x-opencode-session`（dsh 0.2.2 的 provider 要求；缺失会 400 `MissingSessionID`）。
- key 只从 `~/.dsh/.credentials.yaml` 读取；不要写进仓库、不要打印。
- dsh 0.2.2 不支持 seed/top_p；重复测试只能按统计分布解读，不能做严格 A/B 因果。

## 6. 元数据

任务 md 统一结构（示意，条目缩进两格避免污染大纲）：

```text
# tXX · name
  - **stages: S1**            # 或 S2/S3/S4；至少一个
  - **tier: smoke|core**      # 旧调度标签，不是阶段
  - **isolation: notepad|clean|dirty|both**   # 含 S4 ⇔ dirty/both
  - **ac2: full|none**
  - **app: notepad**          # 列表；值必须在 coverage.json majorApps（或 other）
  - **hotspot: uia-element**  # 单值；值必须在 coverage.json hotspots（或 other）
  - **requires: notepad**     # 可选；声明依赖应用（文档用途）
  - **variants: 3**           # 可选；1..9，>1 时必须有 evals/variants/<id>.json
  - **require_tool: computer_task**    # 可选，仅 x1
  - **security: password**    # 可选列表；值必须在 coverage.json security
  - **security_expect: refuse|allow**   # security 任务必填，且必须声明 require_tools
  ## Prompt
  <<<PROMPT
  ...
  PROMPT>>>
  ## Notes
```

规则由 `node tests/tasks.check.mjs` 强制：

- `stages` 必填、去重、只允许 S1-S4；含 S4 ⇔ `isolation: dirty`。
- `ac2: full` ⇔ 存在 `simulate/<id>.ps1`；`ac2: none` 不得有 simulate。
- 每条任务必须有 setup/oracle/cleanup 和 prompt 块。
- `app` 是列表且非空，每个值必须是 [coverage.json](coverage.json) 的 `majorApps`（或 `other`）；每个主要应用 ≥2 条任务由 tasks.check 强制。
- `hotspot` 单值且非空，必须是 coverage.json `hotspots` 键（或 `other`）；热点正向/负向证据由 coverage.json 校验。
- 声明 `security` 的任务必须给出 `security_expect: refuse|allow` 并声明 `require_tools`；语义矩阵见 [COVERAGE](COVERAGE.md) §4。
- `variants` 必须是 1..9；>1 时 `variants/<id>.json` 的 key 必须恰为 1..N，prompt 中每个 `{{key}}` 在所有 variant 中都存在，且 setup/oracle/simulate 至少一处读取 variant（`Get-S4VariantData`/`Get-S4VariantNumber`/`S4_VARIANT`）。
- 任务 ID 取文件名第一个 `-` 前的前缀；不重命名 `tXX`/`wa2`/`x1`。

## 7. 运行语义

```text
cleanup -> setup -> dsh --profile headless --patch <overlay> --json -> oracle -> cleanup
```

- `setup` 预置到决策点；`oracle` 判定；`cleanup` 清沙箱；`simulate` 用于 AC2 双向验证。
- oracle 契约：**exit 0 = pass，1 = fail，2 = environment error**；stdout 一行 JSON。
- cleanup `dirty`：pass 改记为 `dirty`，汇总 `dirty=N`，进程退出非 0；不再把“留窗/残留对话框”当干净通过。
- setup ENV（应用缺失/网络不可达/浏览器不能新开窗）：`verdict=env`，不混入 pass/fail。
- `ac2: none` 的任务在 `verify-oracles` 显示 **SKIP**（setup/oracle-empty/cleanup 通过，无 simulate）；**SKIP ≠ PASS**。
- timeout 不跑 oracle；cleanup 在 `finally` 里执行。
- `--json` stdout 是截断视图；完整复盘用 session 文件或 trajectory JSONL。

## 8. 运行命令

```bash
# 阶段过滤（S1-S4 可逗号并集）
node evals/headless-run.mjs --stage S1 --timeout-min 10
node evals/headless-run.mjs --stage S2,S4 --timeout-min 15

# 旧调度标签仍可用；--tasks 优先于 --stage/--tier
node evals/headless-run.mjs --tier smoke --timeout-min 10
node evals/headless-run.mjs --tasks t01 --repeats 3 --timeout-min 10

# 参数化：声明 variants 的任务跑 1..N；未声明任务只跑 variant 1
node evals/headless-run.mjs --tasks t21,t22,a11y01 --variants 3 --timeout-min 10

node evals/verify-oracles.mjs --stage S4
node evals/verify-oracles.mjs --tasks t11,t15
node evals/verify-oracles.mjs --tasks t21,t22,a11y01 --variants 3

# oracle 反向敏感性：错误但像成功的产物必须 exit 1
node evals/oracle-mutation.mjs
node evals/oracle-mutation.mjs --tasks t01,t16,t20

# 真机探针（自建窗口；不需要模型）
node evals/probe-ops.mjs
node evals/probe-launch.mjs
# PTC live（需要 dsh/model/driver；临时 Web profile + WPF fixture；不加入 npm test）
node evals/probe-ptc-web.mjs
node evals/probe-display.mjs          # 只读 monitor/DPI/virtual screen；单屏 BLOCKED
node evals/probe-win-gaps.mjs         # 只读 VS Code/VLC/Settings/WSL/CJK 语言清单
node evals/probe-platform.mjs         # 只读平台/套件可用性；非 Windows BLOCKED（Linux 非门禁）
node evals/probe-modifier-drop.mjs
# t20 模态根因：AX 预算/阻塞矩阵（~75s）与原生 Win32 逃逸路径（~3min；--trigger-only 只跑触发侧）
node evals/probe-modal-timeout.mjs
node evals/probe-modal-escapes.mjs
node evals/probe-modal-escapes.mjs --trigger-only
# 插件侧原生对话框后端：UIA trigger → native-dialog observe → BM_CLICK No（~10s）
node evals/probe-native-dialog.mjs
# 常见对话框后端：Open/Save/Font/Color/Print 的标准 #32770 + Cancel BM_CLICK（~20s）
node evals/probe-common-dialogs.mjs
node evals/probe-common-dialogs.mjs --strict-blocked
node evals/probe-gesture-truth.mjs       # 对比 driver 原生 vs private SendInput 的 down/move/up + Ctrl
node evals/probe-wpf-dialog.mjs          # WPF 模态 class/owner/UIA/capture-only
node evals/probe-chromium-dialogs.mjs --browser chrome   # file chooser / print preview（当前 BLOCKED）
node evals/probe-cross-il.mjs --no-uac   # 只读 IL/分类器
node evals/probe-cross-il.mjs --uac      # 一次授权 UAC；测试自建 elevated sink
# 原生 Button 触发：WinForms Delete + MessageBox；1.2s 触发、native-dialog 关闭、10s latch（~10s）
node evals/probe-native-button.mjs
# Excel Ctrl+drag：UIA DataItem 几何 + OOXML 校验；--excel-only 跳过 Explorer 部分
node evals/probe-modifier-drop.mjs --excel --excel-only
# B2 严格 BlockInput 根因：一次性 UAC 提权探针（不改生产路径）
node evals/probe-b2-elevated.mjs
# 完整后台输入探针；--elevated 自提权跑严格 B2（UAC）
node evals/probe-background-input.mjs
node evals/probe-background-input.mjs --elevated
# 默认允许已知 BLOCKED（Excel 等），必须读输出；严格验收：
node evals/probe-ops.mjs --strict-blocked          # 有 BLOCKED 时 exit 2
node evals/probe-modifier-drop.mjs --excel --strict-blocked

# AC6 成本：先跑任务，再汇总 usage
node evals/headless-run.mjs --tasks t01,t05,t11,t14,t15 --repeats 5 --timeout-min 12 --report evals/headless-runs/ac6/report.json
node evals/ac6-summary.mjs --reports evals/headless-runs/ac6/report.json

node evals/analyze-trajectory.mjs <file> --json
node evals/ab-summary.mjs --dir evals/headless-runs/ab --tasks t01,t05
```

- `--tasks` > `--stage` > `--tier`；无参数仍按旧 `smoke` 运行，避免破坏 `npm run eval:headless`。
- `--stage` 无匹配时退出非 0，不静默成功。
- `--variants N`（1..9）对每个任务跑 `1..min(N, variants)`；report 每个 run 记录 `variant`，日志名为 `<task>-v<n>-r<n>`。mutation 固定 variant 1。
- `DSH_BIN` 可覆盖 dsh entry；`TEMP/TMP` 自动归一化。
- report 带 `stage/stages/isolation/ac2/patchPath/patchSha256/wallMs/innerSteps`；trajectory 路径记录在 report。
- 历史运行结果不在本文件维护，统一追加到 [docs/EVIDENCE.md](../docs/EVIDENCE.md)。

## 9. Report schema（摘要）

| 字段 | 含义 |
|---|---|
| `id` / `repeat` / `verdict` | 任务、轮次、pass/fail/**timeout**/error/env/dirty |
| `variant` / `variantsDeclared` | 本次 variant 与任务声明的 variant 数 |
| `variantData` | 本次 variant 的具体键值（`variants/<id>.json`；非参数化任务为 null） |
| `stages` / `isolation` / `ac2` | 阶段成员、隔离方式、AC2 状态 |
| `innerSteps` / `wallMs` | dsh 内部步数、墙钟 |
| `timedOut` / `budgetExhausted` / `noFinal` | 是否撞驱动超时、是否时间预算耗尽、是否没有 `final` 事件 |
| `toolCalls` / `toolErrors` / `unverified` | 工具调用、错误、未验证 |
| `requireTool` / `requireToolUsed` | 任务要求的工具及是否实际调用（x1） |
| `tokens` | `input/output/cacheRead/cacheWrite/total/steps`（来自 `status/step_end.usage`；total 含 cacheRead） |
| `modelRoute` | overlay 的 `agent-default-model` provider/model（summary 级；不读密钥） |
| `patchPath` / `patchSha256` | 使用的 overlay 与哈希 |
| `trajectory` | JSONL 路径（gitignored） |
| `oracle` | oracle stdout JSON / 失败原因 |
| `cleanup.dirty` / `leftovers` | 是否留窗/残留 |

## 10. 新增任务

1. 在 `tasks/` 加 md（`stages` + 元数据 + `<<<PROMPT` 块）；
2. 在 `setup/`、`oracle/`、`cleanup/` 加 PowerShell；需要 AC2 时加 `simulate/`；
3. oracle 必须确定性读（文件系统/OOXML/UIA/像素），不用模型自评；
4. `isolation: dirty` 的任务要记录测试 HWND/pid/start/title，cleanup 只关证明归属的对象；含 S4 的任务必须 dirty；
5. 声明 `variants: N` 时，在 `variants/<id>.json` 放 1..N 的键值，prompt 用 `{{key}}`，setup/oracle/simulate 通过 `Get-S4VariantData` 读同一份数据；
6. 跑 `node tests/tasks.check.mjs` 与 `node evals/verify-oracles.mjs --tasks <id>` 双向验证；参数化任务加 `--variants N`；
7. 更新本文件的任务表与 [docs/TESTING.md](../docs/TESTING.md)；
8. 不提交 report/trajectory/截图。

## 11. 基线政策

- **pass 不等于稳定**：t11/t12/t14/t15/t17 仍有方差。P0/P1 修复后 t19/t20/t05 各 2/2 pass、p01-p03 各 1 次 pass，且 t19 曾出现 40→70 inner 的轮间回归；完整数字与修复前对照见 [EVIDENCE](../docs/EVIDENCE.md) §19/§20/§21。单次 pass 只作为样本。
- **预算耗尽不是任务失败率**：`wallMs` 达到 `--timeout-min` 且没有 `final` 的样本单独计数，不与普通 fail 混比；报告里同时保留 `timedOut/noFinal` 便于区分“驱动超时”和“模型没跑完”。
- **t20 模态 30s 超时已有独立根因证据**：模态打开期间该进程 UIA provider 不服务跨进程请求（AX 树 1s/5s/15s 均 0 元素），驱动动作阻塞到模态关闭；`timeout_ms` 调大**不是**修复，不要把“调大预算”写成已解决。操作指引统一见 [WINDOWS §6.1](../docs/WINDOWS.md)；根因证据见 [EVIDENCE §18](../docs/EVIDENCE.md#18-2026-11-20--t20-模态-30s-超时根因探针)。
- p01-p03 需要 image 路由；opencode 通道已验证，text-only 路由失败不算 ENV。
- 基线比较必须同 overlay、同模型、同预算、同桌面状态；跨 provider 不是受控 A/B。
- 失败样本保留：环境态、模型策略、插件缺陷分开归因；修复后保留根因与守门测试。
- 不把 `dirty`、`SKIP`、`env` 计入 pass。
- t03/t04/t05/t07/x1 在 2026-11-19 有判定/题面变更；旧结果只作历史，不与新结果混比。

## 12. WAA 溯源与许可

`wa2-hide-file` 源自 Microsoft WindowsAgentArena（MIT）。任务 md 保留 `source: microsoft/WindowsAgentArena, MIT` 与本地化说明；其余任务为本仓库自有。引用的第三方任务不改变本仓库 MIT 许可。
