# TOOLS — 工具参考

> 目的：23 个工具的完整契约：参数、默认值、前置条件、行为、回执与错误、最小示例。
> 读者：使用者、集成者、维护者。
> 状态：当前实现（最后核对 2026-11-18；由 `npm run docs:check` 校验工具名与数量）。
> 相关：[README](../README.md) · [CONFIGURATION](CONFIGURATION.md) · [ERRORS](ERRORS.md) · [ARCHITECTURE](ARCHITECTURE.md)。

## 1. 工具面

23 个工具 = 22 个桌面能力 + 1 个 dispatcher。

| 模式 | 直接可见 | 隐藏 | 路由 |
|---|---|---:|---|
| `dispatcher`（默认） | `computer_do`、`screen_observe` | 21 | `computer_do({action:"call", tool, args})` |
| `hybrid` | 上面 2 个 + `computer_click`、`computer_type`、`computer_key`、`computer_scroll`、`computer_verify` | 16 | 热工具直接调用；长尾经 dispatcher |

- `screen_zoom` 与 `computer_activate` 在**两种模式下都隐藏**；`dispatcher` 下连 `computer_click` 也隐藏。
- 工具列表在 `apply()` 时一次性注册，会话内不变；这是 prompt cache 的设计约束。
- 隐藏工具不是“裸实现”：`computer_do` 调用的是 `defineTool()` 包装后的 `def.execute`，仍走锁存、未知参数、`guard`、快照、回执。

## 2. dispatcher 协议

### 2.1 `catalog`

```json
{ "action": "catalog", "query": "click" }
```

- 列出**隐藏工具**的紧凑签名 `name(required,optional?)`；`query` 按名称/描述子串过滤（空白分词，任一命中）。
- 最多 24 条（当前隐藏 21 个，24 是余量，不是 UI 限制）。
- 返回 `tools` 为工具名数组；`result` 文本带签名与“直接可见”列表。

### 2.2 `call`

```json
{ "action": "call", "tool": "computer_click", "args": { "element": 12 } }
```

- `tool` 必须是当前模式的隐藏工具；不能是 `computer_do`（禁止递归），不能是已直接可见的工具（提示直接调用）。
- 未知工具返回可用隐藏工具清单；没有实现返回明确错误。
- `args` 必须是普通对象；**非对象会被静默当成 `{}`**（数组也是）。参数名写错不会静默丢弃：内层 `wrap()` 会拒绝未知参数。
- 内层结果以 `[<tool>] <result>` 返回；`ok` 严格取内层 `ok === true`。
- 图片（`screen_zoom`/`native`）与结构化 `data`（crop/apps/results/structured 等）会透传。
- 内层工具自己仍执行锁存、`guard`、快照 TTL、重复抑制与 `settleAction`。

### 2.3 `status`

```json
{ "action": "status" }
```

返回当前模式、直接可见工具、隐藏数量与驱动状态行；`tools` 为隐藏工具名数组。

### 2.4 缺省行为

- `action` 缺省时按 `catalog` 处理（schema 仍要求显式传 `action`）。
- `computer_do` 自身在 `stop` 锁存期间仍可进入，否则 `computer_resume` 无法经 dispatcher 解锁；隐藏工具自己的闸门仍会拒绝。

## 3. 观察

### 3.1 `screen_observe`

观察目标窗口，返回编号元素、坐标、快照 id、坐标空间说明；同一未变窗口的重复观察可降噪。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `window` | string | 否 | — | 目标窗口：pid 或标题子串；纯数字按 pid 解释，**不要用 `window` 传 window_id** |
| `window_id` | integer | 否 | — | 精确窗口 id；同 pid 多窗口时优先用它 |
| `mode` | string | 否 | `ax` | `ax` / `vision` / `native` |
| `query` | string | 否 | — | 只读过滤视图：只显示匹配元素；**不建立动作快照，并清除旧动作快照** |
| `maxElements` | integer | 否 | 配置 `120` | 最多返回的编号元素数 |
| `force` | boolean | 否 | `false` | 跳过降噪，强制全量；**不取消 query** |

行为：

- **目标选择**：`window_id` 精确匹配；`window` 依次按 pid、标题子串、应用名/中英别名匹配。指定目标未找到时 fail-closed，返回最多 8 个候选，不回退到最前窗口；不会建立新快照（已有新鲜旧快照会保留并提示）。
- **快照全局单例**：任意成功全量观察（ax/native/vision，含其它窗口）都会替换 `snapshot_id`；旧 id 在动作中会得到 `[snapshot_mismatch]`。
- **模式**：`ax` 零视觉 token；`native` 要求当前 route 声明 image 输入，截图经宿主 attachments 落盘；`vision` 走配置的观察者，失败回退 GLM。树空/降级时按 native → vision → ax 自动降级；窗口级失败降级为 `desktop-visual`（桌面坐标，不能直接用于窗口动作）。
- **原生对话框后端（Windows，`nativeDialogs:auto`）**：UIA 树为空且目标是同 pid 的标准 `#32770` 模态对话框时，用 Win32 子控件枚举返回 `mode:native-dialog` 的按钮（含控件 ID/标签/enabled）；只读按钮，不读 Edit/密码。按钮用 `computer_click(element=编号)` 走 `BM_CLICK`（异步/未验证），只支持单次左键；不支持 modifier/count>1/from_zoom；不自动选择 Yes/No。`nativeDialogs:off` 禁用（零 PowerShell spawn）。
- **query**：驱动返回过滤树后跳过差分/缓存/降噪，并 `clearSnapshot()`；输出 `snapshotId:null`，回执明确“旧动作快照已清除”。需要动作时不要带 query 重新观察。
- **降噪**：同窗口、同模式、界面哈希未变、上次观察后无动作消费、无 `force`/`query` 时，返回 `summary`/`brief` 极简回执；结构化 `elements` 复用上次映射，编号仍有效。
- **状态差分**：回执带 `自上次观察：...`（标题/输入值/状态栏/元素增删）；时间/行列噪声归一。这是 `unverifiable` 动作的主要状态证据。
- **密码**：Windows 结构位扫描（`passwordScan: auto`）标记 `is_password`；文本不显示密码值，Document/AXTextArea 不展示正文。

输出：`ok`、`result`、`snapshotId`、`changedSinceLast`、`changes`、`window`/`elementCount`/`mode`/`elements` 等；`native` 还带 `image`。完整字段见 [ARCHITECTURE](ARCHITECTURE.md) §6。

### 3.2 `screen_zoom`

区域截图直读；用于放大细看或给 `from_zoom` 提供坐标。

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `window_id` | integer | **是** | — | 目标窗口 id |
| `pid` | integer | 否 | 由 window_id 解析 | 目标进程 pid |
| `x1` / `y1` | integer | 否 | `0` | 区域左上角（窗口截图像素） |
| `x2` / `y2` | integer | 否 | 窗口截图宽/高 | 区域右下角；`x2-x1` 必须 ≤ 500 |

- 驱动会对裁剪加约 20% padding 并可能缩放；**不要手算 `crop.scale`**。
- 返回 `crop`（请求区域）、`fromZoom`、`coordinateSpace=zoom-image-px`、`image`。
- 图内坐标必须用 `computer_click/drag(..., from_zoom=true)`；插件要求 zoom 晚于当前观察、同 pid/window，否则 `[zoom_missing]`/`[zoom_stale]`。
- 需要当前模型支持 image 输入；读文字优先 `screen_observe(mode:"native")`（无损 PNG），zoom 是有损 JPEG。
- 请求区域宽 >500px 在插件侧直接失败，不调用驱动。

## 4. 动作

### 4.1 点击家族：`computer_click` / `computer_double_click` / `computer_right_click`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `element` | integer | 否 | — | 观察编号；与 `x/y` 二选一，优先 |
| `x` / `y` | integer | 否 | — | 窗口截图坐标；必须成对 |
| `snapshot_id` | string | 否 | — | 证据基线；与当前快照不一致则 `[snapshot_mismatch]` |
| `foreground` | boolean | 否 | `false` | 强制前台投递；更慢，且会短暂切换焦点 |
| `from_zoom` | boolean | 否 | `false` | 坐标来自 `screen_zoom` 图；与 `element` 互斥 |
| `modifier` | string[] | 否 | — | `ctrl`/`shift`/`alt`/`win`；Ctrl+click 多选等 |
| `count` | integer | 否 | `1` | 仅 `computer_click`；1–3 |

行为：

- `element` 走 `element_token`，支持后台/隐藏窗口，不受 DPI 混合影响；像素路径 best-effort。
- `native-dialog` 快照的按钮是 **Win32 原生控件**：只支持 `computer_click(element=编号)` 单次左键（`BM_CLICK`，异步/未验证）；坐标点击、type/key/scroll/drag、double/right、modifier/count>1/from_zoom 一律拒绝。点击后先 `screen_observe` 确认对话框是否关闭；不要重复点击或自动选择 Yes/No。
- **实验性后台输入（默认 off）**：目标没有任何可交互 UIA 元素时，`backgroundInput:auto` 可走 B0 `WM_*`/`BM_CLICK`（支持左/右/双击）；`syntheticPointer:auto` 可走 B1 合成触控左单击；`anchoredInput:cursor/window` 可走 B2/B3 左单击。失败/未验证不自动前台；B1 遮挡失败关闭；B1/B2/B3 需要 `allowedApps`。详见 [BACKGROUND-INPUT](BACKGROUND-INPUT.md)。
- 坐标点击按快照条目中心 24px 内取最近元素，回执回显目标（编号/角色/标签/当前值；密码值隐藏）。
- 非空 `modifier` 在 Windows 上自动 `forceForeground`（SendInput 前台注入）并恢复原前台。
- **Explorer 文件项单选请用 `foreground=true`**：后台坐标点击可能走 UIA Invoke 直接打开文件。
- `double_click` 不参与重复点击抑制；`click`/`right_click` 参与。
- 回执：`ok:false` 表示拒绝/未送达；`ok:true` 仍可能 `effect:unverifiable`，需 observe/verify 复核。
- 驱动调用超时（默认 30s）时回执是“点击结果未知”：本次点击可能已触发模态对话框。先等待 5–10s，再 `screen_observe`（capture/ax）确认是否“延迟成功”，用新顶层 `window_id` 重新观察；不要连续重试像素/zoom/drag、换键或 activate（模态期间 UIA 树可能持续 0 元素）。Escape 在 Yes/No 上通常无效；必要时按对话框加速键只发一次。根因见 [EVIDENCE §1.4](EVIDENCE.md#14-2026-11-20--t20-模态-30s-超时根因探针)。

### 4.2 `computer_type`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `text` | string | **是** | — | 要输入的文本 |
| `element` | integer | 否 | — | 指定元素时走 UIA `ValuePattern`（XAML/WinUI 主机必需） |
| `snapshot_id` | string | 否 | — | 证据基线 |
| `foreground` | boolean | 否 | `false` | 前台全局输入；WinUI 可能丢字/错字 |

- 不指定 `element` 时输入到**快照窗口当前焦点**，不是当前前台窗口。
- **预填字段（如“另存为”文件名）优先 `computer_set_value` 覆盖**；`computer_type` 是追加输入，可能把新文本接在旧值后面。`ctrl+a` 在 WinUI 对话框/无菜单栏窗口可能不可用。
- **不要在密码框使用**；`computer_type` 命中密码框会被硬拒。
- 失败/未验证时对 Document/TextArea/Edit 做逐字回读（只报一致/不一致/无法回读与长度，不打印正文）；不一致或无法回读会设置 `inputUnconfirmed`，保存意图被拦。
- 没有可回读控件的聚焦输入（Excel 网格、PPT 画布）不会刷新/清空快照，避免连续 Tab/Enter 得到 `[snapshot_missing]`。
- 不支持 `from_zoom`；先用 `computer_click(..., from_zoom=true)` 点输入框，再 type。
- **实验性 `backgroundInput:auto`**：无交互 UIA 的目标可走 B0 `WM_CHAR`（同步 `SendMessageTimeout`）；支持简单文本，不支持 IME/代理对合并/组合键；`ES_PASSWORD` 仍拒绝。

### 4.3 `computer_set_value`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `element` | integer | **是** | — | 最新观察编号 |
| `value` | string | **是** | — | 新值 |
| `snapshot_id` | string | 否 | — | 证据基线 |

只走 UIA `ValuePattern`；**预填字段优先用它覆盖**，回读按完全相等校验，不是追加。Web/自绘控件可能忽略；失败时改用 `computer_type` 或点击后输入。密码框硬拒。

### 4.4 `computer_key`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `key` | string | **是** | — | `return` / `tab` / `escape` / `ctrl+c` / `shift+tab` 等 |
| `snapshot_id` | string | 否 | — | 证据基线 |
| `foreground` | boolean | 否 | `false` | 前台投递 |

- 普通按键默认后台 PostMessage；带修饰键的组合键**一律自动前台注入并恢复原前台**（后台 synthetic 不更新 OS 修饰键状态，`Ctrl+V` 可能只落 `v`）。实验性 `backgroundInput:auto` 下，无交互 UIA 目标的普通键可走 B0 `WM_KEYDOWN/UP`；组合键仍一律前台。
- 绑定快照窗口；不要传 `pid`/`window_id`。
- XAML/WinUI 组合键可能因 UIA 加速器超时或 `could not find a UIA AcceleratorKey` 失败；回执给“点菜单栏项 → 点菜单项”的指引。`xamlKeyFallback: auto` 可实验性自动完成，默认 `off`。
- `ctrl+a` 在 WinUI 对话框/无菜单栏窗口可能不可用；替换预填字段优先 `computer_set_value`，而不是 `ctrl+a` 后 `type`。

### 4.5 `computer_scroll`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `direction` | string | 否 | `down` | `up`/`down`/`left`/`right` |
| `amount` | integer | 否 | `3` | 滚动格数 |
| `element` | integer | 否 | — | 在元素上滚动 |
| `snapshot_id` | string | 否 | — | 证据基线 |
| `foreground` | boolean | 否 | `false` | 前台投递 |

### 4.6 `computer_drag`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `from_x` / `from_y` | integer | **是** | — | 起点；`from_zoom=true` 时为 zoom 图坐标 |
| `to_x` / `to_y` | integer | **是** | — | 终点 |
| `duration_ms` | integer | 否 | `500` | 0–10000 |
| `steps` | integer | 否 | `20` | 1–200；越大越平滑 |
| `button` | string | 否 | `left` | `left`/`right`/`middle` |
| `dwell_ms` | integer | 否 | `0` | 0–2000；Explorer 弹簧文件夹可用 500–1000 |
| `modifier` | string[] | 否 | — | `ctrl`/`shift`/`alt`/`win` |
| `from_zoom` | boolean | 否 | `false` | 起终点都按 zoom 图坐标 |
| `snapshot_id` | string | 否 | — | 证据基线 |
| `foreground` | boolean | 否 | `false` | 前台投递 |

- 无 `modifier`、无 `dwell_ms`：走驱动 drag（保留 driver 的 zoom/后台路径）。
- `modifier` 非空或 `dwell_ms > 0`：走私有 SendInput helper（`tools/private-drag.ps1`）；原子手势、修饰键持有到 drop、失败路径释放、恢复原前台。
- 私有路径**不支持 `from_zoom`**（`[private_drag_zoom_unsupported]`），且需要快照的 `screenOrigin`/截图尺寸（缺失报 `[private_drag_no_frame]`）。
- `duration_ms=0` 是合法值，不会被 truthiness 丢弃；`steps`/`dwell_ms` 越界会被拒绝。
- 拖拽非幂等：不自动重试；只有前台校验失败（未发送输入）才可 activate 后重试一次。
- **从标题栏拖动会移动窗口**（改变 `window origin`），不是点击/落点证明；回执会提示，且快照会被清空要求重新观察。需要点击效果时不要用 drag 代替 click。

### 4.7 `computer_wait`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `ms` | integer | **是** | — | 1–60000；本地等待，不调用引擎 |

### 4.8 `app_list`

无参数。返回运行中应用的 `name`/`pid`/`active`（显示上限 20 条）。不需要快照。

### 4.9 `app_launch`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `name` | string | 否 | — | 应用显示名；与 `bundle_id` 二选一 |
| `bundle_id` | string | 否 | — | bundle id；优先于 `name` |
| `bring_to_front` | boolean | 否 | `false` | 启动后前置 |
| `creates_new_instance` | boolean | 否 | `false` | Windows 驱动当前为 no-op |

- 驱动以管理员运行，启动的应用继承 High IL；非提权客户端可能关不掉（UIPI）。任务结束提示用户手动关闭；**不要按进程名杀**。
- 启动成功即 `ok:true`；前置失败只写“启动成功，但前置未确认”，并返回 `window_id`。
- 输出 `pid`/`window_id`（没有可见主窗时为 null）。

### 4.10 `computer_activate`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `window_id` | integer | **是** | — | `screen_observe`/`app_list` 输出 |
| `pid` | integer | 否 | 由 window_id 解析 | 窗口所属 pid |

把已存在窗口前置（driver `bring_to_front`）；不启动/关闭应用，也不恢复原前台。不要求快照；激活后操作内容仍需 `screen_observe`。脏桌面多窗口切换优先用它，而不是任务栏/Alt+Tab。

## 5. 运营

### 5.1 `computer_verify`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `window_id` | integer | **是** | — | 目标窗口 |
| `expect` | string | **是** | — | 1–8 条谓词 JSON（AND） |
| `pid` | integer | 否 | 解析 | 目标 pid |
| `include_screenshot` | boolean | 否 | `false` | 附最终截图作为证据，不参与判定 |

`expect` 示例：

```json
[
  { "element": { "selector": { "role": "按钮", "label_contains": "确定" }, "exists": true } },
  { "window": { "exists": true, "bounds": { "x": 0, "y": 0, "width": 100, "height": 50, "tolerance_px": 10 } } }
]
```

- `unknown` 永不算成功（fail-closed）；`exists` 仅接受 true，缺失返回 unknown。
- 输出 `status`、`stable`、`results`、`satisfied` 等；用于代替截图猜状态。

### 5.2 `computer_wait_for`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `window_id` | integer | **是** | — | 目标窗口 |
| `expect` | string | **是** | — | 同 `computer_verify` |
| `pid` | integer | 否 | 解析 | 目标 pid |
| `timeoutMs` | integer | 否 | `10000` | 总超时，1–60s |
| `pollMs` | integer | 否 | `1000` | 轮询下限，最小 250ms |

全部谓词满足即返回（含 `attempts`/`waitedMs`）；超时返回最后一次状态，`ok:false`，不伪装成功。每次验证本身是秒级 UIA 走查。

### 5.3 `computer_clipboard`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `action` | string | **是** | — | `read` / `write` |
| `text` | string | 否 | — | `write` 必填 |

- `write` + `computer_key("ctrl+v")` 是长文本/特殊字符最可靠的粘贴流。
- `read` 返回系统剪贴板真实文本，带隐私注记；不要转述。

### 5.4 `computer_menu`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `window_id` | integer | **是** | — | 目标窗口 |
| `path` | string \| string[] | **是** | — | 逐级菜单路径，如 `["文件","另存为"]` 或 `"文件/保存"`、`"文件->保存"`、`"文件→保存"` |
| `pid` | integer | 否 | 解析 | 目标 pid |

- 只对已打开/可实时解析的菜单有效；关闭的菜单先点菜单栏项，再观察弹出菜单。
- fail-closed：缺失/歧义/禁用/结构不匹配即失败，绝不回退像素。
- 只有 `effect:"confirmed"` 才算成功；`effect:unverifiable`/缺失都报“未确认”，不要重复调用。
- `nativeMenus:auto`（默认 off）：驱动结构化拒绝后，对顶层窗口经典 Win32 HMENU 精确解析路径并 `PostMessage(WM_COMMAND)`；回执 `route=win32-hmenu`、`effect:unverifiable`，只证明投递。
- 只支持标准 HMENU 叶子命令；WinForms `MenuStrip`/WPF/WinUI 返回 `no_hmenu`，不要改用坐标点击。同层同名/禁用/分隔符/owner-draw/最终项含子菜单都拒绝。
- 原生超时表示 `WM_COMMAND` 可能已发送；不要重复同一路径，先 `screen_observe`。

### 5.5 `computer_hover`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `x` / `y` | integer | **是** | — | 默认窗口截图坐标；`real=true` 时是屏幕坐标 |
| `pid` | integer | 否 | — | 默认覆盖层模式需要 |
| `window_id` | integer | 否 | — | 默认覆盖层模式需要 |
| `real` | boolean | 否 | `false` | `true` 移动真实 OS 指针 |

实验性：默认只移动虚拟覆盖层；WinForms 按钮 MouseEnter 已在 probe-ops 窄验证，工具提示/悬停菜单是否触发仍取决于应用。

### 5.6 `computer_stop`

无参数。结束驱动会话并锁存全部桌面操作（含观察/动作/应用）；清空快照。dispatcher 自身仍可进入，以便 `computer_resume` 解锁；隐藏工具自己的闸门仍拒绝。

### 5.7 `computer_resume`

无参数。唯一解锁路径；预热会话。解锁后快照为空，必须先 `screen_observe` 再操作。驱动失败时保持锁存并返回 `ok:false`。

## 6. 委派与入口

### 6.1 `computer_task`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `goal` | string | **是** | — | 操作目标（含路径/名称等要素） |
| `success_criteria` | string | 否 | — | 完成判据 |
| `constraints` | string | 否 | — | 附加约束 |
| `timeout_min` | integer | 否 | 配置 `5` | 1–60；到点取消 |
| `model` | string | 否 | 继承当前 | 子 agent 模型 |
| `model_effort` | string | 否 | 继承当前 | 推理档 |

- 把多步/高噪声操作交给一次性子 agent；主上下文只收 `ok/summary/evidence`（summary ≤300 字，evidence ≤5 条）。
- 每会话预算 `maxTaskCalls`（默认 3）；`0` 仍回退 3。
- **不是沙箱**：dsh 0.2.2 的 `startActivation` 没有 `toolFilter`，子 agent 可能拥有与父会话同级能力；回执会写明。
- 宿主未提供子 agent 能力时返回委派配方，不执行操作。
- 输出 `structured`（`{ok, summary, evidence}`）或 null；拿到结果后建议 `computer_verify`/`screen_observe` 复核。

### 6.2 `computer_do`

| 参数 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| `action` | string | **是** | — | `call`/`catalog`/`status` |
| `tool` | string | 否 | — | `call` 的隐藏工具名 |
| `args` | object | 否 | — | `call` 的参数对象 |
| `query` | string | 否 | — | `catalog` 关键词 |

见 §2。输出 `tool`/`surface`/`tools`/`scope`/`data`，`screen_zoom`/native 还可能带 `image`。

## 7. 选择指南

| 场景 | 首选 | 备选/说明 |
|---|---|---|
| 原生应用、AX 树完整 | `element` 点击/输入 | 坐标点击只作兜底 |
| Canvas/游戏/Electron 树空 | `screen_observe(mode:"native")` + 坐标/zoom | `vision` 用于主模型不支持图片时 |
| 小字/图标定位 | `screen_zoom` + `from_zoom=true` | 不要让目标只占画面一小角；读文字用 native |
| 多窗口同 pid | `window_id` | `window` 只接受 pid/标题子串 |
| 长文本/特殊字符 | `computer_clipboard(write)` + `computer_key("ctrl+v")` | 组合键自动前台 |
| 需要等待状态 | `computer_wait_for` | 不要盲等 `computer_wait` |
| 需要确定性断言 | `computer_verify` | `unknown` 不算成功 |
| 脏桌面多窗口切换 | `computer_activate` | 不要点任务栏/反复 Alt+Tab |
| 多步高噪声任务 | `computer_task` | 结果仍需主 agent 复核 |

## 8. 常见反模式

1. 用 `window` 传数字 window_id（应使用 `window_id`）。
2. 先 `ax` 再 `native`，然后沿用旧 `snapshot_id`；快照是全局单例，后一次观察已替换。
3. `query` 后直接动作；query 只读且会清除旧快照。
4. 按模型预览尺寸估坐标；`@(x,y)` 是原图像素，预览可能缩放。
5. 对 Explorer 文件项后台单击；会打开文件，单选用 `foreground=true`。
6. 无条件加 `foreground=true`；更慢且移动指针，只在需要真实焦点时用。
7. 对 `unverifiable` 结果立即重放非幂等动作（点击/拖拽/保存）；先 observe/verify。
8. 在密码框用 `computer_type`/`computer_set_value`；会被硬拒。坐标输入无法预知密码框，保护不生效。
9. 把 `computer_task` 当沙箱；它不限制子 agent 工具集。
10. 改工具参数名后不跑 schema conformance；宿主会严格校验输出，参数错会被拒绝。

## 9. 输出与结构化字段

所有工具都返回 `ok` + `result`。`computer_do` 还会把内层结构化字段挑到 `data`：

| 字段 | 来源 |
|---|---|
| `crop`/`fromZoom`/`screenOrigin`/`coordinateSpace` | `screen_zoom` |
| `status`/`stable`/`results` | `computer_verify` / `wait_for` |
| `apps` | `app_list` |
| `structured` | `computer_task` |
| `text` | `computer_clipboard` |
| `pid`/`window_id` | `app_launch` / `computer_activate` |

`screen_observe` 的 `elements[].x/y` 与文本 `@(x,y)` 必须同空间（window-screenshot-px）；不一致属于 bug。

## 10. PTC / `run_code`

- PTC 的 SDK 只绑定**直接可见**的工具；`dispatcher` 下只有 `computer_do` 与 `screen_observe`。
- 隐藏工具不会出现在 SDK 里，必须 `tools.computer_do({action:"call", tool, args})`；`tools.computer_task` 为 `undefined` 是预期行为。
- `native` 图片作为 deferred context 交给主模型；`computer_do` 会透传 `image`。
