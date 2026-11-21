# COMPATIBILITY — 兼容性矩阵

> 目的：一张表看清 Node、dsh、驱动、OS、模型的“已实测/支持/预期/未验证”状态。
> 读者：部署者、集成者、升级审查。
> 状态：当前实现（最后核对 2026-11-22）。
> 相关：[DRIVER-SDK](DRIVER-SDK.md) · [INSTALL](INSTALL.md) · [WINDOWS](WINDOWS.md)。

## 1. 支持级别

| 级别 | 含义 |
|---|---|
| **已实测** | 在本仓库真机/真实驱动上跑过，有日期化证据 |
| **支持** | 代码路径存在且离线测试覆盖，但没有当前版本的真机证据 |
| **预期** | 按发布说明/代码形态推断，未验证；不要据此承诺 |
| **未验证** | 没有证据，也没有代码路径保证 |

## 2. 总矩阵

| 依赖/平台 | 版本 | 级别 | 说明 |
|---|---|---|---|
| Node.js | `>=22.18.0` | 已实测 | `engines` 与 `dsh.compatibility.node`；CI 目标 Node 22 |
| dsh | `0.2.2-rc.1` | 已实测 | 兼容范围 `>=0.2.2-rc.1 <0.3.0` |
| dsh | `0.2.2-rc.2` | 支持 | 运行时形状按 rc.2 实测过 `startActivation`；类型声明与运行时不一致，以运行时为准 |
| `@deepseek-ai/dsh-tools` | `0.2.2-rc.1` | 已实测 | peer `>=0.2.2-rc.1 <0.3.0` |
| `@deepseek-ai/schemastery` | `3.19.0` | 已实测 | peer `>=3.19.0 <4` |
| cua-driver | `0.23.2` | 已实测（基线） | 旧请求/响应形态；像素缩放不能整窗；modifier drag 不读取（走私有） |
| cua-driver | `0.52.13` | 已实测（canary） | 默认 markdown、session 归属、capture-only、原生 modifier drag |
| cua-driver | `0.53.x` | 预期 | 按发布说明预留 `screenshot_frame`/flat window；未真机验证 |
| Windows 10/11 x64 | 11 深度实测 | 已实测 | 前台锁、UIPI、XAML/WinUI、结构密码扫描、DPI |
| macOS | — | 支持（历史） | 基础路径；近期未回归；需 Accessibility/Screen Recording |
| Linux | — | 未验证 | 桌面/accessibility 栈差异大；不在承诺范围 |
| 模型 image 输入 | 由 route 声明 | 已实测 | `native`/`screen_zoom` 要求 `inputModalities` 含 `image` |
| 模型工具调用 | 宿主要求 | 已实测 | 没有工具调用能力的模型无法使用 |

## 3. dsh 0.2.2 契约

| 契约 | 事实 | 插件处理 | 状态 |
|---|---|---|---|
| `defineTool` | 作者面 schema 投影为宿主强制子集 | 只用返回值注册；直接传字面量会导致整树加载失败 | ✅ |
| 输出 schema | `additionalProperties:false` 严格校验 | 所有工具声明 output；降级字段也声明 | ✅ |
| 参数校验 | `defineTool` 先校验，`wrap()` 再拒绝未知键 | 双重校验；未知参数附纠正提示 | ✅ |
| 工具注册 | 全局/作用域；`run_code` 保留名 | 只注册可见子集；隐藏工具经 dispatcher | ✅ |
| `ToolRunContext` | `agent`/`signal`/`deferContext`/`concludeTurn` | 只读 `agent`/`signal` | ✅ |
| attachments | `maxImageDimension`/`maxImagePixels` | native/zoom 判定覆盖 | ✅ |
| llm | `resolveModelInfo`/`stream` | native/vision 真机通过 | ✅ |
| subagents | `startActivation(spec)` 扁平 spec | `delivery:'caller'`；结果映射；`outputSchema` 降级 | ✅ P0 已修 |
| `toolFilter` | 0.2.2 没有 | 不假装限制；回执写“同级能力” | ✅ 明确限制 |
| PTC / `run_code` | SDK 只绑定可见工具 | 隐藏工具走 `tools.computer_do` | ✅ 真机 |
| Web runner | 基于 0.1.5 UI，0.2.2 失效 | `evals/run.mjs` 默认拒绝，指向 `headless-run.mjs` | ⛔ 退役 |
| `dsh.compatibility.dsh` | 无上限 | 补 `<0.3.0` | ✅ |

## 4. cua-driver 兼容层

所有驱动 I/O 经 `lib/driver/`；`lib/cua.js` 是 facade。详见 [DRIVER-SDK](DRIVER-SDK.md)。

### 4.1 能力标志

| 标志 | 0.23.2 | 0.52.13 | 0.53 | 消费点 |
|---|---|---|---|---|
| `treeFormat` | ✅ | ✅（默认 markdown，必须显式） | ✅ | `mapRequest` |
| `flatWindow` | ❌ | ✅ | ✅ | 元数据标志，运行时未消费 |
| `screenshotFrame` | ❌ | ❌ | 预期 | 元数据标志，运行时未消费 |
| `dragModifier` | ❌ | ✅ | ✅ | drag 引擎选择 |
| `pointerCapture` | ❌ | ✅ | ✅ | 像素动作预检 |
| `captureOnly` | ❌ | ✅ | ✅ | capture 读形态 |
| `moveCursorScreen` | ❌ | ✅ | ✅ | hover/滑行坐标 |
| `frameSpace` | `screen` | `screen` | 首次响应校准 | `normalizeElement` |

> `flatWindow`/`screenshotFrame`/`zoomMime` 当前只写入能力信息，不被运行时分支读取；不要把它们当行为开关。

### 4.2 版本阈值

| 阈值 | 行为 |
|---|---|
| `>=0.39.0` | 原生 drag modifier |
| `>=0.52.0` | pointer capture、capture-only、`move_cursor` 屏幕坐标 |
| `>=0.53.0` | flat window、screenshot frames、profile `latest` |
| `<0.39.0` | profile `legacy` |

`driverProfile` 显式覆盖版本推断：`legacy` 清空现代标志；`latest` 启用全部；`auto` 按 `--version`/env 推断并学习。

### 4.3 contract

- 兼容层**不做 contract 版本白名单**；解析 `contract version A does not match SDK B` 和 `contract: X`/`SDK: Y`。
- daemon/SDK 不一致只警告，并要求 CLI 与 daemon 一起升级；不硬失败。
- 文档里的 `0.7.0`/`0.8.0` 是真实不匹配示例，不是支持矩阵。

### 4.4 真实差异（0.52.13）

| 现象 | 处理 |
|---|---|
| `get_window_state` 默认 `tree_format:"markdown"` | 总是显式请求 `elements` |
| element_token/zoom 按 session 归属 | `get_window_state` 注入 `CUA_SESSION` |
| 像素 click/drag/scroll/zoom 需要截图上下文 | 0.52+ 补 capture-only（保留 token）；0.23.2 退回 `max_elements:1` 并标 token 失效 |
| 裸 `code` 拒绝（`screenshot_context_missing`） | `FAILURE_CODES` 按拒绝上报，不写成成功 |
| 结构化拒绝非零退出 | 解析为回执值，继续前台升级 |
| 前台 click 校验目标 HWND | 既有 `bring_to_front` 前置/绕锁链 |
| `move_cursor` window scope 用屏幕坐标 | 用快照原点换算，去掉 `origin` 字段 |

## 5. 模型 image 能力

`native` 与 `screen_zoom` 需要当前 route 声明 image 输入：

```text
exec.agent.session.requestHeader().config
  → ctx.llm.resolveModelInfo(provider, model).inputModalities includes 'image'
```

没有 `llm`/`attachments` 时 native 不可用；`vision` 走观察者，失败回退 GLM（需 key）。模型目录、provider、key 由宿主负责，插件不内置模型列表。

## 6. 平台

| 平台 | 状态 | 边界 |
|---|---|---|
| Windows 11 | 深度实测 | 前台锁、UIPI、XAML/WinUI、结构密码扫描、DPI 1:1 观测 |
| Windows 10 | 支持 | 同上；未单独回归 |
| macOS | 基础可用（历史） | TCC/Accessibility；近期未回归；Windows 专属行为不适用 |
| Linux | 未验证 | 不在承诺范围；不要写成“已支持” |

## 7. 升级/回退

```powershell
# 驱动：安装指定版本后确认 CLI/daemon 一致
cua-driver --version
cua-driver status
cua-driver doctor
node verify-runtime.mjs
```

- 插件回退：`driverProfile: legacy` / `dragEngine: private`；或把 junction 指回旧版本。
- 升级顺序：驱动 CLI+daemon → `verify-runtime` → `probe-driver-shape` → 手势/组合键/私有拖拽/from_zoom/native freshness 探针 → t11/t14/t15/t17。
- 不要覆盖 `~/.cua-driver/packages/releases/<version>/`；每个版本目录不可变。

## 8. 已知不兼容/风险

- 0.53 未真机验证；`screenshot_frame` 只按发布说明预留。
- 0.52 的截图与 `window_bounds` 仍可能差 1–2px；精确像素任务用 `screen_zoom + from_zoom`。
- 0.23.2 混合 DPI 像素点击有实测偏差；element 路径可靠。
- dsh 0.2.2 没有 `toolFilter`；委派工具集无法按调用限制。
- PTC SDK 只绑定可见工具；隐藏工具必须经 `computer_do`。
- macOS/Linux 的 Windows 专属行为不适用或未验证。

## 9. 复现

```bash
npm test; echo "test=$?"
npm run check; echo "check=$?"
node verify-runtime.mjs
node evals/probe-driver-shape.mjs
node evals/probe-modifier.mjs
node evals/probe-private-drag.mjs
node evals/verify-oracles.mjs
```

历史升级报告与逐轮证据见 [EVIDENCE](EVIDENCE.md)；旧 `COMPATIBILITY-0.2.2.md` 保留为别名页。
