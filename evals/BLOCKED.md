# BLOCKED — 未覆盖 / 无法证明的能力

> 目的：把“环境缺东西”“能力通道不存在”“证据还没跑”分开。这里列出的项**不计入 pass**，也不写成“已支持”。
> 状态：2026-11-22。证据日期与命令内联；完整运行记录见 `docs/EVIDENCE.md`。

## 1. 归因口径

- **环境型（ENV）**：缺应用、缺 VM、磁盘/凭据/桌面不可用；setup 返回 `ENV`，不是插件失败。
- **能力型（A/B/UIPI）**：驱动/插件/OS/应用没有可证明的通道；换环境不会自动消失，需要新增原语、等上游或明确接受不支持。
- **证据型**：通道存在，但缺真实模型/真机样本；不能记 `pass`，也不能记成能力缺失。

## 2. 环境型

| 项 | 缺什么 | 影响 | 解除条件 |
|---|---|---|---|
| VS Code / VLC | 应用未安装（`probe-win-gaps` 2026-11-21：两者均 not installed） | Electron/WebView2 与媒体任务无法建立 | 安装后补 probe/任务；之前 setup 记 ENV |
| WSL 交互 | `wsl.exe` 存在，但没有发行版 | WSL 交互任务无法建立 | 安装发行版后再测 |
| disposable VM | 当前无 VirtualBox/VMware/QEMU/Windows Sandbox；Windows 11 家庭版 | UAC、安装器、per-machine 注册、SmartScreen/MOTW、Protected View 不能安全测 | 一次性 VM 快照 + 测试签名包 |
| 独立观察者 key | 没有已验证的视觉 key；`~/.dsh/.credentials.yaml` 存在但未读取 | `screen_assert` 的第二观察者无法建立 | 提供可用视觉 key / 修复观察者文本输出 |
| 浏览器 auth/upload mock | 没有本地 mock 登录/上传服务 | `b01` 只覆盖 tabs + 表单，upload/auth 无法建立 | 本地 mock 服务 + 测试页面 |
| Linux / macOS | 无 Linux 任务套件；macOS 近期未回归 | 不能把“能加载”当“已验收” | Linux 可选、非门禁；macOS 有环境再回归 |
| 磁盘 | C: 仅 1.6GB 空闲（2026-11-21 测量，随使用波动）；TEMP 在 C: | 安装应用/VM、`Add-Type`、大截图可能失败 | 释放 C: 或明确迁移安装/缓存；不自动清理用户文件 |

## 3. 能力型

### 3.1 A. 输入 / 手势

| 项 | 具体卡点 | 现有降级 | 状态 |
|---|---|---|---|
| Excel modifier drop | `probe-modifier-drop --excel --excel-only --engine both`（2026-11-22）：`CellDragAndDrop=true`；A2 选中已由 UIA `SelectionItemPattern` 证明；A2/B2 边框、中心、private/native、**不带 Ctrl** 均投递成功，但 A2 不动、E2 为空 → 拖拽未启动，不是 Ctrl 丢失。COM 边框/Selection 在部分 Excel 实例不可用 | Explorer Ctrl+drag 已通过；Excel 无降级 | ⛔ BLOCKED |
| PPT modifier drop | 没有 PPT 分支；Excel 未解前不复制实现 | 无 | ⛔ 未覆盖 |
| `selectText` / key hold / mouse down/up / drag-from-element | 工具面没有这些原语；`computer_set_value` 只是 UIA ValuePattern，不能选文本范围；drag 只有坐标起终点 | 复杂文本选择/形状拖拽退回坐标 | ⛔ 能力缺口 |
| 元素边缘锚点 | 快照条目只存元素中心 `x/y`，不暴露 rect；`localRectOf` 只用于标题栏 | 只能按中心点推断边框 | ⛔ 能力缺口 |
| `win`/`super` 组合键 | 旧实现把 `win+r` 降级成单键 `win`，不可靠；现在 fail-closed | 用 `app_launch`/开始菜单 | 🔒 设计边界 |
| 后台输入范围 | B0/B1/B2/B3 默认 off；B1 只左单击，拖拽/滚轮/IME/右键/双击不在功能内（B0 双击/右键除外）；B2/B3 会动光标/窗口 | 前台 SendInput / 坐标拖拽 | 🟡 部分能力 |

### 3.2 B. 观察 / 原生 UI

| 项 | 具体卡点 | 现有降级 | 状态 |
|---|---|---|---|
| MessageBox 模态期间的 UIA/动作 | 模态打开后同 pid 主窗口 AX 树 1s/5s/15s 均 0 元素；`bring_to_front`/`press_key`/坐标 click 阻塞。根因上游 #5012 | `nativeDialogs` 对标准 `#32770` + `BM_CLICK`；`nativeButtonTrigger` 对标准 WinForms Button；`probe-native-dialog` 9/9 | 🟡 部分解 |
| WPF / WinUI / 自定义模态 | 原生后端只认标准 `#32770` + 标准 Button；WPF 模态 class=`HwndWrapper[...]`，`probe-wpf-dialog` 显示 UIA 5 元素可读、native scan=null（不需要 native 兜底）；WinUI ContentDialog/Picker 与自定义控件未验证 | WPF 可走 UIA；WinUI/自定义无稳定通道 | 🟡 WPF 部分解；WinUI/自定义仍 BLOCKED |
| WinUI 文件 Picker | 评测清理脚本已观察到同 pid 文件对话框可能 `GW_OWNER=0`；`native-dialog.ps1` 的 modal 证明要求 owner 非 0 | 若 UIA 同时阻塞，无 native 兜底 | ⛔ 能力/证据缺口 |
| Chromium file chooser / print preview | `b01` 只覆盖 tabs + 表单；`probe-chromium-dialogs`（2026-11-22）：Chrome 页面加载 PASS，但页面 AX 不暴露 `<input type=file>`；合成 click/Space/Enter 未弹出选择器，Ctrl+P 无可识别 print 窗口 → 2 BLOCKED | 无；需要 CDP/manual 对照或页面级 fixture | ⛔ 未覆盖 |
| Electron / WebView2 | 内容区可能不暴露 UIA 树；后台事件可能静默丢弃（`background_unavailable`） | native 截图 + element/像素点击 | ⛔ 应用相关风险 |
| Windows Settings（WinUI3） | WinUI3 hotkey/menu 有已知不可达 #3908；有 exe 但无稳定导航/控件路径 | 无任务 | ⛔ 能力缺口 |
| IME composition | 语言包有 `zh-Hans-CN`/`en-US`，但没有确定性 composition fixture；候选窗/组合过程/提交文本未验证 | 无 | ⛔ 能力 + 夹具缺口 |
| 可访问性高对比度/Narrator | `a11y01` 只覆盖键盘-only + UIA 名称；没有对比度/播报 oracle | 无 | ⛔ 验证能力缺口 |
| capture-only 观察模式 | `screen_observe` 没有 `mode=capture`；模态期间 driver capture-only 可用，但插件只把它用于 pointer capture/zoom | `screen_observe` 仍走 UIA；模态期间可能 0 元素 | ⛔ 产品能力缺口（本轮只测量） |

### 3.3 UIPI / 跨完整性级别

| 项 | 具体卡点 | 现有证据 | 状态 |
|---|---|---|---|
| Medium → High 后台输入 | 低 IL 的 `PostMessage`/`SendInput`/UIA 可能被 UIPI 过滤；driver 可能返回 `background_uipi_blocked` | `probe-cross-il --uac`（2026-11-22，一次授权 UAC）：elevated sink RID 12288；helper 返回 `uipi`、`delivered:false`、events=0；该次运行暴露并修正 `IntegrityRank` off-by-one | ⛔ 修正后 UAC 复跑待做 |
| UAC 安全桌面 | 安全桌面是隔离桌面，普通 Default 桌面进程不能可靠送输入；当前 helper 只做 `OpenInputDesktop` 检测并拒绝 | `probe-b2-elevated` 只证明提权后 `BlockInput`；不触碰 UAC 安全桌面 | 🔒 设计边界 |
| 跨 IL 目标关闭/清理 | 非提权客户端可能关不掉 High IL 窗口；不能按进程名杀 | 精确 HWND/PID + 自关闭 timer；`probe-launch` 只测 Medium 子进程 | 🔒 安全边界 |
| driver daemon 提权依赖 | daemon 是否 High 取决于启动方式；0.52.13 主 CLI 清单为 `asInvoker`（2026-11-22 PE 复核定论，见 [EVIDENCE §3](../docs/EVIDENCE.md)），非提权 daemon 不能驱动 High 目标 | `probe-launch` 测到 daemon High/child Medium；`probe-b2-elevated` 只测 BlockInput | 🔒 设计边界 |

IntegrityRank 修正明细：阈值曾把 medium(8192) 标成 high、system(16384) 与 high 同为 rank 3；已修正为 `0=low / 1=medium / 2=high / 3=system`，离线分类器测试通过。证据与修正叙事统一见 [EVIDENCE §4](../docs/EVIDENCE.md)；**修正后的 Medium→High 复跑是本节唯一未闭合项**。

## 4. 证据型 / 测量边界

- **state 文件被信任**：`state.json`/`seedHash` 由 setup 写入；oracle 不证明模型没改过它；mutation 只测模型可达产物。
- **`app_launch` 子进程 IL**：0.52.13 实测 daemon High、`powershell.exe` 子进程 Medium；不同驱动/启动路径仍可能不同；按实际 IL 判断，不写“一律 High”。
- **p01-p03**：opencode image 路由 3/3 pass；text-only 路由未验证，失败按模型能力失败，不记 ENV。
- **t13**：真实网络下载保留 `ac2:none`；SKIP 不是 PASS；t18 本地 HTTP 下载补 AC2。
- **AC6**：n<8 时 p90 不稳定；`totalTokens` 含 cacheRead，成本对比需看 `billable`。
- **`app_launch` 残留**：保留“驱动侧关闭失败 → LEFT_OVER + 精确 HWND/PID”策略；不按进程名杀。
- **B1/B2 细节**：B1 promote 只对 message 窗口；B1 只左单击；B2/B3 会动光标/窗口，失败关闭；外部漂移单独记录。
- **`win`/`super`**：fail-closed 是产品选择，不是待修 bug。

## 5. 已解 / 不再列为 BLOCKED

- **多显示器**：`dpi01` 真实模型跨屏点击 **pass**（2026-11-22；3 步、clicks=1、0 dirty）。
- **标准常见对话框**：`probe-common-dialogs` 对 WinForms Open/Save/Font/Color/Print 标准 `#32770` **6/6 PASS**；WPF/WinUI/自定义仍按 §3.2 处理。
- **Explorer modifier drop**：`probe-modifier-drop` 已通过（文件系统结果 + Ctrl 释放）。
- **Terminal / 本地浏览器 tabs+form**：`term01`、`b01` 已落地；upload/auth/print 仍按 §3.2。
- **MessageBox 标准路径**：`probe-native-dialog` 9/9；非标准模态仍按 §3.2。

## 6. 规则

1. 新任务/探针遇到上述阻塞时，记录 `BLOCKED` 或 `ENV`，不要写 `PASS`。
2. 解除阻塞后，先从本文删除对应行，再把结果写进 `VERIFICATION.md` 与 `docs/EVIDENCE.md`。
3. 不要用“手工跑过一次”替代可复现命令；命令必须留在 `docs/TESTING.md` 或 `evals/README.md`。
