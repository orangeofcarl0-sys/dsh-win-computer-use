# BLOCKED — 未覆盖 / 无法证明的能力

> 目的：把“测不了”和“测了但失败”分开。这里列出的项**不计入 pass**，也不写成“已支持”。
> 状态：2026-11-21。证据日期与命令内联；完整运行记录见 `docs/EVIDENCE.md`。

## 1. 真实运行时阻塞

| 项 | 证据 | 影响 | 解除条件 |
|---|---|---|---|
| WinForms MessageBox 模态期间的 UIA/动作 | `evals/probe-modal-timeout.mjs` / `probe-modal-escapes.mjs`（2026-11-20）：AX 树在 1s/5s/15s 预算下均为 0 元素；同 pid 主窗口也为 0；capture-only 1.5s 成功；`bring_to_front`/`press_key`/坐标 click 均阻塞。私有实现 `nativeDialogs:auto` 已对同 pid 标准 `#32770` 模态对话框提供 Win32 子控件扫描 + `BM_CLICK`（`evals/probe-native-dialog.mjs` 9/9 PASS）；`nativeButtonTrigger:auto` 对标准 WinForms Button 自建探针 4/4（1.2s 触发，默认 off）。WPF/WinUI/自定义 Button 未覆盖 | 默认配置下触发模态的 UIA click 仍可能 30s；`get_window_state` 调大 `timeout_ms` 不是修复 | 上游 #5012（`#5046` 是 closed-unmerged PR）；需要时显式开启 `nativeButtonTrigger` 并用 t20 overlay 复跑 |
| Excel modifier drop | `probe-modifier-drop.mjs --excel --excel-only`（2026-11-21）：已实现 Excel/COM 检测、临时 xlsx、UIA `DataItem` 几何（`"A" 2`/`"E" 2`）、Ctrl+drag、Ctrl+S、OOXML 校验、精确 HWND 关闭；拖拽已投递（private SendInput/foreground），A2 保留但 E2 仍为空 → BLOCKED。2026-11-22 复跑：Excel `CellDragAndDrop=true`、`EnableFillHandle=false`；UIA A2/B2 x=94/198；从 x=144–148、单元格中心、以及**不带 Ctrl** 均投递成功，但 A2 不动、E2 为空 → 拖拽未启动，不是 Ctrl 丢失。PPT 无分支 | Explorer Ctrl+drop 已回归；Excel/PPT 的 modifier drop 仍无自动 PASS | 在专用桌面确认 Excel 对合成拖拽的接受条件（真实指针/OLE drag loop/光标形状反馈）；否则保持 BLOCKED |
| 独立观察者 / `screen_assert` | 无任务；需要 ZHIPU key 或 dsv4fv 文本输出修复 | 自绘/canvas 的“独立裁决”仍靠 oracle 文件，不是第二观察者 | 提供可用视觉 key 或修复文本输出 |
| `selectText` / key hold / mouse down-up / drag-from-element | 工具面不存在这些原语 | 复杂文本选择/形状拖拽仍靠坐标 | 驱动/插件新增原语后再测 |
| 虚拟桌面 / Task View | 无任务；插件工具面没有虚拟桌面枚举/切换原语，`win`/`super` 组合键按 §2 fail-closed，驱动也没有对应能力 | 无法在受支持通道内创建、切换并**按 ID 精确回收**虚拟桌面；强行投递未支持按键会留下无法可靠清理的用户会话状态 | 驱动新增虚拟桌面原语（枚举/切换/按 ID 关闭）后再补 probe/任务；否则保持 BLOCKED |
| UAC / 安装器 / Protected View | 没有任务；`probe-b2-elevated` 只证明提权后 BlockInput，不是 UAC 自动化 | 安装器、per-machine 注册、SmartScreen/MOTW、Office Protected View 未验证 | 一次性 VM 快照 + 测试签名包；无 VM 保持 BLOCKED，不在宿主执行 |
| IME / Electron / Terminal / Settings / 媒体 | `probe-win-gaps`（2026-11-21）：VS Code/VLC 未安装；Settings exe 存在；WSL/wt 存在；语言 zh-Hans-CN/en-US。P1 已补 `term01` 与 `b01` | Electron/WebView2、WSL 交互、系统设置 UI、VLC、IME composition 未验证 | 有环境时补 probe/任务；缺失应用 setup 记 ENV，不伪造 PASS |
| 可访问性高对比度/Narrator | `a11y01` 只覆盖键盘-only + UIA 名称；未做高对比度/Narrator 全量验收 | 不能宣称 a11y 全兼容 | 需要专用 a11y fixture/工具后再补 |
| 浏览器 upload/auth/print-to-PDF | `b01` 只覆盖 tabs + 本地表单；`combo02`/`rec03` 覆盖下载 | 上传/登录/打印对话框未验证 | 本地 mock upload/auth + 打印对话框 fixture 后再补 |
| macOS 近期回归 / Linux | 近期测试都在 Windows；Linux 未验证。`probe-platform.mjs`（2026-11-21）：本机 win32 + PowerShell 5.1 + 41 条任务 → PASS；非 Windows 只报 BLOCKED，不冒充运行 | 不能把“能加载”当“已验收”；Linux 无任务套件 | Linux 仅可选举措（离线 `npm run check`/`npm test`，非发布门禁）；有环境时再补 `verify-runtime`，不写“已支持” |

## 2. 已知边界（不是阻塞，但不计入 pass）

- **state 文件被信任**：`state.json`/`seedHash` 由 setup 写入；oracle 不证明模型没有改过它。mutation 只针对模型可达的产物，不测 state 篡改。
- **`app_launch` 子进程 IL**：2026-11-20 实测 daemon High、`powershell.exe` 子进程 Medium；alt+F4 可关闭，无残留。不同驱动/启动路径仍可能是 High；按实际 IL 判断，不把它写成“一律 High”。
- **p01-p03**：opencode image 路由 3/3 pass；text-only 路由未验证，失败时按模型能力失败处理，不记 ENV。
- **t13**：真实网络下载保留 `ac2:none`；SKIP 不是 PASS。t18 的本地 HTTP 下载补 AC2 覆盖。
- **ENV**：应用缺失、TabState 无法备份、网络不可达、模型凭据 401/402 一律记 ENV，不混入通过率。
- **AC6**：n<8 时 p90 不稳定；`totalTokens` 含 cacheRead，成本对比需同时看 `billable`。
- **`app_launch` 残留**：即使本次 alt+F4 成功，仍保留“驱动侧关闭失败→LEFT_OVER + 精确 HWND/PID”策略；不按进程名杀。
- **实验性后台输入**：B0/B1/B1-promote 只证明消息/触控/鼠标提升已投递；目标可能忽略；B2/B3 会动光标/窗口；三键默认 off。B1 auto 只对 pointer/touch；B1 promote 只对 message 窗口；两者只左单击；拖拽/滚轮/IME/右键/双击不在本功能内（B0 双击/右键除外）。
- **严格 B2 的提权边界**：默认非提权会话 `BlockInput` 失败关闭（`win32=0`、非提权/无 UIAccess、Default 桌面）；`node evals/probe-background-input.mjs --elevated`（UAC）**14 PASS / 0 BLOCKED**，严格 B2 125ms PASS（`inputBlocked=true`、`cursorRestored=true`、`inputUnblocked=true`）。生产不自动提权；免提权用 `cursor-clip`（不阻塞键盘）。
- **B1 光标归因**：helper 在注入窗口内采样 `cursorBefore/cursorAfter/cursorDrift`；外部物理漂移单独记录，不再把 B1 误判为 BLOCKED。
- **B1 普通应用语义**：promote 的 `MOUSEDOWN/MOUSEUP` 已到达 mouse-only 窗口，但应用是否按业务处理仍取决于目标；不外推为“普通应用全部支持”。
- **原生对话框覆盖范围**：`probe-common-dialogs`（2026-11-22）对 WinForms Open/Save/Font/Color/Print 的标准 `#32770` 后端 **6/6 PASS**（`modal=owner-disabled`、Cancel `BM_CLICK`、fixture result=Cancel）；`probe-native-dialog` 对 MessageBox 的 `screen_observe` 集成 9/9。WPF/WinUI/自定义 shell 对话框未验证，不外推。
- **`win`/`super`/`meta` 组合键**：本机旧实现会把 `win+r` 降级成单键 `win`（打开 Start/SearchHost），不可靠。2026-11-20 起 fail-closed，回执明确“不支持，用 app_launch/开始菜单”；不做原生 win 发送的承诺。

## 3. 规则

1. 新任务/探针遇到上述阻塞时，记录 `BLOCKED` 或 `ENV`，不要写 `PASS`。
2. 解除阻塞后，先在本文删除对应行，再把结果写进 `VERIFICATION.md` 与 `docs/EVIDENCE.md`。
3. 不要用“手工跑过一次”替代可复现命令；命令必须留在 `docs/TESTING.md` 或 `evals/README.md`。
