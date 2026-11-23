# dsh-win-computer-use

> **Windows-first Computer Use for DeepSeek Harness。**
> 深度 Win32 / WinUI / UIA 工程 · 零审批三级投递 · 23 个工具，默认 2 个稳定入口。

[![Release](https://img.shields.io/badge/release-0.6.0-blue)](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/releases)
[![npm](https://img.shields.io/badge/npm-dsh--win--computer--use-CB3837)](https://www.npmjs.com/package/dsh-win-computer-use)
[![main](https://img.shields.io/badge/main-0.6.0-blue)](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/commits/main)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.2.2--rc.1-green)](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/docs/COMPATIBILITY.md)
[![Windows](https://img.shields.io/badge/Windows-deep--tested-0078D4)](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/docs/WINDOWS.md)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.18.0-339933)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **版本状态（2026-11-23）**：npm 最新为 `dsh-win-computer-use@0.6.0`（tag `v0.6.0`）；`main` = 0.6.0，含 PTC 对象桥接（`ptcBridge` 默认 off）、`autonomy` 策略与 relative 坐标。旧名 `dsh-computer-use` 是上游包（latest 0.3.1），不是本项目。web profile 已安装 0.6.0（运行中的 web 进程需重启）——见 [PUBLISH](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md)。
>
> 2026-11-10 起包名/仓库名从 `dsh-computer-use` 改为 `dsh-win-computer-use`；旧 GitHub URL 自动 redirect。

![verified desktop demo](assets/demo-verified.png)

## 这是什么

给 [DeepSeek Harness](https://github.com/988hj7tczd-oss/harness-desktop) 加一层**可观察、可验证、Windows 深度实测**的桌面操作能力。底层通过 [cua-driver](https://github.com/trycua/cua) 驱动本地桌面；插件本身不内置截图循环，也不替模型做决策——它把“看、点、输、验”拆成细粒度工具，由模型组合。点击走虚拟光标（可见滑行，不移动真实指针；`computer_hover(real=true)` 是例外）；后台投递不抢焦点，需要前台时短暂交换并恢复。

默认只暴露 **2 个稳定入口**（`computer_do` + `screen_observe`），其余 **21 个工具**经 dispatcher 路由；切到 `hybrid` 可再直接暴露 5 个高频动作。工具列表在会话内保持不变，以保护 prompt cache。

它不是“跨平台 CUA 的薄封装”。Windows 上真正难的不是“能不能点”，而是下面这些墙——本仓库逐项踩过并写进了实现：

| Windows 硬问题 | 本仓库的处理 |
|---|---|
| 前台锁（ForegroundLockTimeout）让 `SendInput` 打空 | 后台 → 前台 → `bring_to_front`（AttachThreadInput）三级投递，结束后恢复原前台 |
| XAML / WinUI 不吃 `PostMessage`，组合键走 UIA 加速器还会超时 | 文本走 UIA `ValuePattern`；组合键走 `hotkey` 通道并翻译 UIA 超时；保存类操作改走“点控件” |
| 元素坐标是屏幕物理像素，点击坐标却是窗口截图空间 | `screen_observe` 输出统一换算到窗口截图空间；`element_token` 路径与像素路径分离 |
| 驱动是高完整性进程，`app_launch` 的子进程非提权侧关不掉 | 文档与工具描述明确代价；测试清理按标题/HWND 匹配，绝不按进程名杀 |
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

安全边界与威胁模型见 [SECURITY](docs/SECURITY.md)；权限声明见 [PERMISSIONS](PERMISSIONS.md)。

## 快速开始

### 1. 安装 cua-driver

按 [trycua/cua](https://github.com/trycua/cua) 的说明安装驱动。插件按 `CUA_DRIVER_BIN` → `PATH` → 常见安装路径的顺序定位；找不到时所有工具返回结构化错误与自救指引。完整前置、定位顺序与版本要求见 [INSTALL](docs/INSTALL.md)。

### 2. 安装插件

npm 已发布 `dsh-win-computer-use@0.6.0`，三种方式任选：

- npm：`npm install dsh-win-computer-use`；
- dsh：`dsh plugin add dsh-win-computer-use`；
- 脚本/手动：`install.sh`（bash，已有 `profiles/web`）或手动 junction + `cordis.patch.yml`。

完整步骤、`DSH_HOME` 规则、headless/隔离 profile 与卸载见 [INSTALL](docs/INSTALL.md)。

### 3. 第一次观察

```text
1) screen_observe(window="Notepad")
2) computer_do({action:"catalog"})        # 看隐藏工具签名
3) computer_do({action:"call", tool:"computer_click", args:{element: 12}})
4) screen_observe(window="Notepad")       # 复核
```

`screen_observe` 返回编号元素、坐标、快照 id 与坐标空间说明。动作前没有新鲜快照会被拒绝——这是 `[snapshot_missing]`，不是工具故障。参数、默认值与逐工具示例见 [TOOLS](docs/TOOLS.md)。

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

快照是**全局单例**：任意窗口的新全量观察都会替换 `snapshot_id`；`query` 是只读视图，会清除旧动作快照。动作前需要全量观察。

## 工具面：默认 2 个入口

23 个工具的 schema 常驻会持续占用模型注意力，也会让工具层变化打断 prompt cache。默认只注册 2 个稳定入口：

| 模式 | 直接可见 | 隐藏 | 路由方式 |
|---|---|---|---|
| `dispatcher`（默认） | `computer_do` + `screen_observe` | 21 | `computer_do({action:'call', tool, args})` |
| `hybrid` | 2 + `computer_click` / `computer_type` / `computer_key` / `computer_scroll` / `computer_verify` | 16 | 热工具直接调用；长尾经 dispatcher |

`computer_do` 的三种动作：

- `action:"catalog"`：列出隐藏工具的紧凑签名（`name(required,optional?)`），最多 24 条；`query` 可按名称/描述过滤。
- `action:"call"`：路由到隐藏工具；隐藏工具**不注册、不能直接调用**，但仍走自己的锁存/守卫/参数校验/快照/回执。
- `action:"status"`：查看当前模式与可见/隐藏清单。
- `ptcBridge:on` 时 PTC preset 的 Agent 额外获得 `computer_cua` 对象桥接（23 → 24 个工具）；默认 off，普通工具面不变。见 [docs/PTC.md](docs/PTC.md)。

> PTC / `run_code` 模式下，SDK 只绑定**直接可见**的工具；隐藏工具不会出现在 SDK 里，仍需 `tools.computer_do({action:'call', tool, args})` 路由（例如 `tools.computer_task` 为 undefined 是预期行为）。

**为什么不用动态 enter/exit：** 旧的 `dynamic` 模式会在会话中途注册/注销工具，tools 数组一变缓存首击只剩 **0%–18%**，稳定工具面则保持高命中；因此 `dynamic` 已彻底删除，只保留两种稳定工具面。A/B 数字见 [EVIDENCE](docs/EVIDENCE.md) §27。

**取舍**：`hybrid` 让高频动作少一层 JSON 包装，但可见面从 2 变 7；`dispatcher` 的 catalog 调用本身也占一步。复杂参数（如 `computer_verify` 的 `expect` JSON）建议先 `catalog` 看签名，必要时在 system prompt 里给一个示例。

## 能力边界

- **委派不是沙箱。** `computer_task` 走宿主 `startActivation`；dsh 0.2.2 没有 `toolFilter`，子 agent 可能拥有与父会话同级能力。回执会写明；需要严格限制时用宿主 Agent Preset。
- **`app_launch` 的窗口可能需要人工收尾。** daemon/子进程完整性取决于驱动版本与启动路径（0.52.13 实测 daemon High、PowerShell 子进程 Medium）；非提权客户端可能关不掉 High IL 子窗口；测试/自动化优先操作已在运行的普通应用。事实矩阵见 [WINDOWS §1](docs/WINDOWS.md)。
- **像素点击是 best-effort。** 混合 DPI 下驱动 0.23.2 的像素落点存在实测偏差；element 路径是可靠主路径。
- **Explorer 文件项的单选要用 `foreground=true`。** 后台坐标点击会走 UIA Invoke，等于“打开”，会弹出 Notepad/Photos/PDF。
- **`computer_drag` 的 modifier 在驱动支持 `dragModifier` 时走原生；旧驱动/`dragEngine:private` 或 `dwell_ms>0` 走私有 SendInput helper。** 私有路径是原子手势、修饰键持有到 drop、失败路径释放；不支持 `from_zoom`。无 modifier 的 drag 默认走驱动。
- **`screen_zoom` 需要当前模型支持图片输入。** 小字号 JPEG 可能不可读；读文字用 `native`。
- **`computer_hover` 是实验性能力。** 默认只移动虚拟覆盖层；`real=true` 才动真实指针。
- **`computer_menu` fail-closed。** 路径缺失/歧义/禁用/结构不匹配即失败，绝不回退像素。
- **平台**：Windows 深度实测；macOS 与 Linux 未验证。
- **自治策略**：默认 `auto` 零提示；`blockedApps`/`sensitiveApps`、`locked` 白名单、`guarded` 会话级询问与子 Agent 真实指针默认 deny 见 [AUTONOMY](docs/AUTONOMY.md)。

逐条错误与处理见 [ERRORS](docs/ERRORS.md) 与 [TROUBLESHOOTING](docs/TROUBLESHOOTING.md)；Windows 底层原因见 [WINDOWS](docs/WINDOWS.md)。

## 平台与兼容性

| 依赖/平台 | 版本 | 状态 |
|---|---|---|
| Windows 11 x64 | — | ✅ 深度实测 |
| macOS | — | ◻ 未验证 |
| Linux | — | ◻ 未验证 |
| Node.js | `>=22.18.0` | ✅ |
| dsh | `>=0.2.2-rc.1 <0.3.0` | ✅ 基线 `0.2.2-rc.1` |
| cua-driver | `0.23.2` 基线 / `0.52.13` canary | ✅ 两者均实测；`0.53` 预期未验证 |
| 模型 | 工具调用；native/zoom 需 image | ✅ |

macOS 与 Linux 均按未验证处理：macOS 只有 0.1–0.2 时期的基础路径记录，近期未回归；Linux 不在承诺范围。完整矩阵、驱动能力标志与升级/回退步骤见 [COMPATIBILITY](docs/COMPATIBILITY.md) 与 [DRIVER-SDK](docs/DRIVER-SDK.md)。

## 文档

**唯一文档索引是 [docs/README.md](docs/README.md)**（按读者/任务/状态组织，含术语表与阅读路径）。快速入口：[INSTALL](docs/INSTALL.md)（安装/升级/卸载）· [TOOLS](docs/TOOLS.md)（23 个工具）· [CONFIGURATION](docs/CONFIGURATION.md)（32 个配置键）· [PTC](docs/PTC.md)（对象层/协议/能力诊断）· [ERRORS](docs/ERRORS.md) / [TROUBLESHOOTING](docs/TROUBLESHOOTING.md)（错误码/排障）· [SECURITY](docs/SECURITY.md) / [PERMISSIONS](PERMISSIONS.md)（安全/权限）· [ARCHITECTURE](docs/ARCHITECTURE.md) / [RUNTIME-PIPELINE](docs/RUNTIME-PIPELINE.md)（内部结构）· [TESTING](docs/TESTING.md) / [VERIFICATION](VERIFICATION.md)（测试/当前验证矩阵）· [EVIDENCE](docs/EVIDENCE.md)（按日期的运行证据与失败样本）。

开发与验证命令见 [TESTING](docs/TESTING.md)；维护者环境、硬知识与发布检查见 [MAINTAINING](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/MAINTAINING.md) 与 [PUBLISH](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md)。

## English (brief)

Windows-first Computer Use plugin for the DeepSeek Harness: 23 tools (22 desktop capabilities + one dispatcher), with **2 stable tools visible by default** and the other 21 routed through `computer_do`. It drives local desktops through [cua-driver](https://github.com/trycua/cua) with an isolated virtual cursor.

- **Loop**: `screen_observe` (AX/UIA index tree, native screenshot, or vision observer) → act by `element` index or window-screenshot pixels → verify.
- **Stance — zero-friction autonomy**: no approval prompts; background-first delivery escalates to foreground/`bring_to_front` and restores the previous foreground. The only content-level hard refusal is automated password entry (`typing` / `set_value`); `extremePatterns` adds non-blocking warning notes.
- **Cache-friendly surface**: `surfaceMode` is either `dispatcher` (default, 2 visible / 21 hidden) or `hybrid` (7 visible / 16 hidden). The old dynamic enter/exit surface was removed.
- **Honest boundaries**: Windows is the deep-tested target; macOS and Linux are unverified (macOS has only 0.1–0.2-era basic-path records). Delegation tool restriction is not available on dsh 0.2.2 (`startActivation` has no `toolFilter`), so the sub-agent may have parent-level capabilities; the receipt says so.

**Install**: install cua-driver (0.23.2 baseline; 0.52.13 canary tested; 0.53 expected), then `npm install dsh-win-computer-use` (or `dsh plugin add dsh-win-computer-use`); see [docs/INSTALL.md](docs/INSTALL.md). Defaults: `ttlMs: 60000`, `deliveryMode: auto`, `surfaceMode: dispatcher`; full reference in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

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
