# DRIVER-SDK — cua-driver 兼容层与内部规范

> 目的：让插件在用户安装的**不同 cua-driver 版本**上保持同一套内部语义。
> 读者：维护者、驱动适配者、排障者。
> 状态：当前实现（最后核对 2026-11-22；实测 0.23.2 → 0.52.13；0.53.0 按发布说明预留，未真机验证）。
> 相关：[COMPATIBILITY](COMPATIBILITY.md) · [WINDOWS](WINDOWS.md) · [ERRORS](ERRORS.md) · [RUNTIME-PIPELINE](RUNTIME-PIPELINE.md)。

## 1. 分层

```text
index.js / actions / observe / human / ops / keyFallback
        │  只调用 cuaCall / cuaDeliver（不变）
        ▼
lib/cua.js  facade：CUA_BIN / CUA_SESSION / withSession / cuaCall / cuaDeliver
        │            / isBackgroundUnavailable / isForegroundUnavailable
        │            / isUnverified / deliveryFailure / normalizeMcp
        ▼
lib/driver/transport.js     唯一 spawn；超时/退出码/JSON/contract 分类
lib/driver/capabilities.js  版本、能力标志、请求映射、自适应学习
lib/driver/normalize.js     响应 → 内部规范形态（保留未知字段）
lib/driver/info.js          进程级 driverInfo 缓存与 status 文本
```

原则：

1. **唯一物理入口**：只有 `lib/driver/transport.js` spawn `cua-driver`。新增驱动工具必须走 `cuaCall`，不要绕过兼容层。
2. **请求归一化**：只加版本相关字段（`tree_format`、`session`），不改调用方参数。
3. **响应归一化**：同时接受新旧形态，输出沿用 0.23.2 的字段名，消费者零改动。
4. **不伪造成功**：负向词汇只做分类；未知字段保留，未知回执不升级成 `confirmed`。

## 2. 内部规范形态

### 2.1 `get_window_state`

```js
{
  window: { title, bounds: { x, y, width, height }, app_name, pid, window_id },
  elements: [{
    element_index, element_token, role, label, name, value,
    frame: { x, y, w, h },              // 屏幕物理像素
    screenshot_frame: { x, y, w, h },   // 截图空间（有则保留/换算）
    is_password, enabled, selected, actions, parent_index, depth
  }],
  element_count, total_element_count, snapshot_id,
  screenshot_png_b64, screenshot_width, screenshot_height,
  screenshot_mime_type, screenshot_out_file,
  capture_id, truncated, elements_complete, degraded_reason, frame_space
}
```

- 0.23.2：无 `window`/`window_bounds`；元素只有 `frame`（屏幕像素）。
- 0.52.13：顶层 `window_bounds`/`window_title`/`app_name`；元素仍是 `frame`，没有 `screenshot_frame`；像素动作要求截图上下文。
- 0.53：预期新增 `screenshot_frame`；归一化用 `frame - screenshot_frame` 的中位差值校准坐标空间（`screen` / `screenshot`），再统一成屏幕坐标。

`frame_space` 为 `screenshot-unmapped` 时表示只有截图坐标、缺少窗口 bounds：`screen_observe` 会明确警告不要用元素 `@(x,y)` 做像素点击，改用 `screen_zoom + from_zoom=true`。

### 2.2 `list_windows`

统一为 `{ windows: [...], _legacy_windows? }`；每项含 `window_id/pid/title/app_name/bounds{x,y,width,height}/z_index/is_on_screen/minimized`。接受裸数组、`bounds` 的 `w/h`、`is_minimized`、`app`。

### 2.3 `zoom`

统一 `{ screenshot_png_b64, width, height, mime_type }`；接受 `mime_type|screenshot_mime_type|mime|format`。`screen_zoom` 用归一后的 MIME，不再写死 JPEG。

### 2.4 回执

动作工具统一 `normalizeReceipt`：

- `delivery` 字符串 → `{ mode }`；
- `verified:false` 且无 `effect` → `effect:'unverifiable'`；
- 保留 `previous_fg_hwnd`/`route`/`foreground_restored` 等未知字段。

`engineRefusal` 识别的负向词汇：

| 形态 | 例子 |
|---|---|
| `effect` | `refused` / `rejected` / `suspected_noop` / `failed` / `error` / `denied` |
| `status` | `refused` / `failed` / `denied` / `error` |
| `refusal` | `{ code, message }` |
| 布尔/错误码 | `ok:false`、`success:false`、`supported:false`、`error_code` |
| 投递信号 | `background_unavailable`、`foreground_unavailable`、`delivery_failed` |

## 3. 能力标志与检测

| 标志 | 含义 | 0.23.2 | 0.52.13 | 0.53 | 消费点 |
|---|---|---|---|---|---|
| `treeFormat` | 接受 `tree_format:"elements"` | ✅ | ✅（默认 markdown，必须显式） | ✅ | `mapRequest` |
| `flatWindow` | 顶层 `window_bounds/window_title` | ❌ | ✅ | ✅ | 元数据，运行时未消费 |
| `screenshotFrame` | 元素带 `screenshot_frame` | ❌ | ❌ | 预期 | 元数据，运行时未消费 |
| `dragModifier` | 原生 drag modifier | ❌ | ✅ | ✅ | drag 引擎选择 |
| `pointerCapture` | 像素动作需要截图上下文 | ❌ | ✅ | ✅ | 像素动作预检 |
| `captureOnly` | `get_window_state(include_accessibility_tree:false)` 只截图、不替换 token | ❌ | ✅ | ✅ | capture 读形态 |
| `moveCursorScreen` | `move_cursor` window scope 用屏幕坐标 | ❌ | ✅ | ✅ | hover/滑行坐标 |
| `frameSpace` | `screen` / `screenshot` / `null` | `screen` | `screen` | 首次响应校准 | `normalizeElement` |
| `zoomMime` | zoom 返回 MIME 归一 | ✅ | ✅ | ✅ | 元数据，运行时未消费 |

检测顺序：

1. 配置 `driverProfile: auto|legacy|latest`（显式覆盖）；
2. 环境 `CUA_DRIVER_VERSION` / `CUA_DRIVER_PROFILE`（测试/排障）；
3. `cua-driver --version` 解析 semver；
4. `status` 解析 contract（0.23.2 不输出 contract，忽略即可）；
5. 首次响应学习：`window_bounds`、`screenshot_frame`、frame 差值；
6. 首次错误学习：`invalid_arguments` 点名 `tree_format` → 关闭并重试一次。

未知版本退 `unknown`：请求仍带 `tree_format`/`session`，依赖响应/错误自适应；drag 默认走私有 helper（已知可靠）。

`driverProfile` 显式覆盖：`legacy` 清空现代标志；`latest` 启用全部；`auto` 按版本推断并学习。显式档位优先于环境变量。

### 3.1 contract 不做白名单

兼容层**不按 contract 版本拒绝调用**：它解析 `contract version A does not match SDK B` 和通用 `contract: X` / `SDK: Y`，在不一致时给出警告并要求 CLI 与 daemon 一起升级。文档里的 `0.7.0`/`0.8.0` 是真实不匹配示例，不是支持矩阵。任何版本对都会被接受；是否可用由真实请求/响应决定。

## 4. 真机实测差异（0.52.13，2026-11-18）

| 现象 | 证据 | 兼容层处理 |
|---|---|---|
| `get_window_state` 默认 `tree_format:"markdown"`，不带 `elements` | 首次调用 keys 有 `element_count=7`、`tree_markdown`，无 `elements`；显式 `tree_format:"elements"` 返回 7 个元素 | `mapRequest` 总是带 `tree_format:"elements"` |
| element_token / zoom 快照按 **session** 归属 | 观察不带 session、点击带 session → `stale_element_token` / `current_snapshots:[]` | `mapRequest` 给 `get_window_state` 注入 `CUA_SESSION` |
| 像素 click/drag/scroll 需要截图上下文 | 无截图时 `screenshot_context_missing / no_screenshot`；先 `get_window_state(include_screenshot:true)` 后成功 | 0.52+ 用 `include_accessibility_tree:false` 的 **capture-only** 读建上下文；它保留 snapshot/rows/tokens，不再 `markTokensStale`。0.23.2 退回 `max_elements:1`（会替换 index map，旧 token 标失效）。**native 观察的截图只用于模型展示，不算 click capture**：`pointerCaptureReady` 只由显式 capture-only/旧预取/zoom 置 true |
| 裸 `code` 拒绝 | `{"code":"screenshot_context_missing","reason":"no_screenshot"}` | `engineRefusal` 的 `FAILURE_CODES` 按拒绝上报；否则会被写成“点击完成” |
| `zoom` 需要截图上下文 | 同上；`screen_zoom` 在无 capture 时补读 | 0.52+ 用 capture-only；0.23.2 用 `max_elements:1` + `markTokensStale` |
| 结构化拒绝以非零退出返回 | `background_unavailable` JSON + exit 1 | `transport` 解析为 `DriverError.value`；动作类当回执值参与升级 |
| 前台点击校验目标 HWND | `foreground_unavailable: ... not foreground after the click` | 既有 `bring_to_front` 前置/绕锁链 |
| `move_cursor` window scope 改为屏幕坐标 | 0.52 schema 文档；旧插件传窗口本地会偏移 | `glideCursor`/`hover` 用快照原点换算，并去掉 0.52 不接受的 `origin` 字段 |
| `hotkey` 回执 `foreground_restored:false` | combo probe | 组合键注记动态说明“原前台未恢复”，不再声称已恢复 |

> **capture-only 实测（0.52.13）**：先 `tree_format:"elements"` 得到 `snapshot_id=s00000206`；再 `include_accessibility_tree:false, include_screenshot:true` 返回**同一个 snapshot_id**、`capture_id` 和 36KB 截图；旧 `element_token` 的 background click 成功，坐标 click 与 `zoom` 也成功。因此 0.52+ 的像素预取不再需要 `markTokensStale`；0.23.2 没有该参数，保留旧路径。真机 t17 从 post-fix 86 步降到 **29 步**。

## 5. 错误分类

`DriverCallError.kind`：

| kind | 含义 | 上层动作 |
|---|---|---|
| `spawn` | 找不到/无法启动 | 结构化错误 + `CUA_DRIVER_BIN` 指引 |
| `timeout` | 超过 `CUA_CALL_TIMEOUT_MS` | 结构化超时；不重试 |
| `exit` | 非零退出且非 JSON | 原样报错 |
| `structured` | 非零退出 + JSON 拒绝 | 动作类当回执值；观察类抛错走降级 |
| `nonjson` | 退出 0 但 stdout 非 JSON | 原样报错 |
| `contract_mismatch` | CLI/daemon contract 不一致 | 明确要求一起升级并重启 daemon |
| `session_ended` | session 被回收 | `start_session` 自愈一次 |

## 6. 新增一个驱动工具

1. 在 `lib/driver/normalize.js` 增加响应归一化（若返回结构化数据）；
2. 若请求需要版本字段，在 `capabilities.mapRequest` 加；
3. 在 `lib/cua.js` 的 `STRUCTURED_VALUE_TOOLS` 决定非零退出 JSON 是“回执值”还是“异常”；
4. 在 `lib/driver/capabilities.js` 的能力表加标志（如有版本差异）；
5. 在 `tests/driver.normalize.mjs` / `driver.transport.mjs` 加 fixture；
6. 在本文的差异表补一行；更新 `PERMISSIONS.md`（若新增 spawn/参数）与 `docs/ERRORS.md`（若新增码）；
7. 跑 `npm run docs:check`，确保工具/错误码/链接没有漂移。

## 7. 测试与真机顺序

| 套件/探针 | 作用 |
|---|---|
| `tests/driver.normalize.mjs` | 0.23.2 与 0.53 fixtures 归一化一致 |
| `tests/driver.capabilities.mjs` | 版本/能力/请求映射/自适应学习 |
| `tests/driver.transport.mjs` | fake spawn：超时/非 JSON/contract/session/结构化退出 |
| `tests/driver.compat.mjs` | 真实 observe/refresh + 注入 transport 的端到端兼容 |
| `evals/probe-driver-shape.mjs` | 真机原始字段/坐标空间/zoom/click 证据（不提交测量产物） |

真机验证顺序：`verify-runtime` → `probe-driver-shape` → `probe-modifier` → `probe-combo-foreground` → `probe-private-drag` → `probe-from-zoom` → `probe-native-freshness` → t11/t14/t15/t17。
