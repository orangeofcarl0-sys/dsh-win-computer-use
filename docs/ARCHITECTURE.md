# ARCHITECTURE — 内部结构

> 目的：模块边界、工具面、请求/观察管线、快照、投递、委派、不变量与扩展方式。
> 读者：要改代码或排查行为的人。
> 状态：当前实现（最后核对 2026-11-18；代码快照 `main` @ 0.5.7-dev）。
> 相关：[RUNTIME-PIPELINE](RUNTIME-PIPELINE.md) · [TOOLS](TOOLS.md) · [ERRORS](ERRORS.md) · [docs/README](README.md)。

## 1. 目标与非目标

**目标**

1. 把桌面操作拆成模型可组合的细粒度工具，而不是一个黑盒“computer use”循环。
2. 每次动作都基于**可验证的观察快照**；失败、拒绝、未验证必须有结构化语义。
3. Windows 上把前台锁、UIPI、XAML/WinUI 输入、坐标/DPI 这些硬问题在插件层处理掉。
4. 工具列表在会话内稳定，避免工具层变化打断 prompt cache。

**非目标**

- 不做跨平台行为对齐；Windows 是深度实测目标，macOS 基础可用，Linux 未验证。
- 不做审批网关；安全姿态是“零审批 + 基本兜底 + 全量注记”。
- 不做动态工具面（enter/exit 已删除）；只保留 `dispatcher` / `hybrid` 两种稳定面。
- 不替代宿主的子 agent 沙箱；委派约束受宿主能力限制，插件如实报告降级。

## 2. 运行时拓扑

```mermaid
flowchart LR
  M["对话模型"] -->|tool call| H["DSH 宿主<br/>tools / attachments / llm / subagents"]
  H --> P["index.js<br/>注册 + wrap 管线"]
  P --> OBS["lib/observe.js<br/>screenObserve / screenZoom"]
  P --> ACT["lib/actions.js<br/>动作"]
  P --> OPS["lib/ops.js<br/>verify / menu / stop…"]
  P --> TASK["lib/task.js<br/>computer_task"]
  ACT --> HUMAN["lib/human.js<br/>虚拟光标 / 点击瞄准"]
  ACT --> PRIV["lib/privateDrag.js<br/>私有 SendInput 拖拽"]
  OBS --> SNAP["lib/snapshot.js"]
  ACT --> SNAP
  OPS --> SNAP
  OBS --> VIS["lib/vision.js"]
  OBS --> ATT["lib/attach.js"]
  OBS --> PS["lib/passwordScan.js<br/>Windows sidecar"]
  ACT --> RECEIPT["lib/receipt.js"]
  OPS --> RECEIPT
  OBS --> CUA["lib/cua.js"]
  ACT --> CUA
  OPS --> CUA
  TASK --> SUB["宿主 subagents"]
  VIS --> LLM["宿主 llm"]
  ATT --> ATTS["宿主 attachments"]
  CUA -->|"spawn 固定 argv"| DRV["cua-driver daemon"]
  DRV --> OS["Windows: UIA / SendInput / PostMessage / 剪贴板"]
```

依赖方向单向：`index.js → lib/* → cua-driver`；`snapshot.js`、`attach.js`、`engine.js`、`roles.js`、`dispatcher.js` 是低层叶子，不反向依赖动作/观察模块。

## 3. 模块地图

| 文件 | 关键导出 | 职责 | 依赖 |
|---|---|---|---|
| `index.js` | `Config`、`apply`、`toolDefinitions` | 配置 schema；五组工具定义；`defineTool` 投影；`apply()` 注册可见工具；`wrap()` 统一管线；`computer_do` 元工具 | 全部 lib |
| `lib/observe.js` | `screenObserve`、`screenZoom`、`dedupEvaluate`、`dedupReset` | 目标选择、抓树、桌面降级、模式决策、结构密码标记、状态差分、快照缓存、渲染、降噪、zoom 裁剪 | cua / snapshot / attach / vision / passwordScan / roles |
| `lib/actions.js` | `click`、`doubleClick`、`rightClick`、`typeText`、`setValue`、`key`、`scroll`、`drag`、`wait`、`listApps`、`launchApp`、`activate` | 动作实现；快照/窗口解析；目标回显；投递；回执 | cua / human / receipt / snapshot / engine / privateDrag |
| `lib/human.js` | `glideCursor`、`humanClick`、`resolveClickTarget`、`screenPointOf`、`windowLocalOf`、`describeClickTarget`、`nearestEntry` | 虚拟光标滑行（auto/human/off）；element_token / 像素点击；坐标适配；目标回显 | cua / snapshot |
| `lib/privateDrag.js` | `privateDrag`、`stopPrivateDrag` | 持久 PowerShell helper 的 stdin/stdout JSON 封装；惰性启动、串行队列、超时/崩溃恢复、空闲退出 | `tools/private-drag.ps1` |
| `lib/loopGuard.js` | `checkRepeat`、`noteObserveChange`、`resetLoopGuard` | 同窗口/目标/投递模式 5s 重复点击抑制；观察变化清除 | human |
| `lib/trajectory.js` | `trajectoryStart`、`runTool`、`logDriverCall`、`trajectorySummary`、`sanitizeArgs` | CU 轨迹 JSONL：脱敏、驱动归属、loop/耗时/未验证/移动数 | node:fs / node:async_hooks |
| `lib/ops.js` | `createOpsState`、`gate`、`stop`、`resume`、`verifyOnce`、`waitFor`、`clipboard`、`menu`、`hover` | 确定性验证、轮询、剪贴板、菜单直调、悬停、强杀锁存 | cua / snapshot / attach / engine / receipt |
| `lib/task.js` | `runComputerTask`、`resetTaskCalls`、`DELEGATION_RECIPE` | 子 agent 委派（0.2.2 `startActivation`）、能力降级、超时/预算、结构化结果 | 宿主 `subagents` |
| `lib/guard.js` | `guard`、`extremeNote` | 无快照拒绝、白名单、密码三态、极危注记、inputUnconfirmed 保存意图门禁 | snapshot / roles / keyFallback / human |
| `lib/snapshot.js` | `setSnapshot`、`resolveToken`、`resolveWindow`、`validateSnapshotId`、`markConsumed`、`markSuspect`、`freshnessGate`、`markInputUnconfirmed`/`getInputUnconfirmed`/`clearInputUnconfirmed` | 全局单例快照、TTL、编号解析、消费/可疑标记、连击语义；跨快照的输入未确认状态 | — |
| `lib/windowMap.js` | `rememberWindows`、`pidOfWindow`、`resetWindowMap` | list_windows 的 window_id→pid 缓存；L3 恢复原前台查 pid | — |
| `lib/receipt.js` | `receipt`、`refusalReceipt`、`settleAction`、`UNVERIFIED_NOTE`、`SUSPECTED_NOOP_NOTE`、`INPUT_UNVERIFIED_NOTE`、`SET_VALUE_NOTE` | 动作回执唯一出口：规范化 → 判拒绝 → 标快照 → 紧凑文本 | cua / engine / snapshot |
| `lib/engine.js` | `engineRefusal`、`isSuspectedNoop`、`uiaAcceleratorTimeout`、`FAILURE_CODES` | 驱动回执的拒绝形态统一识别（refusal/effect/error/code/ok:false/supported:false） | — |
| `lib/dispatcher.js` | `SURFACE_MODES`、`STABLE_TOOLS`、`HOT_TOOLS`、`visibleToolsForMode`、`hiddenToolNames`、`catalogOf` | 工具面常量、可见/隐藏清单、catalog 紧凑签名 | — |
| `lib/cua.js` | `CUA_BIN`、`CUA_SESSION`、`cuaCall`、`cuaDeliver`、`isUnverified`、`normalizeMcp`、`cuaDriverCapabilities` | 驱动 facade：会话自愈、请求映射、响应归一化、三级投递链、错误分类 | `lib/driver/*` |
| `lib/driver/transport.js` | `resolveBin`、`createTransport`、`DriverCallError`、`defaultTransport` | **唯一 spawn**：超时/退出码/JSON/contract/session/结构化拒绝分类；`runOnce` 只读版本/状态探测 | node:child_process |
| `lib/driver/capabilities.js` | `parseVersionText`、`capabilitiesFor`、`mapRequest`、`learnFromResponse`、`learnFromError`、`capabilitySummary` | 版本/能力标志；`tree_format`/`session` 注入；响应/错误自适应 | — |
| `lib/driver/normalize.js` | `normalizeWindowState`、`normalizeWindowList`、`normalizeZoom`、`normalizeReceipt`、`unwrapDriverPayload` | 0.23.2/0.52/0.53 形态 → 内部规范；保留未知字段；frame 空间校准 | — |
| `lib/driver/info.js` | `configureDriver`、`ensureDriverInfo`、`driverStatusLine`、`resetDriverInfo` | 进程级驱动信息缓存与 status 文本 | transport / capabilities |
| `lib/vision.js` | `routeImageCapable`、`modelImageCapable`、`deepseekVisionDescribe`、`glmVisionDescribe`、`glmVisionConfigured` | 当前 route 的 image 能力探测；DeepSeek 观察者；GLM 兜底 | 宿主 `llm`；GLM 需 `fetch` |
| `lib/passwordScan.js` | `scanPasswords`、`markElementsFromScan`、`IS_WINDOWS` | Windows UIA sidecar 结构密码扫描与坐标标记 | `powershell.exe` |
| `lib/roles.js` | `isPasswordCandidate`、`isMaskedValue`、`isActionableRole` | 跨平台角色语义：密码三态、可交互过滤 | — |
| `lib/attach.js` | `saveImageAttachment` | 图片持久化到宿主 attachments 的统一出口 | — |
| `lib/keyFallback.js` | `canonicalKey`、`isFallbackKey`、`tryXamlKeyFallback`、`xamlKeyGuidance` | XAML/WinUI 组合键的菜单/token 回退；唯一标签、歧义即停 | cua / snapshot / windowMap |
| `lib/menu.js` | `isMenuRole`、`isTopMenuBarLabel`、`isAppMenuBarLabel`、`menuStateOf` | 菜单角色/顶层菜单/菜单状态判定 | — |
| `tests/lib/harness.mjs` | `makeWorkCopy`、`writeStubDriver`、`makeCtx`、`validateSchema`、`makeChecks` | 测试工作副本、可编程驱动桩、严格 schema 校验 | node:fs |

## 4. 工具面：数据、注册、路由

### 4.1 工具面即数据

`index.js` 里五组函数返回定义数组：

| 组 | 工具 | 数量 |
|---|---|---:|
| 观察 | `screen_observe`、`screen_zoom` | 2 |
| 动作 | `computer_click`、`double_click`、`right_click`、`type`、`set_value`、`key`、`scroll`、`drag`、`wait`、`app_list`、`app_launch`、`computer_activate` | 12 |
| 运营 | `computer_verify`、`wait_for`、`clipboard`、`menu`、`hover`、`stop`、`resume` | 7 |
| 委派 | `computer_task` | 1 |
| 元工具 | `computer_do` | 1 |

`apply()` 做四件事：

1. 把配置装配成内部 `cfg`（`extremePatterns` → `extremeRes` 等）；
2. 用 `defineTool(raw)` 包装每个定义（**必须使用返回值**，见 §11 第 8 条）；
3. 按 `visibleToolsForMode(cfg.surfaceMode)` 只注册可见工具；
4. 把全部定义存到 `lastToolDefs`，通过 `toolDefinitions()` 暴露给测试/诊断（不面向前台模型）。

### 4.2 两种稳定面

| 模式 | 可见 | 隐藏 | 说明 |
|---|---|---:|---|
| `dispatcher`（默认） | `computer_do`、`screen_observe` | 21 | 所有动作经 dispatcher 路由 |
| `hybrid` | 上面 2 个 + `HOT_TOOLS` 5 个 | 16 | 热工具直接调用，长尾路由 |

`HOT_TOOLS = [computer_click, computer_type, computer_key, computer_scroll, computer_verify]`。`screen_zoom` 与 `computer_activate` 在两种模式下都隐藏。`catalogOf` 生成 `name(required,optional?)` 紧凑签名，最多 24 条。

### 4.3 隐藏工具仍然走完整管线

`computer_do` 的 `action:"call"` 执行：

```js
const def = defsRef().get(name)
const r = await def.execute(hiddenArgs, exec)
```

`def` 是 `defineTool()` 包装后的定义，其 `execute` 已经是最外层的 `wrap(...)`。因此隐藏工具不会绕过：

- 锁存闸门（`computer_stop` 后拒绝）；
- 未知参数检查；
- `guard()`（快照/白名单/密码/极危）；
- 工具自己的快照解析、投递、`settleAction`。

`computer_do` 自身在 `wrap` 中有一个特例：`gateName = null`，即 stop 期间 dispatcher 仍可进入。这是为了让 `computer_resume` 能经 dispatcher 解锁；隐藏工具自己的 `wrap` 仍会拒绝。

### 4.4 路由约束

- 不能路由 `computer_do` 自身（禁止递归）。
- 不能路由当前模式已直接可见的工具（提示直接调用）。
- 未知工具返回可用清单。
- `screen_zoom` 的 `image` 字段经 dispatcher 透传，`renderWithImage` 生成图片块。
- `action` 缺省按 `catalog` 处理（schema 仍要求显式 `action`）；`args` 非普通对象会被静默当成 `{}`。
- PTC / `run_code` 模式下，SDK 只绑定直接可见的工具；隐藏工具仍需 `tools.computer_do({action:'call', tool, args})` 路由（`tools.computer_task` 为 `undefined` 是预期行为，不是注册失败）。

## 5. 请求管线

### 5.1 外层 `wrap()`

```text
gate（stop 锁存；computer_do 除外）
  → 未知参数拒发（宿主参数表不含 additionalProperties，写错的键会被静默丢弃）
  → guard（无快照/白名单/密码/极危）
  → checkRepeat（重复点击抑制）
  → impl(args, cfg, exec)
  → 把 guard 的 note 追加到 result
```

任何异常都被归一化为 `{ ok:false, result:"✗ …" }`，不向宿主抛原始错误。

`toolParamNames` 在 `defineTool` 包装时登记每个工具的参数名；`wrap()` 用它拒绝未知键。这是为了避免“给 `screen_observe` 传 `app=` 被静默丢弃、回退到最前窗口”这类错目标问题。

### 5.2 动作内部（以 click 为例）

```mermaid
sequenceDiagram
  autonumber
  participant M as 模型
  participant W as wrap
  participant G as guard
  participant A as actions.humanAction
  participant S as snapshot
  participant R as receipt
  participant H as humanClick
  participant C as cuaDeliver
  participant D as cua-driver

  M->>W: computer_click(element=12)
  W->>W: 锁存闸门 / 未知参数
  W->>G: 快照·白名单·密码·极危
  G-->>W: 通过（可附注记）
  W->>A: click(args, cfg)
  A->>S: validateSnapshotId / freshnessGate
  A->>S: resolveClickTarget(element)
  A->>H: humanClick(token, pid, windowId)
  H->>H: 虚拟光标滑行（best effort）
  H->>C: click payload
  C->>D: L1 background
  alt background_unavailable
    C->>D: L2 foreground
    alt foreground_unavailable
      C->>D: L3 bring_to_front → foreground → restore
    end
  end
  C-->>H: value + note
  H-->>A: value + note
  A->>R: settleAction（规范化 / 判拒绝）
  R->>S: markConsumed / markSuspect
  A-->>W: { ok, result }
  W-->>M: 紧凑回执 + 注记
```

不是所有动作都走 `humanClick`：`type/key/scroll/drag/set_value` 各自构造 payload；但它们都走 `cuaDeliver`（`set_value` 直接 `cuaCall`，因为它是单次 UIA 设值）和 `settleAction`。`key` 在 `settleAction` 之前多一层 XAML 组合键特判：4s 超时 / `could not find a UIA AcceleratorKey` 会走指引或实验性 `keyFallback`，因为这两类不是普通拒绝。

### 5.3 回执状态

`settleAction` 是 click/double/right/type/key/scroll/drag/set_value 的唯一出口；menu/verify/clipboard/task/activate/launch/hover 有各自的回执。

| 输入形态 | `ok` | 快照标记 | 文本 |
|---|---|---|---|
| 正常 + `effect:confirmed` | `true` | `markConsumed` | 一行要点 |
| `unverifiable` | `true` | `markConsumed` + `markSuspect` | 附“先观察”注记 |
| `background_unavailable` / `foreground_unavailable` / `delivery_failed` | `false` | 不消费；`delivery_failed` 另标 suspect | “未送达；不要重复，必要时 foreground=true 重试” |
| `refusal` / `error` / `code` | `false` | 不消费（除非 `suspected_noop`） | 拒绝原因 |
| `effect:suspected_noop` | `false` | `markSuspect`，不 `markConsumed` | 附“不要立即重放” |
| `menu_path_unavailable` 等 | `false` | — | `refusalReceipt` |

XAML/WinUI 组合键例外（`lib/actions.js key()` + `lib/keyFallback.js`）：

1. 驱动抛错或返回 `could not find a UIA AcceleratorKey` / 4s 超时；
2. `xamlKeyFallback: off`（默认）→ 直接返回“点菜单栏项 → 点菜单项”的指引，不透传 `get_window_state`；
3. `xamlKeyFallback: auto` → 只对白名单组合，先找同 pid 窗口里现成的唯一菜单项，否则点快照里唯一的菜单栏项，轮询弹出菜单，点唯一的 enabled 目标项；全部 token 点击、后台投递；歧义/缺失立即停止；成功后清空快照并要求重新观察；不自动处理另存为/覆盖对话框。
4. `xamlPressFallback: auto` → 对 `ctrl+a` / `alt+f` 允许一次前台 `press_key`（带 pid/window_id，forceForeground）。两者都开时 `ctrl+a` 仍菜单优先，菜单不可用才 press；`alt+f` 直接 press、成功后清快照。只在前台通道发送（background 会把裸键插入 WinUI 正文）；不含 Alt+Tab；press 失败明确返回 `ok:false`，不再建议 `foreground=true`。

`engineRefusal` 统一识别 `effect`（refused/rejected/suspected_noop）、`error`、`refusal.code`、`code=invalid_arguments/unavailable/not_supported` 以及 `FAILURE_CODES`（`screenshot_context_missing` 等）；`deliveryFailure` 单独识别 `background_unavailable`/`foreground_unavailable`/`delivery_failed`，并在 `settleAction` 的 refusal 分支之前把 `ok` 置为 false。新增动作只要走 `settleAction`，就不会再出现“拒绝/未送达被当成功”的同类缺陷。

## 6. 观察管线

```mermaid
flowchart TD
  A["screen_observe(window?, mode?)"] --> B["list_windows(on_screen_only)"]
  B --> C{"指定 window?"}
  C -->|是| D{"pid / 标题 / 应用名匹配?"}
  D -->|否| E["fail-closed：候选列表，不建快照"]
  D -->|是| F["目标窗口"]
  C -->|否| G["z 序最前 + pickedFrontmost 注记"]
  F --> H["check_permissions（只读，30s 缓存）"]
  G --> H
  H --> I["get_window_state(include_screenshot?, max_elements, query?)"]
  I -->|失败| J["get_desktop_state → desktop-visual 降级"]
  I --> K["原始元素 → isActionable 过滤"]
  K --> L{"树空 / degraded_reason?"}
  L -->|是| M["需要补截图：模型可看图或 GLM 已配置"]
  L -->|否| N["模式决策"]
  M --> N
  N -->|mode=ax| O["ax：文本编号树"]
  N -->|mode=native| P["commitScreenshot → 图片块"]
  N -->|mode=vision| Q["ctx.llm 观察者 → 失败回退 GLM"]
  O --> R["结构密码标记（Windows sidecar）"]
  P --> R
  Q --> R
  R --> S["cacheSnapshot（在降噪判定前记录 consumedBefore）"]
  S --> T["渲染 + mapElementsForModel（坐标换算）"]
  T --> U{"降噪命中?"}
  U -->|是| V["极简 stub（summary/brief）"]
  U -->|否| W["全量 elements + 文本"]
```

### 6.1 目标选择

- `window` 依次按 `pid` 精确、标题子串、应用名/中英别名匹配；纯数字按 pid 解释，不是 window_id。
- 指定了 `window` 但没有匹配：**fail-closed**，返回最多 8 个候选，不建立快照。不会回退到最前窗口。
- 未指定 `window`：取 `z_index` 最前，结果头注明“已取最前窗口”。
- 同 pid 多窗口：`window_id` 精确匹配优先；否则按 on-screen、z_index、标题具体度排序。同标题匹配多个窗口时头部/降噪 stub 都提示改用 `window_id`。
- 目标列表排除插件自己的 `Cua.AgentCursorOverlay*`、Codex overlay 等光标覆盖层；显式指定 overlay 返回专门错误。

### 6.2 模式决策

| 请求模式 | 行为 |
|---|---|
| `ax`（默认） | 树可用 → 文本编号树；树空/降级 → 若当前 route 支持 image → `native`；否则若 GLM key 已配置 → `vision`；否则 `ax` + `visualOnly` |
| `native` | 要求当前 route 声明 image 输入；否则直接失败并提示换模型/用 `vision`。截图经 attachments 落盘；超单图限额或 `nativeImage=compact` 时明确失败，提示改 ax/vision 或 screen_zoom |
| `vision` | 用 `ctx.llm` 调 `visionProvider/visionModel` 观察者；失败回退 GLM；两者都失败返回错误文本，不崩溃 |

`routeImageCapable` 从 `exec.agent.session.requestHeader().config` 取当前 provider/model，再查 `llm.resolveModelInfo` 的 `inputModalities`。没有 `llm`/`attachments` 时 native 不可用。

### 6.3 坐标换算

- 驱动 `get_window_state` 的截图是窗口 `bounds` 的 1:1 物理像素裁剪（实测同尺寸）。
- 原始元素 `frame` 是屏幕物理像素；`mapElementsForModel` 在输出时减去 `screenOrigin`（`bounds.x/y`），得到 window-screenshot-px。
- 快照条目 x/y 存**点击空间**（已减 `screenOrigin`）；原始 frame 只在当次观察内用于密码标记/渲染。模型看到的文本、结构化 elements、快照条目、点击输入四者同空间。
- 输入类元素的当前值进入文本 `值="..."` 与 `elements.value`（密码/文档正文除外）；每次观察附 `自上次观察` 差分（标题/值/状态栏/元素增删），供 unverifiable 动作确认。
- `screen_zoom` 输出 `crop{x,y,w,h}`（请求区域）与 `fromZoom`：正常 zoom 的 `coordinateSpace=zoom-image-px`，图内坐标必须用 `computer_click(x,y,from_zoom=true)` 让驱动换算（驱动会加约 20% padding 并可能缩放）；整窗回退图 `fromZoom=false`，坐标为 window-screenshot-px。`screenOrigin` 只用于再换算到屏幕绝对坐标。
- `from_zoom` 对 click/double/right 与 drag 开放；drag 的起终点都按 zoom 图坐标解释。插件按 pid 记录最近 zoom，要求与当前快照同 pid/window 且 zoom 晚于当前观察，否则返回 `[zoom_missing]/[zoom_stale]`。
- click 家族的 `modifier` 在 Windows 上必须前台 SendInput；插件在 modifier 非空时自动 `forceForeground` 并恢复原前台。drag 的 `modifier` 在 0.39+ 驱动原生可用；0.23.2/`dragEngine:private`/`dwell_ms` 走私有 helper。

### 6.4 降噪与 query

`dedupEvaluate` 的条件：

1. `observeDedup !== 'off'`；
2. 同一 `pid:window_id:mode`；
3. 原始元素指纹相同（`element_index/role/label/value/enabled/selected/actions/is_password/parent/depth/frame`，时间/行列噪声归一化）；
4. 上次观察后没有动作消费快照（`consumedBefore === false`）；
5. 没有 `force`、没有 `query`。

`query` 观察是**只读过滤视图**：不参与降噪、不更新差分/快照，并会 `clearSnapshot()`（query 的 `get_window_state` 已让旧 token 失效）；输出 `snapshotId=null`，header/footer 要求动作前重新全量观察。这样 query 的子集不会削弱保存门禁、菜单栏判断或动作后复核。

命中时返回 `summary`（前 10 个 `index:role` 摘要 + 关键控件 `[编号] 角色 "标签" 值=...`）或 `brief`（单行）；结构化 `elements` 复用上次映射结果，模型不必为“编号在哪”再 force/native。全量与 stub 都带 `自上次观察` 差分和 `changedSinceLast`；`force=true` 走全量并刷新哈希。`dedupReset()` 在每次 `apply()` 调用时清空降噪/差分/权限缓存。

### 6.5 快照是全局单例

`lib/snapshot.js` 只有一个模块级 `snapshot`。任意成功全量观察（ax/vision/native，含其它窗口）都会替换 `snapshot_id`；native/vision 文本会回显当前 id 与“全局单例”，`snapshot_mismatch` 拒绝文本带当前快照的 app/title/pid/window_id。动作回执不携带 snapshot id；观察回执是唯一 id 来源。

## 7. 快照与新鲜度

单会话单窗口模型：`snapshot = { at, pid, windowId, appName, snapshotId, entries, mode, … }`。

| 函数 | 行为 |
|---|---|
| `resolveToken(index, ttl)` | 无快照 → `[snapshot_missing]`；过期 → `[snapshot_expired]`（含快照 id）；编号不存在 → `[index_out_of_range]` |
| `resolveWindow(ttl)` | 同上，返回 `pid/windowId`；坐标模式不再回退 `scope:desktop` |
| `validateSnapshotId(id)` | 传入且与当前快照不一致 → `[snapshot_mismatch]`；未传/无快照不报 |
| `markConsumed(tool)` | 成功投递后记录 `consumedBy` |
| `markSuspect(tool)` | `unverifiable` / `suspected_noop` 后记录 `suspect` |
| `markTokensStale()` | 0.23.2 像素预取替换 index map 后标记 token 失效；坐标动作仍可继续 |
| `freshnessGate(cfg)` | `off` 零注记；`note` 附一致性提示；`enforce` 对已消费快照抛 `[snapshot_consumed]` |

`markConsumed` 与 `markSuspect` 可同时存在。`suspected_noop` 不消费（避免复用旧快照），但标记可疑；回执会提示先观察再重试。输入未确认状态与快照分离，按 `pid:windowId` 保存，TTL 10 分钟，不因观察替换丢失。

## 8. 投递链

```mermaid
stateDiagram-v2
  [*] --> Background: deliveryMode=auto/background
  Background --> Foreground: background_unavailable
  Background --> BringToFront: unverifiable + 指针类 + pid
  Foreground --> BringToFront: foreground_unavailable
  Foreground --> BringToFront: unverifiable + 指针类 + pid
  BringToFront --> Restore: bring_to_front 成功 + 目标动作完成
  Restore --> [*]
  Background --> [*]: 成功
  Foreground --> [*]: 成功
```

| 条件 | 结果 |
|---|---|
| `deliveryMode: foreground` 或单次 `foreground:true` | 直接 L2 |
| L1 命中 `background_unavailable` | L2 重试；回执注明“已前台重试一次” |
| L2 命中 `foreground_unavailable` | L3（`hotkey` 或无 `pid` 除外） |
| L1/L2 返回 `unverifiable` 且工具 ∈ `{click, scroll, drag}` 且有 `pid` | L3 |
| 强制前台（`foreground:true`）的 click/scroll/drag | 不走失败后重试：先 `bring_to_front`，只执行一次，再恢复原前台；避免重复点击/滚动/画形状 |
| `hotkey` 命中前台锁 | 不 L3（XAML 先验拒绝重试同样失败），回执说明；组合键本身自动前台 |
| 无 `pid`（desktop scope） | 不 L3（无锁可绕） |
| L3 的 `bring_to_front` 未返回 `previous_fg_hwnd` | 不回写恢复，回执明确“原前台未恢复，请检查” |

`cuaDeliver` 的 `opts.call` 可注入，测试直接覆盖真实升级链（`tests/delivery-chain.smoke.mjs`），而不是复刻实现。

## 9. 委派

`computer_task` 通过宿主 `ctx.get('subagents')` 启动一次性子 agent（0.2.2 基线）：

| API | 请求 | 结果 |
|---|---|---|
| `startActivation(spec)` | `spec = { provider, label, prompt, parent, signal, delivery:'caller', maxDepth, outputSchema, agentOptions }` | `activation.result` / `activation.dispose()` |

> **运行时优先**：`dsh-subagent` 0.2.2-rc.2 的类型声明把字段写在嵌套 `request` 里，但运行时 `startActivation` 读扁平 `spec.parent/prompt/...`。实现与测试以运行时为准。

- provider 选 `spawn` / `in-process`；
- `outputSchema = {ok, summary, evidence}`，`required: [ok, summary]`；
- `maxDepth: 1`，子 agent 不能再派生；
- 超时 `timeout_min || taskTimeoutMin`（默认 5，clamp 1–60）；
- 每会话 `maxTaskCalls`（默认 3）预算；
- 主上下文回执：`summary` ≤300 字，`evidence` 最多 5 条、每条 ≤200 字。

**工具集限制**：0.2.2 的 `SubagentStartRequest` 没有 `toolFilter`，工具集由 Agent Preset/宿主组合决定；启动成功的回执始终写“子 agent 拥有与父会话同级的能力”。

能力降级阶梯：

| 宿主拒绝 | 重试 | 回执 |
|---|---|---|
| `outputSchema` | 去掉 `outputSchema` 再启动 | “结果未结构化”，附拒绝原因 |
| 全部失败 | 不启动 | `ok:false` + provider 与错误 |

## 10. 安全姿态

`guard()` 的顺序：

1. **无快照拒绝**：`OPERATION_TOOLS`（click/double/right/type/key/scroll/drag/set_value）没有快照 → `[snapshot_missing]`。
2. **白名单**：`allowedApps` 非空时，操作类工具的快照窗口应用必须在名单内。
3. **元素级检测**（仅 `element` 模式）：
   - `entry.is_password === true`（结构位）→ `hard`；
   - `isPasswordCandidate({role,label,value})`：AX 密码角色 / 文本输入角色 × 密码词或掩码值 → `hard`；非输入类命中 → `note`；
   - `hard` 时 `computer_type` / `computer_set_value` 直接拒绝；其它动作放行 + 注记；
   - `extremePatterns` 命中 → 放行 + 警告注记。

`computer_stop` 的锁存在 `wrap()` 最前面，先于 `guard()`；`computer_resume` 是唯一例外。`computer_do` 的外层闸门被跳过（见 §4.3），隐藏工具自己的闸门仍然生效。

## 11. 不变量

1. **依赖单向**：`index.js → lib → cua-driver`，lib 内无环。
2. **闸门顺序恒定**：锁存 → 未知参数 → 守卫 → 重复抑制 → 实现 → 注记；新工具自动继承。
3. **禁止盲发 desktop scope**：`type`/`key`/`scroll`/`drag` 必须绑定快照窗口的 `pid + window_id`。
4. **回执单一出口**：click/double/right/type/key/scroll/drag/set_value 统一走 `settleAction`。
5. **unknown ≠ 成功**：`computer_verify` / `wait_for` 的 `unknown` 永不计为成功。
6. **工具列表稳定**：会话内不注册/注销工具；只注册 `visibleToolsForMode` 的结果。
7. **隐藏工具不裸奔**：dispatcher 路由到的是包装后的 `def.execute`，不是裸实现。
8. **注册必须用 `defineTool()` 返回值**：它把作者面 schema 投影成宿主强制子集；直接传原始字面量会被 `assertSupportedJsonSchema` 拒绝，导致整棵插件树加载失败。
9. **不要订阅 waterfall 事件**：`tools/post-execute` 是 cordis waterfall，监听器不调用 `next()` 会让工具注册表崩溃；仅观测用 `tools/result`。
10. **快照全局单例**：任意成功全量观察替换 id；动作/回执不得假设“每窗口一个快照”。
11. **工具面可机械校验**：描述/参数/输出 schema/render 的变更要过 schema conformance、dispatcher 测试与 `npm run docs:check`。

## 12. 扩展指南

新增一个工具：

1. 在对应组（观察/动作/运营/委派/元工具）的定义数组里加一项；
2. 决定它是否属于 `STABLE_TOOLS` / `HOT_TOOLS`；默认应隐藏在 dispatcher 后；
3. 如果它是操作类工具，加进 `guard.js` 的 `OPERATION_TOOLS`，并确保走 `settleAction`；
4. 在 `tests/schema.conformance.mjs` 加正常/拒绝/未验证等返回形态；
5. 在 `tests/dispatcher.test.mjs` 校正可见/隐藏数量与 catalog；
6. 在 `tests/action-bounds.mjs` 加边界（无快照/窗口绑定/参数校验）；
7. 更新 `docs/TOOLS.md`、`docs/ERRORS.md`（如有新码）、`CHANGELOG.md`；
8. 跑 `npm test`（看退出码）、`npm run check`；有真机时跑 `verify-runtime.mjs`。

改工具描述/参数名时，建议同时生成工具面 JSON 快照做前后 diff（工作区一次性脚本，不入库）；工具面是模型看到的全部接口，漂移即回归。

## 13. 已知缺口

以下问题是**当前实现的真实状态**，不是文档遗漏；修复前不要按“已支持”宣传。历史运行结果见 [EVIDENCE](EVIDENCE.md)。

| # | 位置 | 现象 | 影响 | 方向 |
|---|---|---|---|---|
| A7 | `lib/actions.js` 像素路径 | 驱动 0.23.2 在混合 DPI 下像素点击落点有实测偏差（三种语义假设均有反例） | 像素点击 best-effort；element 路径不受影响 | 等上游修复；文档已降级表述 |
| A8 | `computer_drag` schema/payload | 0.23.2 的 drag `modifier` 不读取；插件改为 **modifier/dwell_ms 走私有 SendInput helper**，无 modifier 仍走 driver；0.39+ 原生可用 | 私有路径不支持 `from_zoom`（明确报错）；`modifier` 是原子手势，不做失败后重试 | WinForms 探针通过；Explorer/Excel/PPT 的 modifier drop 待真机 |
| A10 | native observe | `probe-native-freshness` 在 WinForms 文本变化窗口未复现“AX 已变而 PNG hash 不变”；t11 轨迹里的陈旧感可能是特定应用/去重路径 | 不能把一次轨迹现象当成普适缓存 bug | 保留探针；若后续在 Paint/Office 复现，再按 `force`/去重键定位 |
| A11 | 手势原语 | 无 `selectText`、`key hold`、`mouse_down/up`；drag 无元素源 | PowerPoint 文本选择/格式、Paint 自由笔迹、PPT 形状拖拽仍靠坐标；t17 的单行 PDF 句子已用三击 + Ctrl+C 覆盖 | 评估 selectText/key hold/down-up；drag 支持 from_element |
| A12 | 前台手势 | foreground 动作结束恢复原前台；多步画布/格式操作要反复 activate | t11 用 activate+画布焦点 click 后通过；t15 文件单选用 foreground=true 后不再误开应用 | 保持“显式 activate + 焦点 click + foreground 单选”的题面纪律，暂不新增 keep-foreground 原语 |
| A13 | 组合键前台语义 | background synthetic 不更新 OS 修饰键状态，`Ctrl+V` 只落 `v`；插件对组合键自动前台并恢复原前台 | 普通按键仍可后台；XAML hotkey 失败仍走原指引 | 回归 t12/t15；真机探针 `probe-combo-foreground` |
| A14 | 输入真实性 | 无 Document/TextArea 的聚焦输入保留快照，避免每格 observe；有回读控件仍逐字复核 | Excel/PPT 连续输入不再 snapshot churn | 单测 D-bg/F17-F20/E29-E30；t14/t17 复跑观察 |
| A15 | 观察提示 | 目标 z 序落后时提示 `computer_activate`；坐标行带源图尺寸并警告预览缩放；网格/画布用 `screen_zoom`+`from_zoom` | z 序不是 OS 前台，文案保守；`z_index=null` 不提示 | 单测 C15-C18；t14/t17 复跑 |
| A16 | 强制前台指针 | `foreground:true` 的 click/scroll/drag 改为前置单次（bring_to_front → 动作一次 → 恢复），不再失败后 L3 重试 | 避免同一文件点两遍/同一形状画两遍；代价是每次强制动作多一次前置 | 单测 F14/F14b/F16；t11/t15/t14/t17 回归 |
| A17 | 私有拖拽 | `modifier`/`dwell_ms` 走持久 PowerShell + C# P/Invoke SendInput；PMv2、virtual desk、4px 阈值、16ms 插值、modifier 持有到 drop、finally 释放、恢复前台 | 不支持 `from_zoom`；UIPI 高权限目标会失败；不自动重试 | `probe-private-drag` 通过；Explorer/Excel/PPT drop 待下一轮 |
| G6 | 平台 | macOS 近期未回归；Linux 未验证 | 不要把“能加载”当“已验收” | 见 [COMPATIBILITY](COMPATIBILITY.md) |
| G7 | 部署 | web profile 仍是旧名 v0.5.3；npm 未发布 | 用户看到的可能不是 main | 见 [PUBLISH](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) |

## 14. 测试与证据

- 离线：26 套、634 项检查（2026-11-18；schema 47 场景）。分层、失败模式与新增测试方法见 [TESTING](TESTING.md)；驱动版本兼容层见 [DRIVER-SDK](DRIVER-SDK.md)；完整运行时链路见 [RUNTIME-PIPELINE](RUNTIME-PIPELINE.md)。
- 真机：dsh 0.2.2-rc.1 headless 1 轮 5 步（2 可见/21 隐藏，2026-11-12 当时为 20）；`verify-runtime.mjs` 18/18；`tests/live-action.e2e.mjs` 最近一次 23/23（2026-09-17）。
- 评测：`evals/` 17 条任务（10 条 clean + 7 条 dirty；含 x1 委派通道）+ oracle 双向验证（app/network 依赖任务可 SKIP）。
- 当前矩阵：[VERIFICATION](../VERIFICATION.md)；按日期证据：[EVIDENCE](EVIDENCE.md)；模型行为：[TRAJECTORY-ANALYSIS](TRAJECTORY-ANALYSIS.md)。

## 15. 参考

- [docs/README](README.md) — 唯一文档索引
- [RUNTIME-PIPELINE](RUNTIME-PIPELINE.md) — 宿主到驱动的完整链路
- [TOOLS](TOOLS.md) — 工具契约
- [ERRORS](ERRORS.md) — 错误码
- [WINDOWS](WINDOWS.md) — Windows 工程细节
- [TESTING](TESTING.md) — 测试体系
