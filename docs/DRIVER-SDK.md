# DRIVER SDK — cua-driver 兼容层与内部规范

> 目的：让插件在用户安装的**不同 cua-driver 版本**上保持同一套内部语义。
> 所有驱动 I/O 都经过 `lib/driver/`；`lib/cua.js` 只保留 facade。
> 最近核对：2026-11-18（实测 0.23.2 → 0.52.13；0.53.0 形态按发布说明预留）。

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

1. **唯一物理入口**：只有 `lib/driver/transport.js` spawn `cua-driver`。新增
   驱动工具必须走 `cuaCall`，不要绕过兼容层。
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
- 0.52.13：顶层 `window_bounds`/`window_title`/`app_name`；元素仍是 `frame`，
  没有 `screenshot_frame`；像素动作要求截图上下文。
- 0.53：预期新增 `screenshot_frame`；归一化用 `frame - screenshot_frame` 的中位
  差值校准坐标空间（`screen` / `screenshot`），再统一成屏幕坐标。

`frame_space` 为 `screenshot-unmapped` 时表示只有截图坐标、缺少窗口 bounds：
`screen_observe` 会明确警告不要用元素 `@(x,y)` 做像素点击，改用
`screen_zoom + from_zoom=true`。

### 2.2 `list_windows`

统一为 `{ windows: [...], _legacy_windows? }`；每项含
`window_id/pid/title/app_name/bounds{x,y,width,height}/z_index/is_on_screen/minimized`。
接受裸数组、`bounds` 的 `w/h`、`is_minimized`、`app`。

### 2.3 `zoom`

统一 `{ screenshot_png_b64, width, height, mime_type }`；接受
`mime_type|screenshot_mime_type|mime|format`。`screen_zoom` 用归一后的 MIME，
不再写死 JPEG。

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

| 标志 | 含义 | 0.23.2 | 0.52.13 | 0.53 |
|---|---|---|---|---|
| `treeFormat` | 接受 `tree_format:"elements"` | ✅ | ✅ | ✅（默认 markdown，必须显式） |
| `flatWindow` | 顶层 `window_bounds/window_title` | ❌ | ✅ | ✅ |
| `screenshotFrame` | 元素带 `screenshot_frame` | ❌ | ❌ | ✅（预期） |
| `dragModifier` | 原生 drag modifier | ❌ | ✅ | ✅ |
| `pointerCapture` | 像素动作需要截图上下文 | ❌ | ✅ | ✅ |
| `moveCursorScreen` | `move_cursor` window scope 用屏幕坐标 | ❌ | ✅ | ✅ |
| `frameSpace` | `screen` / `screenshot` / `null` | `screen` | `screen` | 首次响应校准 |

检测顺序：

1. 配置 `driverProfile: auto|legacy|latest`（显式覆盖）；
2. 环境 `CUA_DRIVER_VERSION` / `CUA_DRIVER_PROFILE`（测试/排障）；
3. `cua-driver --version` 解析 semver；
4. `status` 解析 contract（0.23.2 不输出 contract，忽略即可）；
5. 首次响应学习：`window_bounds`、`screenshot_frame`、frame 差值；
6. 首次错误学习：`invalid_arguments` 点名 `tree_format` → 关闭并重试一次。

未知版本退 `unknown`：请求仍带 `tree_format`/`session`，依赖响应/错误自适应；
drag 默认走私有 helper（已知可靠）。

## 4. 真机实测差异（0.52.13，2026-11-18）

| 现象 | 证据 | 兼容层处理 |
|---|---|---|
| `get_window_state` 默认 `tree_format:"markdown"`，不带 `elements` | 首次调用 keys 有 `element_count=7`、`tree_markdown`，无 `elements`；显式 `tree_format:"elements"` 返回 7 个元素 | `mapRequest` 总是带 `tree_format:"elements"` |
| element_token / zoom 快照按 **session** 归属 | 观察不带 session、点击带 session → `stale_element_token` / `current_snapshots:[]` | `mapRequest` 给 `get_window_state` 注入 `CUA_SESSION` |
| 像素 click/drag/scroll 需要截图上下文 | 无截图时 `screenshot_context_missing / no_screenshot`；先 `get_window_state(include_screenshot:true)` 后成功 | `ensurePointerCapture` 预取；`markTokensStale` |
| `zoom` 需要截图上下文 | 同上；`screen_zoom` 在无 capture 时补读 | `screenZoom` 预取 + `markTokensStale` |
| 结构化拒绝以非零退出返回 | `background_unavailable` JSON + exit 1 | `transport` 解析为 `DriverError.value`；动作类当回执值参与升级 |
| 前台点击校验目标 HWND 前台 | `foreground_unavailable: ... not foreground after the click` | 既有 `bring_to_front` 前置/绕锁链 |
| `move_cursor` window scope 改为屏幕坐标 | 0.52 schema 文档；旧插件传窗口本地会偏移 | `glideCursor`/`hover` 用快照原点换算，并去掉 0.52 不接受的 `origin` 字段 |
| `hotkey` 回执 `foreground_restored:false` | combo probe | 组合键注记动态说明“原前台未恢复”，不再声称已恢复 |

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
6. 在 `docs/DRIVER-SDK.md` 的差异表补一行；更新 `PERMISSIONS.md`（若新增 spawn/参数）。

## 7. 测试

| 套件 | 作用 |
|---|---|
| `tests/driver.normalize.mjs` | 0.23.2 与 0.53 fixtures 归一化一致 |
| `tests/driver.capabilities.mjs` | 版本/能力/请求映射/自适应学习 |
| `tests/driver.transport.mjs` | fake spawn：超时/非 JSON/contract/session/结构化退出 |
| `tests/driver.compat.mjs` | 真实 observe/refresh + 注入 transport 的端到端兼容 |
| `evals/probe-driver-shape.mjs` | 真机原始字段/坐标空间/zoom/click 证据（不提交测量产物） |

真机验证顺序：`verify-runtime` → `probe-driver-shape` → `probe-modifier` →
`probe-combo-foreground` → `probe-private-drag` → `probe-from-zoom` →
`probe-native-freshness` → t11/t14/t15/t17。
