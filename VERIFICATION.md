# VERIFICATION — 当前验证矩阵

> 目的：把“声称支持”变成可复现的当前证据；逐轮历史见 [docs/EVIDENCE.md](docs/EVIDENCE.md)。
> 代码快照：`main` @ 2026-11-21（`package.json` 仍 0.5.8，npm 0.5.8 的 tag 在 `84225cc`）。main 包含未发布的 B0-B3/nativeMenus/nativeButtonTrigger 实验能力。
> 环境：Windows 11 x64 · DPI 150% · cua-driver **0.23.2 基线 + 0.52.13 canary** · dsh 0.2.2-rc.1/rc.2 · Node 22。
> 测试方法见 [docs/TESTING.md](docs/TESTING.md)；Windows 专项见 [docs/WINDOWS.md](docs/WINDOWS.md)；驱动层见 [docs/DRIVER-SDK.md](docs/DRIVER-SDK.md)。

## 1. 当前验证矩阵

| 验证面 | 结果 | 平台 | 证据 |
|---|---|---|---|
| 离线测试 | **31 套 / 772 ✅ / 0 ❌** | Windows（跨平台 Node 可跑） | `npm test; echo $?` |
| 语法/安装脚本 | **49/49 JS + 2 个 bash -n** | Windows | `npm run check` |
| 文档/任务一致性 | **✅**（工具/配置/错误码/链接/过期数字 + S1-S4 阶段/脚本/AC2） | 跨平台 | `npm run check` |
| 真驱动运行时 | **18/18**（0.23.2 与 0.52.13 均通过；含 native 文本快照 id） | Windows 11 | `node verify-runtime.mjs` |
| 驱动兼容层 | **✅**：0.23.2 与 0.53 fixtures 归一化一致；fake spawn 传输错误；真实 observe/refresh 端到端 | Windows（离线） | `tests/driver.*.mjs` |
| 0.52.13 canary 形态 | **✅**：默认 markdown/显式 elements、session 归属、capture-only 截图上下文、结构化非零退出 | Windows 11 / 0.52.13 | `evals/probe-driver-shape.mjs` |
| 手势探针 | click element/坐标的 Ctrl 到达；0.52.13 原生 modifier drag delivered；私有拖拽 3/3；from_zoom 命中 | Windows 11 | `probe-modifier` / `probe-private-drag` / `probe-from-zoom` |
| 组合键前台 | blocker 前台时插件 `key()` 自动前台目标并把 Ctrl+V 送进 WinForms | Windows 11 | `probe-combo-foreground.mjs` |
| native freshness | WinForms 文本变化窗口未复现“AX 已变而 PNG 不变” | Windows 11 | `probe-native-freshness.mjs` |
| 真桌面动作闭环 | **23/23**（2026-09-17 重设计后）；0.52.13 canary **33/33** | Windows 11 | `node tests/live-action.e2e.mjs 3` |
| eval oracle 双向验证（全量） | 2026-11-20：**22/23 PASS + t13 SKIP**（0 FAIL/ENV/dirty；t13 真实网络 `ac2:none`） | Windows 11 | `node evals/verify-oracles.mjs` |
| eval oracle（S1 + x1 clean 组） | **10/10**（t01/t03/t04/t05/t06/t07/t09/t10/wa2/x1；2026-11-15 18:40 复跑） | Windows 11 | `node evals/verify-oracles.mjs` |
| eval oracle（S4 dirty 组） | 2026-11-19：t12/t14/t17/t18 **PASS**（AC2 full；t18 本地下载）；t15 sentinel **PASS**；t13 真实网络 **SKIP**（不是 PASS） | Windows 11 | `node evals/verify-oracles.mjs --tasks t12,t14,t15,t17,t18,t13` |
| S2 像素任务 | 2026-11-19：p01/p02/p03 AC2 **3/3 PASS** | Windows 11 | `node evals/verify-oracles.mjs --tasks p01,p02,p03` |
| S3 导航/对话框 | 2026-11-20 题面修改后：t19/t20 AC2 **2/2 PASS**（setup → empty-fail → simulate ×2 → cleanup） | Windows 11 | `node evals/verify-oracles.mjs --tasks t19,t20` |
| 安全运行时探针 | 2026-11-20：**13/13 PASS**（密码拒绝、TTL 过期、stop/resume、驱动错误恢复；root 由 import.meta.url 推导） | Windows 11 | `node evals/probe-safety-runtime.mjs` |
| 滚动探针 | 2026-11-20：**3/3 PASS**（WinForms AutoScroll 向下/向上与位置回读；120s 自关 Timer） | Windows 11 | `node evals/probe-scroll.mjs` |
| 模态超时根因探针 | 2026-11-20：**AX 树 0 元素 @1s/5s/15s**；同 pid 主窗口同样 0；capture-only 1.5s；驱动 click/key/bring 阻塞；原生 `WM_COMMAND`/`BM_CLICK` 关闭成功；`timeout_ms` 重试**证伪** | Windows 11 / 0.52.13 | `node evals/probe-modal-timeout.mjs`；`node evals/probe-modal-escapes.mjs` |
| 原生对话框后端 | 2026-11-20：`probe-native-dialog` **9 PASS / 0 BLOCKED / 0 FAIL**；UIA trigger 打开 MessageBox → `screen_observe` native-dialog 2 按钮 → `computer_click(No)` BM_CLICK 关闭、state cancelled=1；double/key 明确拒绝 | Windows 11 / 0.52.13 | `node evals/probe-native-dialog.mjs`；`node tests/native-dialogs.test.mjs` |
| 实验性后台输入 | 2026-11-21：默认 `probe-background-input` **14 PASS / 1 BLOCKED / 0 FAIL**（严格 B2 非提权）；`--elevated`（UAC）**14 PASS / 0 BLOCKED / 0 FAIL**，严格 B2 125ms PASS（`inputBlocked=true`、`cursorRestored=true`、`inputUnblocked=true`）；`cursor-clip` **PASS**；B1 mouse-only 经 `syntheticPointer:promote` 收到 `MOUSEDOWN/MOUSEUP`；B1 光标用 helper `cursorDrift=0` 归因，外部漂移不再误判；B3 PASS | Windows 11 | `node evals/probe-background-input.mjs [--elevated]`；`node tests/background-input.test.mjs` |
| 原语矩阵探针 | 2026-11-21：**13 PASS / 0 BLOCKED**；double/right/key/hover/verify/wait_for/activate/app_list 均有 marker/回读；`nativeMenus:auto` 对 SetMenu fixture 通过（fixture 自检 GetMenu + 专用 marker） | Windows 11 | `node evals/probe-ops.mjs` |
| 原生 Button 触发 | 2026-11-21：**4 PASS / 0 BLOCKED / 0 FAIL**；自建 WinForms Delete + MessageBox：原生触发 1.2s、opened=1；native-dialog 点 No、cancelled=1；10s latch 阻止重复 | Windows 11 | `node evals/probe-native-button.mjs`；`node tests/native-button-trigger.test.mjs` |
| app 启动/收尾探针 | 2026-11-20：**7/7**；daemon High、`powershell.exe` 子进程 Medium；alt+F4 关闭、无残留、基线窗口保留 | Windows 11 / 0.52.13 | `node evals/probe-launch.mjs` |
| modifier-drop 探针 | 2026-11-20：**5/5**；Explorer Ctrl+drag 复制、普通 drag 移动、无卡键。2026-11-21：`--excel --excel-only` 分支已实现（Excel/COM 检测、临时 xlsx、UIA `DataItem` 几何、Ctrl+drag、Ctrl+S、OOXML 校验、精确 HWND 关闭），A2 保留但 E2 未复制 → **BLOCKED** | Windows 11 / Excel 16.0 | `node evals/probe-modifier-drop.mjs`；`node evals/probe-modifier-drop.mjs --excel --excel-only` |
| oracle 反向敏感性 | 2026-11-20：**19/19** 变异被 exit 1 拒绝；t04/t07 live GUI、t13 ac2:none SKIP | Windows 11 | `node evals/oracle-mutation.mjs` |
| 轨迹行为修复（P0/P1） | 2026-11-20：预填字段优先 `set_value`、超时不再被 preflight/activate/move_cursor 吞掉、超时候选/延迟成功、win 组合键 fail-closed、另存为目录提示/新值回执、menu `->`/`→`、无目标跳过 shell、TabState 隔离、runner `budgetExhausted`/`timeout` | Windows（离线 + 单测） | `npm test` 31/764；`node tests/proc-run.test.mjs` |
| 模型真跑样本（最新，P0/P1 后） | 2026-11-20：t20 **2/2 pass**（27/25 inner，626/601s；超时仍多，候选 window_id 已出现）、t19 **2/2 pass**（70/48 inner，652/454s；`win+r` 归零，但 r1 比上一轮更慢）、t05 **2/2 pass**（10/15 inner，86/106s；零 `type` 改文件名、无 `src` 残留）；0 timeout/dirty | Windows 11 / opencode-go | `evals/headless-run.mjs --tasks t19,t20,t05 --repeats 2 --patch evals/headless-patch.opencode.yml`；见 EVIDENCE §1.3 |
| 模型真跑样本（上一轮/修复前） | 上一轮：t20 27/25 inner（595/618s）、t19 40/56（387/595s）、t05 21/13（185/121s）；修复前：t19/t20 各 1 pass / 1 预算耗尽、t05 r4 43 inner/1.25M | Windows 11 / opencode-go | 见 EVIDENCE §1.1/§1.2 与 [TRAJECTORY-ANALYSIS](docs/TRAJECTORY-ANALYSIS.md) §11 |
| AC6 成本工具 | 2026-11-20：t01/t05 各 5 轮全 pass；t01 steps 中位 12/p90 15（p90Unstable，n=5<8）、billable 10,731；t05 steps 24/p90 47（p90Unstable）、billable 24,993；t11/t14/t15 未跑 | Windows 11 / opencode-go | `node evals/ac6-summary.mjs --reports evals/headless-runs/ac6/report.json` |
| S4 任务（dirty，最新） | t11 **70 步 pass**（oracle 22/22）、t12 **100 步 pass**（oracle 13/13）；同轮 `snapshot_mismatch` 均为 0 | Windows 11 / 0.52.13 / opencode-go | `evals/headless-run.mjs --tasks t11,t12`；见 EVIDENCE §3.1 |
| S1 任务（clean 组） | t01 新题面 **5/5 pass**（17/32/8/19/11 步）；t05 **3/3 pass**（26/28/19 步，dirty=false） | Windows 11 / dsh 0.2.2-rc.1 | `evals/headless-run.mjs`；见 EVIDENCE §5.3 |
| P0 判定绑定 | 2026-11-19 `t03/t04/t05/t07/x1` oracle **5/5 PASS**（setup → empty-fail → simulate ×2 → cleanup） | Windows 11 | `node evals/verify-oracles.mjs --tasks t03,t04,t05,t07,x1` |
| headless eval smoke | **7/8（两轮；Round 2 4/4）** | Windows 11 / dsh 0.2.2-rc.1 | 见 EVIDENCE §7.3 |
| 阶段过滤 | **S1 9 / S2 4 / S3 10 / S4 8**（成员 31，唯一 23）；`--stage` 无匹配退出非 0 | 跨平台（静态） | `node tests/tasks.check.mjs` |
| dsh 0.2.2 兼容升级 | **✅ P0/P1/P2**（`startActivation` / vision 默认 / 附件限额 / PTC） | Windows 11 / dsh 0.2.2-rc.1 | 见 EVIDENCE §7.4；契约矩阵见 [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) |
| 打包面 | 以 `npm pack --dry-run --json` 为准；当前值见 `tests/docs.facts.json` | — | `npm pack --dry-run --json` |
| npm / 部署 | **npm 已发布 `dsh-win-computer-use@0.5.8`；web profile 已安装 0.5.8 并切换配置（运行中的 web 进程需重启生效）** | — | `npm view dsh-win-computer-use version`；[PUBLISH](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) |

> 2026-11-19 复跑 `verify-runtime` 为 **18/18**。此前一次 17/18 是自动选中 `Microsoft.CmdPal.UI.exe`（AX 0 元素）；现已改为探测候选窗口，要求至少一个带可定位 frame 的元素，并排除 CmdPal/TextInputHost/PowerToys 等 shell 表面。

### 1.1 安全承诺矩阵

| 承诺 | Windows | macOS | Linux | 验证载体 |
|---|---|---|---|---|
| 凭据硬保护（密码框拒自动输入） | ✅ 结构位（UIA sidecar `IsPassword` ∨ `ES_PASSWORD`）+ 启发式降级 | ✅ AX 结构化角色（0.1–0.2 时期） | 未验证 | `posture.smoke` G/H 系列 + A6 探针 |
| 极危注记（不阻断） | ✅ | ✅ | ✅ 离线 | `posture.smoke` |
| `allowedApps` 白名单 | ✅ | ✅ 离线 | ✅ 离线 | `posture.smoke` / `config.plumbing` |
| 快照 TTL / 无快照拒绝 | ✅ | ✅ 离线 | ✅ 离线 | `posture.smoke` / `action-bounds` |
| 三级投递链 + 恢复原前台 | ✅ 真机 | 仅离线 | 仅离线 | `delivery-chain.smoke`（真实 `cuaDeliver`） |
| 强杀锁存（stop/resume） | ✅ 离线 | ✅ 离线 | ✅ 离线 | `tools.smoke` / `dispatcher.test` |
| `unknown ≠ 成功` | ✅ | ✅ 离线 | ✅ 离线 | `tools.smoke` / `schema.conformance` |
| 结构密码扫描 | ✅ 真机 9/9 | 不适用 | 不适用 | A6 探针 + `posture.smoke` |
| WinUI3 输入通道 | ✅ 已定性（hotkey 无 AcceleratorKey/4s 超时，改点控件；可实验性自动回退） | 不适用 | 不适用 | 受控窗口实验 + #3908 |
| 观察坐标一致性 | ✅ 文本 `@(x,y)` == 结构化 `elements` == 点击空间 | — | — | `observe.coords` + `verify-runtime` #8/#17 |
| 菜单未确认 | ✅ `effect:unverifiable` 不再报成功 | — | — | `menu.receipt` |
| 像素点击落点 | ⚠️ best-effort（A7） | 未标定 | 未标定 | 六轮实验，见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §13 |

### 1.2 提示缓存 A/B

2026-11-09，opencode / deepseek-v4.1-flash，重复请求同一前缀：

| 工具面 | 结果 |
|---|---|
| `dispatcher` 稳定 tools | 重复 **99.5%**；首次 tool_call 后 **92.1%**；第二次后 **85.4%** |
| 旧 `dynamic` / lazy search 工具层变化 | 首击 **0%–18%**（+1 工具 0%，+4 工具 17.7%） |

结论：**tools 列表必须稳定**。这是 `dispatcher` 成为默认、`dynamic` 被删除的直接依据。测试脚本在仓库外，key 只从本地配置读取、未打印；原始记录见 [EVIDENCE](docs/EVIDENCE.md) §8。

### 1.3 模型可发现性

在不执行真实桌面动作的前提下，验证模型能否正确生成 dispatcher 调用：

- `computer_click` / `computer_type`（带观察上下文）、`computer_key`、`computer_verify`（带 `expect` 示例）、`computer_clipboard`、`computer_task`、`catalog`：均能生成 `computer_do({action:'call',...})`。
- 无上下文时倾向先 `screen_observe`；`scroll` 与“无示例的 verify”需要多一轮或更大 `max_tokens`。
- 结论：复杂参数建议先 `catalog`，必要时在 system prompt 给一个示例。

## 2. 未验证 / 未完成

| 项 | 状态 | 原因/影响 | 下一步 |
|---|---|---|---|
| npm 发布 | **已发布** | `dsh-win-computer-use@0.5.8`（2026-11-20）；临时 `0.0.0-stage` 已 deprecate | 无（后续版本需重新授权） |
| web profile 部署 | 已安装 0.5.8 | `dsh-win-computer-use@0.5.8` 已安装并写入 bundles；安装物不包含当前 main 的 B0-B3/nativeMenus，运行中的 web 进程仍可能加载旧版，需重启 | 重启 web harness 后验证 0.5.8；验证 HEAD 需重新部署或发布 0.5.9 |
| macOS 近期回归 | 未做 | 近期测试都在 Windows；macOS 证据多为 0.1–0.2 时期 | 有 macOS 环境时跑离线 + verify-runtime |
| Linux | 未验证 | 桌面/accessibility 栈差异大 | 不在当前承诺范围 |
| cua-driver 0.53 | 预期 | 只按发布说明预留 `screenshot_frame`；未真机 | 有 0.53 时跑 `probe-driver-shape` + 全量探针 |
| 像素点击 A7 | best-effort | 驱动 0.23.2 混合 DPI 落点缺陷；插件层不可判定 | 等上游；element 路径优先 |
| WinUI3 hotkey/menu | 部分可达 | 4s 超时 + 找不到 AcceleratorKey（#3908）；`invoke_menu` 可能不可用 | 默认给控件指引；`xamlKeyFallback: auto` 实验性；上游跟踪 |
| `app_launch` 清理 | 路径相关 | 0.52.13 实测 daemon High 但 PowerShell 子进程 Medium；alt+F4 可关闭，无残留。旧版本/其他路径仍可能 High | 按实际子进程 IL 决定清理；高完整性残留写 leftover，不按进程名杀 |
| 委派工具约束 | 宿主相关 | 0.2.2 `startActivation` 没有 `toolFilter` | 插件如实说明；严格限制用宿主 Agent Preset |
| A11 手势原语 | 未做 | 无 `selectText`/key hold/mouse down-up；drag 无元素源 | 评估；见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §13 |
| A17 私有拖拽 drop 真机 | 部分 | WinForms 探针 + Explorer Ctrl+drag 已回归；Excel `--excel` 分支已实现但 E2 未复制 → BLOCKED；PPT 无分支 | 下一轮真机项：Excel 边框拖拽命中点/手势 |
| A19 实验性后台输入 | ✅ 真机（提权轮 14/0） | B0/B1/B3 真机通过；B1 touch-only 收到 `WMTOUCH`；`syntheticPointer:promote` 的 mouse-only 普通窗口收到 `MOUSEDOWN/MOUSEUP`；严格 B2 默认非提权失败关闭，`--elevated` 125ms PASS；`cursor-clip` PASS；B1 光标用 helper `cursorDrift=0` 归因，外部漂移不再误判；B2/B3 会动光标/窗口 | 默认不自动提权；只对显式 `allowedApps` 启用 |
| A20 经典 HMENU 后端 | ✅ 真机 fixture 通过 | `nativeMenus:auto`（默认 off）离线 18 项通过；`probe-ops` 的 SetMenu fixture 自检 `GetMenu`/menu-count 后通过（commandId/marker）；MenuStrip/WPF/WinUI 明确不支持 | 用 regedit/MFC 交叉验证；MenuStrip 仍走 UIA |
| A21 原生 Button 触发 | ✅ 自建探针通过 | `nativeButtonTrigger:auto`（默认 off）离线 12 项通过；自建 WinForms Delete + MessageBox 1.2s 触发、opened=1、latch 生效 | t20 需显式开启 overlay 复跑；WPF/WinUI/ToolStrip 仍回退 driver |
| 模态 click/press_key 30s 超时 | 根因已定位；标准 Button 触发已有原生兜底 | t20 2/2 pass；触发模态的标准 WinForms Button 可用 `nativeButtonTrigger:auto` 1.2s 返回（自建探针 4/4），但默认 off；模态内标准 MessageBox 按钮由 `nativeDialogs:auto` 处理；WPF/WinUI/自定义 Button 仍走 driver，可能 30s。2026-11-20 探针：AX 树 1s/5s/15s 均 0；capture-only 1.5s；`timeout_ms` 调大证伪 | 上游 #5012（`#5046` 是 closed-unmerged PR）；t20 需显式开启 nativeButtonTrigger overlay 复跑 |

## 3. 复现方式

```bash
npm install
npm run check; echo "check=$?"
npm test; echo "test=$?"
node verify-runtime.mjs
node tests/live-action.e2e.mjs 3
node evals/verify-oracles.mjs
npm pack --dry-run --json

# dsh 0.2.2-rc.1 真机加载（headless 默认禁用 credentials；overlay 需启用）
dsh --profile headless --patch "<repo>/evals/headless-patch.yml" \
  --permission-mode read-only --approval-policy never \
  "调用 computer_do(action='status')，把返回原文贴出来"
```

判据：

- `npm test` 退出码 0，且最后每套都打印“全部通过”；总数 **772**。
- `npm run check` 退出码 0：语法 **49/49** + 文档/任务一致性（S1-S4 阶段、脚本、AC2）。
- `verify-runtime` 输出 `结果：18/18 通过`。
- `live-action` 输出 **23/23**（会打开临时记事本窗口；不杀进程，残留标签人工关闭）。
- `verify-oracles` S1 + x1 clean 组 **10/10**；S4 dirty 组的 SKIP 要单独看，不要写成 PASS。
- 阶段成员：S1 9 / S2 4 / S3 10 / S4 8（成员 31，唯一 23）；`node tests/tasks.check.mjs` 必须通过。
- `npm pack --dry-run --json` 的文件数与 `tests/docs.facts.json` / `docs/store-evidence.md` 一致。
- headless 探针的 `status` 返回 `dispatcher` / 2 可见 / 21 隐藏。
- 若 `verify-oracles` 的 PowerShell 报 `Add-Type` 找不到 `C:\Windows\TEMP\*.cs`，先设 `TEMP`/`TMP` 到 `%LOCALAPPDATA%\Temp`。

## 4. 证据约定

- **当前 vs 历史**：本文件只放当前矩阵、未验证项与复现；逐轮步数/探针输出/一次性结论在 [docs/EVIDENCE.md](docs/EVIDENCE.md)。
- **真值/实验产物不进仓库**：`evals/report-last*.json`、`evals/headless-runs/`、`dsv4fv-exp/`、工作区 `_*.mjs` 探针均不入库；仓库只进可复现脚本与文档。
- **测量驱动**：被数据否决的方案要记录（SoM、双原点、坐标三假设、动态工具面）；不要凭直觉复活。
- **平台分列**：安全承诺按平台实测；`unverified` 不写成 `supported`。
- **失败也记录**：超时、环境态失败、驱动缺陷都写进 EVIDENCE；修复后保留根因与守门测试。
- **失败样本不是通过率承诺**：t14/t15 等任务仍高方差；单次 pass 不等于稳定。
