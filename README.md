# dsh-win-computer-use

> **Windows-first Computer Use for DeepSeek Harness。**
> 深度 Win32 / WinUI / UIA 工程 · 零审批三级投递 · 22 个工具，默认 2 个稳定入口。

[![Release](https://img.shields.io/badge/release-0.5.6-blue)]()
[![main](https://img.shields.io/badge/main-0.5.7--dev-orange)]()
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.2--rc.1-green)]()
[![Windows](https://img.shields.io/badge/Windows-deep--tested-0078D4)]()
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.18.0-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **版本状态（2026-11-14）**：最新发布 tag 是 `v0.5.6`（旧名 `dsh-computer-use` 的最后一个发布）；`main` 为 `0.5.7-dev`，含更名、dispatcher 默认、P0/P1 安全边界与 dsh 0.2.2 兼容升级（0.2.2-rc.1 为新基线）。npm 尚未发布，部署侧可能仍是旧版——见 [PUBLISH.md](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md)。
>
> 2026-11-10 起包名/仓库名从 `dsh-computer-use` 改为 `dsh-win-computer-use`；旧 GitHub URL 自动 redirect。

![verified desktop demo](assets/demo-verified.png)

## 这是什么

给 [DeepSeek Harness](https://github.com/988hj7tczd-oss/harness-desktop) 加一层**可观察、可验证、Windows 深度实测**的桌面操作能力。底层通过 [cua-driver](https://github.com/trycua/cua) 驱动本地桌面；插件本身不内置截图循环，也不替模型做决策——它把“看、点、输、验”拆成细粒度工具，由模型组合。点击走虚拟光标（可见滑行，不移动真实指针；`computer_hover(real=true)` 是例外）；后台投递不抢焦点，需要前台时短暂交换并恢复。

默认只暴露 **2 个稳定入口**（`computer_do` + `screen_observe`），其余 **20 个工具**经 dispatcher 路由；切到 `hybrid` 可再直接暴露 5 个高频动作。工具列表在会话内保持不变，以保护 prompt cache。

它不是“跨平台 CUA 的薄封装”。Windows 上真正难的不是“能不能点”，而是下面这些墙——本仓库逐项踩过并写进了实现：

| Windows 硬问题 | 本仓库的处理 |
|---|---|
| 前台锁（ForegroundLockTimeout）让 `SendInput` 打空 | 后台 → 前台 → `bring_to_front`（AttachThreadInput）三级投递，结束后恢复原前台 |
| XAML / WinUI 不吃 `PostMessage`，组合键走 UIA 加速器还会超时 | 文本走 UIA `ValuePattern`；组合键走 `hotkey` 通道并翻译 UIA 超时；保存类操作改走“点控件” |
| 元素坐标是屏幕物理像素，点击坐标却是窗口截图空间 | `screen_observe` 输出统一换算到窗口截图空间；`element_token` 路径与像素路径分离 |
| 驱动是高完整性进程，`app_launch` 的子进程非提权侧关不掉 | 文档与工具描述明确代价；测试清理按标题匹配，绝不按进程名杀 |
| 经典 Win32 密码框的 `ES_PASSWORD` 在 UIA 映射里是 `IsPassword=false` | Windows UIA sidecar 读结构位，结构位优先；启发式只作降级 |
| 每步重观察把上下文撑爆 | 重复观察降噪（同窗口未变回极简回执）+ 紧凑动作回执 + 可选委派 |

## 设计立场：无感自治

方向不是“极致安全”，而是**在可观察、可回滚的底座上减少打断**：

| 原则 | 行为 |
|---|---|
| **易用无感** | 动作零审批、零打断；归因靠全量投递注记 + harness 会话日志 |
| **自动升级** | 后台投递不可用自动升级前台/绕前台锁并恢复原前台；窗口观测失败自动降级桌面级采集（仅视觉，不可直接动作） |
| **极危提示** | `extremePatterns` 命中元素标签 → 结果附警告注记，**不阻断**；默认空 = 零差异 |
| **基本兜底** | 凭据硬保护（密码框拒绝自动输入）、快照 TTL、无快照拒绝、`allowedApps` 白名单（默认关）、`computer_stop` 锁存 |

两点必须说清楚：

1. **“零审批”不是绕过 OS 权限。** 插件不弹审批、不询问确认，但 Windows UIPI、管理员窗口、macOS TCC 仍由操作系统决定；`cua-driver` 自身可能要求管理员权限。
2. **“自动提权”指投递/观测的自动升级，不是提权到管理员。** 具体是后台→前台→绕前台锁，以及窗口级观测失败→桌面级采集。

## 快速开始

### 1. 安装 cua-driver

按 [trycua/cua](https://github.com/trycua/cua) 的说明安装驱动。插件按以下顺序定位：

1. 环境变量 `CUA_DRIVER_BIN`；
2. `PATH` 中的 `cua-driver` / `cua-driver.exe`；
3. 常见安装路径（`~/.local/bin`、`/usr/local/bin`、`/opt/homebrew/bin`、`%LOCALAPPDATA%\cua-driver`、`~/.cua-driver/packages/current`）。

找不到时所有工具返回结构化错误与自救指引，不静默失败。

### 2. 安装插件

```bash
git clone https://github.com/orangeofcarl0-sys/dsh-win-computer-use.git
cd dsh-win-computer-use
./install.sh --dry-run   # 预演：只打印将要写入的路径
./install.sh             # 链接插件 + 写入 home 级 patch
```

Windows / Linux 先设置 `DSH_HOME`（macOS 的默认路径是 `~/Library/Application Support/harness-desktop/dsh-home`）：

```bash
export DSH_HOME=/path/to/dsh-home
```

装完重启宿主。手动安装与 STORE 证据见 [docs/store-evidence.md](docs/store-evidence.md)。

### 3. 第一次观察

```text
1) screen_observe(window="Notepad")
2) computer_do({action:"catalog"})        # 看隐藏工具签名
3) computer_do({action:"call", tool:"computer_click", args:{element: 12}})
4) screen_observe(window="Notepad")       # 复核
```

`screen_observe` 返回编号元素、坐标、快照 id 与坐标空间说明。动作前没有新鲜快照会被拒绝——这是 `[snapshot_missing]`，不是工具故障。

## 心智模型

```text
screen_observe ──► 快照（默认 60s）──► 动作（element 或窗口截图像素）
       ▲                                      │
       │                                      ▼
       └──────── screen_observe / computer_verify（复核）
```

三种“看”的方式：

| 模式 | 原理 | 成本 | 适用 |
|---|---|---|---|
| `ax`（默认） | AX/UIA 树 → 编号 + 坐标 | 零视觉 token | 原生应用、可访问性树完整 |
| `native` | 窗口截图像素图经 attachments 落盘，主模型直接看图 | 图片 token | Canvas/游戏/Electron、树为空、要读文字 |
| `vision` | `ctx.llm` 视觉观察者结构化描述（可回退 GLM） | 一次视觉调用 | 主模型不支持图片输入时 |

自动降级：AX 树为空或驱动标记降级时，若当前模型声明 image 能力 → `native`；否则若配置了 GLM key → `vision`；再否则留在 `ax` 并标注 `visualOnly`。窗口级观测被权限/引擎拒绝时，降级为桌面级采集（`mode=desktop-visual`，坐标是桌面像素，**不能直接用于窗口动作**）。

## 工具面：默认 2 个入口

22 个工具的 schema 常驻会持续占用模型注意力，也会让工具层变化打断 prompt cache。默认只注册 2 个稳定入口：

| 模式 | 直接可见 | 隐藏 | 路由方式 |
|---|---|---|---|
| `dispatcher`（默认） | `computer_do` + `screen_observe` | 20 | `computer_do({action:'call', tool, args})` |
| `hybrid` | 2 + `computer_click` / `computer_type` / `computer_key` / `computer_scroll` / `computer_verify` | 15 | 热工具直接调用；长尾经 dispatcher |

`computer_do` 的三种动作：

- `action:"catalog"`：列出隐藏工具的紧凑签名（`name(required,optional?)`），最多 20 条；`query` 可按名称/描述过滤。
- `action:"call"`：路由到隐藏工具；隐藏工具**不注册、不能直接调用**，但仍走自己的锁存/守卫/参数校验/快照/回执。
- `action:"status"`：查看当前模式与可见/隐藏清单。

> PTC / `run_code` 模式下，SDK 只绑定**直接可见**的工具；隐藏工具不会出现在 SDK 里，仍需 `tools.computer_do({action:'call', tool, args})` 路由（例如 `tools.computer_task` 为 undefined 是预期行为）。

```yaml
- id: dsh-win-computer-use
  config:
    surfaceMode: dispatcher   # dispatcher（默认）| hybrid
```

**为什么不用动态 enter/exit：** 旧的 `dynamic` 模式会在会话中途注册/注销工具。实测（2026-11-09，opencode / deepseek-v4.1-flash）tools 数组一变，缓存首击只剩 **0%–18%**；稳定 dispatcher 的重复请求命中 **99.5%**，首次 tool_call 后 **92.1%**，第二次后 **85.4%**。因此 `dynamic` 已彻底删除，只保留两种稳定工具面。

**取舍**：`hybrid` 让高频动作少一层 JSON 包装，但可见面从 2 变 7；`dispatcher` 的 catalog 调用本身也占一步。复杂参数（如 `computer_verify` 的 `expect` JSON）建议先 `catalog` 看签名，必要时在 system prompt 里给一个示例。

## 工具参考

共 22 个：21 个桌面能力 + 1 个 dispatcher。默认 `dispatcher` 下，除 `screen_observe` / `computer_do` 外都经 `computer_do` 调用；标 **H** 的工具在 `hybrid` 下可直接调用。

### 观察

| 工具 | 作用 | 必填 | 常用可选 |
|---|---|---|---|
| `screen_observe` | 观察窗口：编号树 / 截图直读 / 视觉描述；未变时回极简回执 | — | `window`、`window_id`、`mode`、`query`、`maxElements`、`force` |
| `screen_zoom` | 区域放大 / 树空目标的定位原语（≤500px JPEG） | `window_id` | `pid`、`x1`、`y1`、`x2`、`y2` |

### 动作

| 工具 | 作用 | 必填 | 常用可选 |
|---|---|---|---|
| `computer_click` **H** | 点击元素编号或窗口截图坐标 | `element` 或 `x,y` | `snapshot_id`、`foreground`、`count` |
| `computer_double_click` | 双击 | `element` 或 `x,y` | `snapshot_id`、`foreground` |
| `computer_right_click` | 右键 | `element` 或 `x,y` | `snapshot_id`、`foreground` |
| `computer_type` **H** | 输入文本；指定 element 时走 UIA `ValuePattern`，否则输入到快照窗口当前焦点 | `text` | `element`、`snapshot_id`、`foreground` |
| `computer_set_value` | 直接设值（UIA `ValuePattern`；文本框/滑块/下拉优先） | `element`、`value` | `snapshot_id` |
| `computer_key` **H** | 按键/快捷键（组合键走 `hotkey`；绑定快照窗口） | `key` | `snapshot_id`、`foreground` |
| `computer_scroll` **H** | 滚动 | — | `direction`、`amount`、`element`、`snapshot_id`、`foreground` |
| `computer_drag` | 窗口截图坐标拖拽 | `from_x`、`from_y`、`to_x`、`to_y` | `duration_ms`、`snapshot_id`、`foreground` |
| `computer_wait` | 本地等待（不调引擎） | `ms` | — |
| `app_list` | 列出运行中应用（显示上限 20 条） | — | — |
| `app_launch` | 后台启动应用，可选前置 | `name` 或 `bundle_id` | `bring_to_front`、`creates_new_instance` |

### 运营

| 工具 | 作用 | 必填 | 常用可选 |
|---|---|---|---|
| `computer_verify` **H** | 1–8 条结构化谓词 AND 求值；`unknown` 永不算成功 | `window_id`、`expect` | `pid`、`include_screenshot` |
| `computer_wait_for` | 谓词轮询等待（默认 10s，上限 60s） | `window_id`、`expect` | `pid`、`timeoutMs`、`pollMs` |
| `computer_clipboard` | 剪贴板读写（write + ctrl+v = 粘贴流） | `action` | `text` |
| `computer_menu` | 菜单路径直调（fail-closed，不回退像素；`unverifiable` 报“未确认”） | `window_id`、`path`（JSON 字符串或数组） | `pid` |
| `computer_hover` | 悬停（实验性；`real=true` 才动真实指针） | `x`、`y` | `pid`、`window_id`、`real` |
| `computer_stop` | 结束驱动会话并锁存全部桌面操作 | — | — |
| `computer_resume` | 解锁 `stop` 并预热会话（唯一解锁路径） | — | — |

### 委派与入口

| 工具 | 作用 | 必填 | 常用可选 |
|---|---|---|---|
| `computer_task` | 把一段桌面操作交给一次性子 agent；主上下文只收一条紧凑回执 | `goal` | `success_criteria`、`constraints`、`timeout_min`（默认 5）、`model`、`model_effort` |
| `computer_do` | dispatcher 入口：`call` / `catalog` / `status` | `action` | `tool`、`args`、`query` |

## 核心机制

### 坐标：两个空间，一条规则

| 量 | 空间 | 怎么用 |
|---|---|---|
| `screen_observe` 的 `@(x,y)` | **window-screenshot-px**（窗口截图物理像素） | 可直接传给 `computer_click(x,y)` |
| `computer_click(x,y)` / `scroll` / `drag` | **window-screenshot-px** | 与观察输出同一空间 |
| `element` 编号 | 不涉及坐标 | 走 `element_token`，**首选、最可靠** |
| `screen_zoom` 图内坐标 | crop-local px | `图内坐标 × crop.scale + crop.x/y` = window-screenshot-px，**直接点击**，不要再加 `screenOrigin` |
| `screenOrigin` | 窗口在屏幕上的物理原点 | 只用于换算到屏幕绝对坐标；不是点击输入 |

规则：

1. **element 路径优先。** `element_token` 由驱动定位，支持后台/隐藏窗口，不受 DPI 混合影响。
2. **像素路径是 best-effort。** 驱动 0.23.2 的像素点击在混合 DPI 下有实测落点偏差（见 [docs/WINDOWS.md](docs/WINDOWS.md) 与 [ROADMAP.md](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/ROADMAP.md) A7）；像素点击后请用 `screen_observe` / `computer_verify` 复核。
3. **不要自己乘 2 或加窗口偏移。** 0.21+ 的截图与点击共用窗口截图空间；`screen_observe` 已在输出时完成换算。
4. **用于点击时，zoom 的换算终点是 window-screenshot-px。** `crop.scale` 以驱动返回图尺寸为准（驱动可能做非等比缩放；结果会提示比例不一致）。`screenOrigin` 只用于换算屏幕绝对坐标，点击时**不要**再加。
5. **文本行与结构化 `elements` 必须同一空间。** `screen_observe` 的 `@(x,y)` 与 `elements[].x/y` 都是换算后的窗口截图坐标；若两者不一致，属于 bug（2026-11-14 t01 的回归测试已覆盖）。

### 投递：后台 → 前台 → 绕锁

| `deliveryMode` | 行为 |
|---|---|
| `auto`（默认） | L1 后台；命中 `background_unavailable` → L2 前台；命中 `foreground_unavailable`（或指针类动作 `unverifiable` 且有 pid）→ L3 `bring_to_front` 绕锁 → 前台重试 → 恢复原前台 |
| `background` | 全程后台；不可用时返回结构化错误 + `foreground=true` 升级指引 |
| `foreground` | 始终前台（短暂焦点交换，驱动负责恢复） |

单次动作可用 `foreground: true` 覆盖。L3 的例外：`hotkey` 不做绕锁重试（XAML 先验拒绝会同样失败）；没有 `pid` 的目标不升级。`bring_to_front` 未返回 `previous_fg_hwnd` 时，回执会明确写“原前台未恢复”，不会假装成功。

### 输入通道

- **文本**：`computer_type` 指定 element 时走 UIA `ValuePattern`（XAML/WinUI 主机必需）；不指定 element 时输入到快照窗口当前焦点，回执附“密码保护无法预判焦点”的注记。
- **设值**：`computer_set_value` 只走 UIA `ValuePattern`；Web/自绘控件可能忽略，回执提示改用 `computer_type` 或点击后输入。
- **按键**：无修饰键走 `press_key`（PostMessage 后台）；组合键走 `hotkey`（XAML/WinUI 走 UIA 加速器，传统 Win32 走 SendInput 前台交换）。WinUI3 记事本实测两类失败：UIA 加速器 4s 超时，以及 `could not find a UIA AcceleratorKey`（命令在关闭的菜单里，上游 #3908）。回执会直接给“点菜单栏项 → 点菜单项”的可执行路径；`xamlKeyFallback: auto`（默认 `off`）可实验性自动完成这一步，但只做唯一标签的 token 点击，歧义/缺失即停，不自动处理另存为/覆盖对话框。
- **长文本/特殊字符**：`computer_clipboard(write)` + `computer_key("ctrl+v")` 是最可靠的粘贴流；剪贴板可能被其它进程占用，read 结果带隐私注记。

### 快照与安全护栏

- **TTL**：默认 60s；过期动作返回 `[snapshot_expired]`，请重新观察。
- **显式基线**：动作可带 `snapshot_id`；传入且不匹配时返回 `[snapshot_mismatch]`（当前由 `click` / `double_click` / `right_click` / `type` / `key` / `set_value` 校验；`scroll` / `drag` 已接受参数但尚未校验，见 [ARCHITECTURE §13](docs/ARCHITECTURE.md#13-已知缺口)）。
- **同快照连击**：`supersession: note`（默认）附一致性注记；`enforce` 第二次动作直接拒绝 `[snapshot_consumed]`；`off` 全关。
- **可疑状态**：`unverifiable` 或 `suspected_noop` 会 `markSuspect`；`suspected_noop` 终态 `ok:false`，并提示“先观察再决定是否重试”，不立即重放非幂等动作。
- **凭据硬保护**：`computer_type` / `computer_set_value` 命中密码框硬拒；`click` 等其它动作放行并附注记。Windows 结构位（`IsPassword` ∨ `ES_PASSWORD`）优先，启发式为降级；坐标模式无法预知目标控件，保护只在 element 模式生效。
- **白名单**：`allowedApps` 只约束操作类工具（点击/输入/按键/滚动/拖拽/设值），观察/列表/启动不受限；默认空 = 关闭。
- **锁存**：`computer_stop` 结束驱动会话、清快照、锁存全部桌面操作；`computer_resume` 是唯一解锁路径。dispatcher 本身在 stop 期间仍可进入，否则 `computer_resume` 无法经 dispatcher 解锁；隐藏工具自己的闸门仍会拒绝。

### 上下文经济

- **观察降噪**：同窗口、同模式、上次观察后无动作、界面哈希未变 → 回极简回执（`summary` 含编号摘要 / `brief` 单行 / `off` 关闭）；`force=true` 强制全量。哈希覆盖原始元素的 label/value/enabled/selected/actions/is_password/parent/depth/frame，并归一化时间/行列噪声。
- **紧凑回执**：正常路径只回一行“动作 · 投递 · 效果”；`verboseReceipts: true` 才附原始 JSON。
- **委派**：`computer_task` 把多步/高噪声操作放进一次性子 agent；主上下文只收 `ok/summary/evidence`。默认超时 5 分钟，每会话最多 3 次（`maxTaskCalls`），避免“子 agent 超时后父 agent 从头再做一遍”。

## 配置

```yaml
- id: dsh-win-computer-use
  config:
    ttlMs: 60000
    maxElements: 120
    observeDedup: summary
    surfaceMode: dispatcher
    verboseReceipts: false
    taskTimeoutMin: 5
    maxTaskCalls: 3
    supersession: note
    allowedApps: []
    cursorTheme: com.dsh.computeruse.rainbow
    nativeImage: auto
    visionProvider: deepseek-official
    visionModel: deepseek-flash
    passwordScan: auto
    extremePatterns: []
    deliveryMode: auto
    xamlKeyFallback: off
```

| 配置项 | 默认 | 说明 |
|---|---:|---|
| `ttlMs` | `60000` | 观察快照有效期（毫秒） |
| `maxElements` | `120` | 单次观察最多返回的编号元素数（实测常见任务 30–70 个） |
| `observeDedup` | `summary` | 重复观察降噪：`summary` / `brief` / `off`；`force=true` 强制全量 |
| `surfaceMode` | `dispatcher` | `dispatcher`（2 个常驻 + 20 隐藏）/ `hybrid`（2 + 5 热工具 + 15 隐藏） |
| `verboseReceipts` | `false` | `true` = 动作回执附原始 JSON（排障用） |
| `taskTimeoutMin` | `5` | `computer_task` 默认超时；调用方可用 `timeout_min` 覆盖（1–60） |
| `maxTaskCalls` | `3` | 每会话委派次数上限 |
| `supersession` | `note` | 同快照连击：`note` / `enforce` / `off` |
| `allowedApps` | `[]` | 操作类工具的应用白名单；空 = 不限制 |
| `cursorTheme` | `com.dsh.computeruse.rainbow` | 虚拟光标主题；空 = 引擎默认 |
| `nativeImage` | `auto` | `auto` 超附件限额自动降级 / `full` 原图 / `compact` 始终 ≤500px JPEG |
| `visionProvider` / `visionModel` | `deepseek-official` / `deepseek-flash` | `vision` 观察者路由；0.2.2 目录用 `deepseek-flash` |
| `passwordScan` | `auto` | Windows 结构性密码扫描；`off` = 零 spawn，退回启发式 |
| `extremePatterns` | `[]` | 极危清单（正则源数组）：命中附警告注记，不阻断 |
| `xamlKeyFallback` | `off` | 实验性：`off` 只给控件路径指引；`auto` 对 `ctrl+s/ctrl+shift+s/ctrl+a/c/v/x/z/f/n/o` 自动“点菜单栏项 → 点唯一菜单项”。默认关闭，歧义/缺失即停 |
| `deliveryMode` | `auto` | 后台/自动/前台投递策略 |

## 能力边界（诚实说明）

- **委派不是沙箱。** `computer_task` 想给子 agent 施加三条约束（只用桌面工具、结构化输出、禁止再派生），但它们是独立的宿主能力。0.2.2 的 `subagents.startActivation` **没有 `toolFilter`**——工具集只能由 Agent Preset/宿主组合决定。插件会在回执里明确写“子 agent 拥有与父会话同级的能力”，不会假装已限制。需要严格限制时，请用宿主自己的 Agent Preset/子 agent 机制。
- **`app_launch` 的窗口可能需要人工收尾。** 驱动二进制要求管理员权限，启动的应用继承高完整性级别；非提权客户端 `taskkill` / `Stop-Process` / `WM_CLOSE` 都会被 UIPI 拒绝。WinUI 目标上连驱动侧关闭通道也断（`alt+f4` 撞 UIA 超时、`invoke_menu` 报 `menu_path_unavailable`）。测试/自动化优先操作已在运行的普通应用。
- **管理员窗口仍是系统边界。** 驱动能操作它自己启动的高完整性窗口，但非提权客户端不能清理；具体按目标与通道判断，不是“管理员窗口一律不可操作”。
- **像素点击是 best-effort。** 混合 DPI 下驱动 0.23.2 的像素落点存在实测偏差；element 路径是可靠主路径。
- **`screen_zoom` 需要当前模型支持图片输入。** 它不做视觉观察者降级；小字号 JPEG 可能不可读，读文字请用 `native`（无损 PNG）。
- **`computer_hover` 是实验性能力。** 默认只移动虚拟覆盖层光标；能否触发目标应用的真实 hover 取决于应用，`real=true` 会移动真实指针。
- **`computer_menu` fail-closed。** 路径缺失/歧义/禁用/结构不匹配即失败，绝不回退像素。
- **平台**：Windows 是深度实测目标；macOS 保留基础可用路径（依赖驱动与 TCC 授权）；Linux 未做本仓库的真机验证。不要把 macOS/Linux 的“代码可加载”当成“已验收”。

## 平台支持

| 平台 | 状态 | 说明 |
|---|---|---|
| Windows | ✅ 深度实测 | 三级投递、XAML/WinUI 通道、1:1 观测、结构密码扫描均在本机闭环；管理员窗口受 UIPI 约束 |
| macOS | ⚠️ 基础可用（历史） | 需 Accessibility / Screen Recording 授权；本仓库的近期回归在 Windows，macOS 证据多为 0.1–0.2 时期 |
| Linux | ◻ 未验证 | 桌面环境与 accessibility 栈差异大；凭据保护等承诺未做真机验证 |

### 兼容性

| 依赖 | 实测版本 | 兼容范围 |
|---|---|---|
| dsh | `0.2.2-rc.1` | `>=0.2.2-rc.1 <0.3.0` |
| `@deepseek-ai/dsh-tools` | `0.2.2-rc.1` | `>=0.2.2-rc.1 <0.3.0`（peer） |
| `@deepseek-ai/schemastery` | `3.19.0` | `>=3.19.0 <4`（peer） |
| cua-driver | `0.23.2` | 以驱动 `call` 契约与工具名为准 |
| Node.js | 22.18+ | `>=22.18.0` |

## 故障排查

| 现象 | 常见原因 | 处理 |
|---|---|---|
| `cua-driver not found` / 无法启动 | 驱动不在 PATH | 安装驱动或设 `CUA_DRIVER_BIN` |
| 没有可见窗口 | 图形会话/窗口权限/目标最小化 | 确认目标在运行并重新观察 |
| `[snapshot_missing]` | 动作前没有 `screen_observe` | 先观察；菜单/悬停/应用列表不要求快照 |
| `[snapshot_expired]` | 超过 `ttlMs` | 重新观察 |
| `[snapshot_consumed]` | `supersession: enforce` 下同一快照第二次动作 | 重新观察，或改 `note` |
| `[snapshot_mismatch]` | 传入的 `snapshot_id` 不是当前快照 | 用最新观察的 id |
| `[index_out_of_range]` | 编号不属于当前快照 | 重新观察取新编号 |
| `element_not_visible` | 目标不可见/已变化；也可能是驱动误报 | 先 `screen_observe` / `computer_verify` 复核；WinUI 改走点控件 |
| `suspected_noop` | 引擎受理但怀疑未生效 | 不要立即重放；先观察再决定 |
| `background_unavailable` | 目标输入栈丢弃后台事件 | `deliveryMode: auto` 会自动前台；或单次 `foreground: true` |
| `foreground_unavailable` | Windows 前台锁拦截 | 自动升级 L3；仍失败时先让目标前置 |
| UIA accelerator 超时 | WinUI/XAML 组合键通道不可达（#3908） | 改点菜单/按钮；或稍后重试 |
| `native` 被拒 | 当前模型未声明 image 输入 | 换视觉模型或用 `mode:"vision"` |
| `screen_zoom` 返回空图/不可读 | 裁剪区域太小、JPEG 有损、窗口不可见 | 放大裁剪；读文字改 `native` |
| 指定窗口未找到 | 标题/pid 不匹配 | 工具会 fail-closed 并列候选；从候选重选，不会静默回退最前窗口 |
| 动作成功但界面没变 | 目标忽略该通道/焦点不对 | 用 `screen_observe`/`computer_verify` 复核；改用 element 点击或粘贴流 |
| `app_launch` 后关不掉 | 子进程继承高完整性级别（UIPI） | 提示用户手动关闭；不要按进程名杀 |
| 观察结果 `visualOnly` | 窗口级观测被拒，已降级桌面采集 | 桌面坐标不能直接用于窗口动作；重试窗口观察或换普通窗口 |

## 开发与验证

```bash
npm install
npm run check                      # 语法检查 + bash -n（17/17 JS）
npm test                           # 14 套离线测试，281 个断言
node verify-runtime.mjs            # 真驱动运行时验证（16 项；需 cua-driver）
dsh --profile headless --patch "<工作区>/_probe-win-cu-deepseek.yml" \
  --permission-mode read-only --approval-policy never \
  "调用 computer_do(action='status')"   # 真机 dsh 加载（headless 需先启用 credentials）
node tests/live-action.e2e.mjs 3   # 真桌面动作闭环（会打开临时记事本窗口）
npm run eval:headless              # S4 冒烟 headless 直跑（dsh 0.2.2 可用；10 分钟/条）
node evals/verify-oracles.mjs      # S4 oracle 双向验证（10/10）
```

`npm test` 的 14 套：posture / tools / delivery-chain / schema.conformance（22 个工具 / 44 个场景）/ observe.dedup / observe.coords / key.xaml / menu.receipt / eval-safety / task.tool / config.plumbing / action-bounds / dispatcher.test / package-manifest。测试策略、失败模式与真机边界见 [docs/TESTING.md](docs/TESTING.md)；最近一次证据见 [VERIFICATION.md](VERIFICATION.md)。

## 文档地图

| 文档 | 读者 | 内容 |
|---|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 贡献者 | 模块、工具面、请求/观察流水线、投递链、快照状态机、扩展指南 |
| [docs/COMPATIBILITY-0.2.2.md](docs/COMPATIBILITY-0.2.2.md) | 升级审查 | dsh 0.2.2 契约矩阵、P0/P1 兼容缺口、升级顺序 |
| [docs/WINDOWS.md](docs/WINDOWS.md) | Windows 用户/贡献者 | 完整性级别、前台锁、输入通道、坐标/DPI、清理规则、冒烟矩阵 |
| [docs/TESTING.md](docs/TESTING.md) | 贡献者 | 离线/真机/评测三层测试、断言清单、排障与新增测试 |
| [VERIFICATION.md](VERIFICATION.md) | 审查者 | 当前验证矩阵、按日期的证据、未验证项 |
| [PERMISSIONS.md](PERMISSIONS.md) | 审查者 | 权限面、网络/凭据/命令声明、承诺验证矩阵 |
| [docs/store-evidence.md](docs/store-evidence.md) | STORE 审查 | 一次性 profile 安装/启动/卸载证据 |
| [ROADMAP.md](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/ROADMAP.md) | 维护者 | 已交付、待实验、驱动缺口、明确不做 |
| [PUBLISH.md](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) | 维护者 | 版本口径、发布前检查、发布/部署/npm 步骤 |
| [MAINTAINING.md](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/MAINTAINING.md) | 维护者 | 环境、硬知识、工作约定、已知缺口 |
| [CHANGELOG.md](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/CHANGELOG.md) | 所有人 | 版本历史 |
| [evals/README.md](evals/README.md) | 评测者 | S4 任务集、oracle、runner 与环境知识 |

## English (brief)

Windows-first Computer Use plugin for the DeepSeek Harness: 22 tools (21 desktop capabilities + one dispatcher), with **2 stable tools visible by default** and the other 20 routed through `computer_do`. It drives local desktops through [cua-driver](https://github.com/trycua/cua) with an isolated virtual cursor.

- **Loop**: `screen_observe` (AX/UIA index tree, native screenshot, or vision observer) → act by `element` index or window-screenshot pixels → verify.
- **Stance — zero-friction autonomy**: no approval prompts; background-first delivery escalates to foreground/`bring_to_front` and restores the previous foreground. The only content-level hard refusal is automated password entry (`typing` / `set_value`); `extremePatterns` adds non-blocking warning notes.
- **Cache-friendly surface**: `surfaceMode` is either `dispatcher` (default, 2 visible) or `hybrid` (2 + 5 hot tools). The old dynamic enter/exit surface was removed.
- **Honest boundaries**: Windows is the deep-tested target; macOS is basic; Linux is unverified. Delegation tool restriction is not available on dsh 0.2.2 (`startActivation` has no `toolFilter`), so the sub-agent may have parent-level capabilities; the receipt says so.

**Install**: install cua-driver, then `git clone https://github.com/orangeofcarl0-sys/dsh-win-computer-use.git && ./install.sh` (set `DSH_HOME` on Windows/Linux). Defaults: `ttlMs: 60000`, `deliveryMode: auto`, `surfaceMode: dispatcher`; full table above.

Derived from [988hj7tczd-oss/dsh-computer-use](https://github.com/988hj7tczd-oss/dsh-computer-use) (MIT); see [Acknowledgements](#出处与致谢).

---

## 出处与致谢

**原仓库（代码基座）**

- [988hj7tczd-oss/dsh-computer-use](https://github.com/988hj7tczd-oss/dsh-computer-use) @ `07477f4`（MIT）——本项目的直接前身。按 MIT 派生后独立演进：安全姿态、投递管线、观测几何均按本仓库路线重写，与上游不自动合并；早期问题反馈（#7 resolveBin、#8 hotkey 通道）已提回上游跟踪。

**运行时底座**

- [trycua/cua](https://github.com/trycua/cua)（MIT）——[cua-driver](https://cua.ai/docs/concepts/what-is-computer-use) 是本插件消费的跨平台驱动。“后台优先、升级梯子、foreground 是对观测失败的响应”的投递哲学与之同源；Windows 侧的三级链、`bring_to_front` 恢复语义、XAML hotkey 通道为本仓库在本机实测的自有实现。

**设计思想借鉴（方法与验收，不含代码）**

- [Microsoft UFO²](https://www.microsoft.com/en-us/research/publication/ufo2-the-desktop-agentos/)——UIA∪视觉混合控制、GUI-API 混合执行的路线图输入；
- [Agent-S](https://www.simular.ai/articles/agent-s)（Simular，ICLR 2025）——ACI（辅助功能树 + set-of-marks）的 grounding 兜底思路；
- [OSWorld](https://osworld-v1.xlang.ai/) / [Windows Agent Arena](https://microsoft.github.io/WindowsAgentArena/)——执行式 oracle 回归验证方法论；
- Anthropic / OpenAI CUA / Gemini computer use——截图循环与原子动作空间的参照系；
- ZCode 官方 computer-use 插件——action receipt / 观察版本化契约的重放安全设计参照。

除原仓库派生部分外，本项目不含上述项目的代码；借鉴限于思想与验收方法层面。
