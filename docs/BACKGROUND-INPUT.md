# BACKGROUND-INPUT — 实验性 Windows 后台输入

> 目的：插件侧 Windows 后台输入（B0/B1/B2/B3）的通道矩阵、配置、回执、安全边界与实测结果。
> 读者：要启用/排障实验输入的人；改 `lib/backgroundInput.js` 或 `tools/background-input.ps1` 的人。
> 状态：实验性，默认全关（2026-11-20 实现；2026-11-21 默认 14 PASS / 1 BLOCKED、`--elevated` 14 PASS / 0 BLOCKED；2026-11-22 修正 IntegrityRank off-by-one，修正后 UAC 复跑待做）。
> 相关：[WINDOWS](WINDOWS.md) · [ARCHITECTURE](ARCHITECTURE.md) · [TOOLS](TOOLS.md) · [CONFIGURATION](CONFIGURATION.md) · [SECURITY](SECURITY.md) · [ERRORS](ERRORS.md)。

## 1. 定位

cua-driver 的 `deliveryMode=background` 覆盖 UIA 与它自己的 PostMessage 路径。对没有可交互 UIA 元素的目标（Unity/Canvas/游戏/自绘窗口），driver 可能返回 `background_unavailable`，或在 UIA provider 饥饿时阻塞到超时。

本功能是**插件侧的实验通道**，不是 driver 的替代：

- 只在快照**没有可交互 UIA 元素**时接管；
- 只接管 `click` 家族、普通 `key`、`type`；不接管拖拽/滚轮/组合键/`from_zoom`/前台；
- 默认三键全关：零 PowerShell spawn，行为与 0.5.8 一致；
- 命中后不进入 `cuaDeliver`，避免 L2/L3 重复投递；
- 失败/未验证不自动换通道、不自动升级前台。

## 2. 后台等级

| 等级 | 定义 | 本功能通道 |
|---|---|---|
| **B0** | 不碰光标、前台、窗口位置、Z 序 | `backgroundInput`：窗口消息/控件消息 |
| **B1** | 不碰光标/前台；目标可命中，不提升/不改透明度 | `syntheticPointer`：合成触控 |
| **B2** | 临时接管真实光标，结束后还原 | `anchoredInput: cursor`（`BlockInput`）或 `cursor-clip`（`ClipCursor`，免提权） |
| **B3** | 临时移动目标窗口，结束后还原 | `anchoredInput: window` |
| **B4** | 真实前台 + `SendInput` | 现有 `deliveryMode=auto/foreground` |
| **B5** | 全局键状态/内核驱动 | 不在本功能；不实现 |

“后台”在本文件里始终指 B0/B1；B2/B3 只是“不抢前台”，仍然会动光标/窗口。

## 3. 目标契约

`lib/backgroundInput.js` 的 `hasNoActionableUia(snap)` 检查快照 `entries` 中是否有 Button/Edit/MenuItem 等可交互角色：

- 有 → `uia`，插件通道不接管，继续 driver/UIA；
- 无（`elementCount=0` 或只有窗口/Pane/Text 根元素）→ 进入本功能；
- `backend=native-dialog` → 不接管（native-dialog 已有 BM_CLICK）；
- 安全桌面/高完整性/不同 session → 不接管，交回 driver 或拒绝。

`probe` 每次动作前读取：窗口类、pid、完整性、session、可见/最小化/最大化、前台、客户区/窗口 rect、焦点 HWND、`IsTouchWindow`、`ClipCursor`、当前光标。profile 缓存 3s。

## 4. 通道矩阵

| 通道 | 配置 | 目标 | 首版动作 | 位置 | 事件 | 等级 |
|---|---|---|---|---|---|---|
| B0 message | `backgroundInput: auto` | 无 UIA 的 message 窗口 | 左/右/双击；plain key；text | lParam 客户区坐标 | `PostMessage` 鼠标；`SendMessageTimeout` key/text | B0 |
| B0 control | `backgroundInput: auto` | 标准 `Button` 子控件 | 左单击 | 屏幕点 → 子控件 | `BM_CLICK` | B0 |
| B1 synthetic | `syntheticPointer: auto` + `allowedApps` | 无 UIA 的 pointer/touch 窗口 | 左单击 | 虚拟屏幕物理坐标 | `InjectSyntheticPointerInput(PT_TOUCH)` + anchor | B1 |
| B1 promote | `syntheticPointer: promote` + `allowedApps` | 无 UIA 的普通 message 窗口 | 左单击 | 虚拟屏幕物理坐标 | 单点 `InjectSyntheticPointerInput(PT_TOUCH)`（无 anchor，系统提升为鼠标） | B1 |
| B2 cursor | `anchoredInput: cursor` + `allowedApps` | 无 UIA 的 cursor-polling 窗口 | 左单击 | 真实光标移到目标点 | 消息 + `BlockInput` | B2 |
| B2 cursor-clip | `anchoredInput: cursor-clip` + `allowedApps` | 无 UIA 的 cursor-polling 窗口 | 左单击 | 真实光标移到目标点，`ClipCursor` 限制 5×5 | 消息（不阻塞键盘） | B2 |
| B3 window | `anchoredInput: window` + `allowedApps` | 无 UIA 的 cursor-polling 窗口 | 左单击 | 移动窗口使目标点落在光标下 | 消息 | B3 |

- B1/B2/B3 只支持**左单击**；双击/右键继续 driver/前台。
- B1 没有合成键盘；键盘/文本仍走 B0 或前台。B1 也没有滚轮。
- B2/B3 只解决鼠标位置，不改善键盘/文本。
- 组合键、modifier、`foreground=true`、`deliveryMode=foreground`、`from_zoom` 一律跳过本功能。

## 5. B0：消息/控件

### 5.1 点击

1. `probe` 校验同 pid/session/完整性、目标可见且未最小化。
2. 屏幕点 = `snap.screenOrigin + 截图坐标 × scale`（与私有拖拽同一规则）。
3. **预检**：`WindowFromPoint` 必须是目标窗口/子窗口；否则 `background_input_occluded`，**不发送**。
4. 子窗口 class 为 `Button` 且 enabled/visible 时发 `BM_CLICK`（控件消息）；否则：
   - `SendMessageTimeout(WM_ACTIVATE)` 到 root owner（假激活，不切前台）；
   - `PostMessage(WM_MOUSEMOVE)` → 10ms → `WM_LBUTTONDOWN` → 30ms → `WM_LBUTTONUP`；
   - 右键用 `WM_RBUTTONDOWN/UP`；双击用第二组 down/up，`CS_DBLCLKS` 时用 `WM_LBUTTONDBLCLK`。

鼠标用 `PostMessage`（异步，避免游戏主线程阻塞）；文本/按键用 `SendMessageTimeout`（同步等待窗口过程，稳定优先）。两者都是 B0，不移动光标/前台。

### 5.2 键盘/文本

- 目标选择：`FocusOrTarget(hwnd)`——目标线程的焦点若是目标本身/子窗口则用焦点；否则直接用目标窗口。避免把按键发给同线程的无关窗口。
- `key`：plain key（return/esc/tab/space/backspace/delete/insert/方向/Home/End/PageUp/PageDown/F1-F12/字母/数字）；`WM_KEYDOWN/UP` + 扫描码 + extended 位。组合键不接管。
- `text`：有 element 时取该点下的子窗口；无 element 时取 `FocusOrTarget`；`ES_PASSWORD` 直接拒绝；逐 UTF-16 code unit `WM_CHAR`，每字符 15ms。
- 不支持 IME、代理对合并、组合键；`computer_type` 的追加语义保持不变。

## 6. B1：合成触控

- `CreateSyntheticPointerDevice(PT_TOUCH, 2, POINTER_FEEDBACK_NONE)`；Windows 10 1809+。
- 4×4 topmost `WS_EX_TOOLWINDOW|WS_EX_NOACTIVATE|WS_EX_LAYERED` anchor，alpha=1，放在避开目标窗口的屏幕角落；anchor 窗口过程消费 `WM_POINTER` 并返回 0，吃掉主指针身份。
- 点击帧：anchor down → 12ms → 目标 touch down → 12ms → touch up → 12ms → anchor up。
- **遮挡失败关闭**：`WindowFromPoint` 必须是目标/子窗口；否则 `background_input_occluded`，**不提升窗口、不改 alpha、不注入**。提示先 `computer_activate` 或移开遮挡窗口。
- 最小化/不可见/点在桌面外/anchor 被遮挡 → 失败关闭。
- 只支持左单击；无滚轮/键盘/右键/双击/修饰键。
- 目标必须处理 `WM_POINTER`；不处理的目标可能只得到 `unverifiable` 或 no-op。
- `syntheticPointer: promote`（2026-11-21 实测）：不创建 anchor，单点 `InjectSyntheticPointerInput(PT_TOUCH)`；未注册触控的普通 message 窗口收到系统提升的 `MOUSEDOWN/MOUSEUP`。只对 message 契约生效；pointer/touchWindow 仍走 `auto`。应用语义仍未验证。
- helper 回执带 `cursorBefore`/`cursorAfter`/`cursorDrift`；探针以注入窗口内的 drift 判定 B1 是否移动光标，外部物理漂移单独记录，不再把 B1 误判为 BLOCKED。

## 7. B2：光标锚定

以下为 `anchoredInput: cursor`（严格模式）；免提权替代见 §7.1 `cursor-clip`。

- 前置：目标可见、未最小化、点在桌面、点在 `ClipCursor` 内、`BlockInput(TRUE)` 成功。
- 保存光标 → `BlockInput(TRUE)` → `SetCursorPos` → 30ms → 消息点击 → 30ms → 还原光标 → `BlockInput(FALSE)`。
- `BlockInput` 失败时**不移动光标**，返回 `background_input_block_input_denied`（部分会话/安全软件会拒绝）。
- 2026-11-21 `probe-background-input --elevated`（UAC）实测：High IL helper 的 `BlockInput` 成功，125ms，`inputBlocked=true`、`inputUnblocked=true`、`cursorRestored=true`；默认非提权会话仍失败关闭（`win32=0`、`helperElevated=false`、`helperUIAccess=false`、Default 桌面）。
- 只支持左单击；会短暂抢光标并阻塞用户输入；回执带 `input_blocked_ms` 与 `cursor_restored`。
- `SetCursorPos` 后用 `GetCursorPos` 复核目标点；`BlockInput(false)` 失败时回执 `input_unblocked=false`，helper 在回复后退出以释放输入阻塞。
- 还原失败不假装成功：回执 `cursor_restored=false` + `complete:false` + `warning_code=cursor_restore_failed`。

### 7.1 `cursor-clip`（免提权替代）

- 不调用 `BlockInput`，改用 `ClipCursor` 把光标限制在目标点 5×5 区域；不阻塞键盘。
- `GetClipCursor` 保存原裁剪区 → `ClipCursor(5×5)` → `SetCursorPos` → 30ms 复核 → `PostMessage` 前再复核一次 → `finally` 恢复原裁剪区 → 复核。
- 失败码：`background_input_clip_anchor_failed`（`ClipCursor` 失败）；恢复失败回执 `warning_code=clip_restore_failed`；1.5s 看门狗线程兜底恢复。
- 回执字段：`method=clip_anchored`、`clip_anchored=true`、`clip_restored`、`input_blocked=false`、`cursor_restored`、`input_blocked_ms`。
- 2026-11-21 实测：当前会话严格 `BlockInput` 被拒，`cursor-clip` 两轮 PASS（109–125ms、`MOUSEDOWN`、clip/光标均还原）。

## 8. B3：窗口锚定

- 前置：`allowedApps` 命中、顶层窗口、非最小化/最大化/无边框全屏、`SetWindowPos` 可用。
- 保存窗口 rect → 计算 `newLeft = cursor.x - clientX - borderX` → `SetWindowPos` → 有界轮询（≤500ms）→ 校验窗口位置与光标下客户区点 → 消息点击 → 还原窗口 rect（同样有界轮询）。
- 操作期间光标移动 >2px 或窗口被外部改动 → `background_input_cursor_changed` / `background_input_window_changed_externally`；不抢回用户改动。
- 请求位置恰好等于原位置时也检测外部移动；点击后 50ms 再检查，窗口已外移则不还原，回执 `ok:true + delivered:true + warning_code=window_changed_externally + windowRestored:false`。
- 只支持左单击；会短暂移动窗口；不做离屏截图/伪最小化/改 Z 序。
- 回执带 `window_moved`、`window_restored`、`complete`；还原失败 `warning_code=window_restore_failed`。

## 9. 配置

```yaml
backgroundInput: off       # off | auto（B0）
syntheticPointer: off      # off | auto | promote（B1）
anchoredInput: off         # off | cursor | cursor-clip | window（B2/B3）
```

- 三键全 off：零 spawn、零行为变化。
- B1/B2/B3 还要求 `allowedApps` 非空且包含 `snap.appName`；B0 不强制。
- B2/B3 同时配置时 `anchoredInput` 只有一个值；B1 优先于 B2/B3。
- `deliveryMode=foreground`/`foreground=true`/modifier/组合键/`from_zoom` 跳过本功能。

## 10. 回执与错误

成功回执的 `delivery.mode`：

| mode | 中文 |
|---|---|
| `background-message` | 后台消息 |
| `win32-control` | 控件消息 |
| `synthetic-pointer` | 合成触控 |
| `cursor-anchored` | 光标锚定 |
| `window-anchored` | 窗口锚定 |

`effect`：

- `confirmed`：只有控件消息/回读可确认时；
- `unverifiable`：B0 鼠标、B1、B2、B3；
- 未验证会触发 `markSuspect`，下一次动作先观察。

拒绝码：

| code | 含义 |
|---|---|
| `background_input_occluded` | 目标点被遮挡/不在目标窗口；未发送 |
| `background_input_anchor_blocked` | 合成触控 anchor 被 topmost 窗口遮挡；未注入 |
| `background_input_uipi` | 完整性/session 不匹配；未发送。rank 映射 `0=low / 1=medium / 2=high / 3=system`；2026-11-22 修正了 off-by-one（medium 曾误标为 high），**修正后 UAC 复跑待做**（证据见 [EVIDENCE](EVIDENCE.md) §4） |
| `background_input_secure_desktop` | 非 Default 输入桌面；未发送 |
| `background_input_clip_cursor` | `ClipCursor` 不允许目标点 |
| `background_input_window_not_movable` | 最小化/最大化/全屏/拒绝移动 |
| `background_input_window_move_failed` | 移动/对齐失败 |
| `background_input_cursor_changed` | 操作期间光标被外部移动 |
| `background_input_window_changed_externally` | 窗口被外部移动；未抢回、未继续 |
| `background_input_block_input_denied` | B2 `BlockInput` 被当前会话拒绝；未移动光标；回执带 `win32_error`/`diagnostics`（`helperElevated`/`helperUIAccess`/session/desktop） |
| `background_input_desktop_busy` | 静默预检发现光标仍在移动；未发送；回执带 `drift` |
| `background_input_clip_anchor_failed` | `cursor-clip` 的 `ClipCursor` 失败；未移动光标/未发送 |
| `background_input_synthetic_unavailable` | 系统不支持合成触控 |
| `background_input_injection_failed` | 合成触控/注入失败，结果未知或未完整 |
| `background_input_window_not_available` | 目标不可见/最小化/已消失；未发送 |
| `background_input_partial_delivery` | 只投递了部分输入 |
| `background_input_password_denied` | 焦点/目标是密码框 |
| `background_input_timeout` | helper 超时，结果未知 |
| `background_input_helper_exited` | helper 异常退出，结果未知 |
| `background_input_failed` | 其他未发送/失败 |

所有拒绝都提示“不要重复；先 screen_observe”；不自动前台、不自动换通道。

## 11. 安全边界

- 只对同 pid/同 session/同等或更低完整性目标；不绕过 UIPI。
- 安全桌面（UAC/锁屏）直接拒绝；不自动化 UAC。
- 不自动选择 Yes/No；不绕过现有密码守卫；`backgroundInput` 文本也会检查 `ES_PASSWORD`。
- B1 遮挡不借 Z 序/透明度；失败关闭。
- B2 `cursor` 先 `BlockInput` 成功才移动光标；失败不移动。`cursor-clip` 用 `ClipCursor` 限制光标 5×5，不阻塞键盘；clip 恢复失败会给 `warning_code=clip_restore_failed`，并有 1.5s 看门狗。
- B3 只移动 `allowedApps` 内的目标；最大化/最小化/全屏拒绝；外部改动不抢回。
- 不实现全局受管键、Interception/ViGEm、UIAccess、反作弊规避。
- helper 是中/高完整性 PowerShell；高完整性目标由 `probe` 判断；不同 session 拒绝。

## 12. 测试与证据

- 离线：`tests/background-input.test.mjs`（52 项）：动作接入、off/foreground/modifier/组合键回退、拒绝不重试、回执字段/错误码、client 就绪/超时/坏响应/旧进程 exit 竞态、分类器/坐标/VK、B1/B2/B3 路由、`cursor-clip`/`desktop_busy`/诊断透传、B3 外部移动回执、`syntheticPointer:promote` 路由与 pointer 契约不接管；G5b/I6b 断言 UIPI 拒绝不落入 `unverifiable`、高 IL profile fail-closed。
- 真机：`evals/probe-background-input.mjs`（不加入 `npm test`；可加 `--elevated`）：
  - 自建原生 pointer 窗口 + 只处理 `WM_TOUCH` 的 touch-only 窗口 + 未注册触控的 mouse-only 窗口 + 隐藏 controller + cover；
  - B0 click/text/key、B1 synthetic、B1 WM_TOUCH-only、B1 mouse-only 鼠标提升、B1 遮挡、B1 前台不变、B3 window 实测通过；
  - B1 光标：helper 在注入窗口内采样 `cursorBefore/cursorAfter`，`cursorDrift=0` → PASS；外部漂移单独记录（各轮实测 30–751px 与 348–766px，见 [EVIDENCE](EVIDENCE.md) §16/§13），不再把 B1 误判为 BLOCKED；
  - B1 mouse-only：`syntheticPointer:promote` 的无 anchor 单点触控收到 `MOUSEDOWN/MOUSEUP` → PASS；应用语义仍未验证；
  - B2 严格 `BlockInput`：默认非提权会话被拒 → BLOCKED（`win32=0`、`helperElevated=false`、`helperUIAccess=false`、Default 桌面）；`--elevated`（UAC）**PASS**（125ms、`inputBlocked=true`、`inputUnblocked=true`、`cursorRestored=true`）；`cursor-clip` 也 PASS；
  - B3 干净轮次 PASS；脏桌面/输入桌面变化时 `window_move_failed`/`desktop_busy`/`window_changed_externally` → BLOCKED；点击后窗口被外部移动时不还原，回执 `warning_code=window_changed_externally`。
  - 2026-11-21 结果：默认 **14 PASS / 1 BLOCKED / 0 FAIL**（严格 B2）；`--elevated` **14 PASS / 0 BLOCKED / 0 FAIL**。不把 BLOCKED 当 PASS。
- 运行：`node evals/probe-background-input.mjs`；清理只按探针 HWND/PID。

## 13. 已知限制

- 只覆盖无 UIA 目标；有可交互 UIA 元素时继续 driver/UIA。
- B0 鼠标依赖目标处理 `WM_*` 坐标；光标轮询/Raw Input 目标无效。B0 点击目标点必须在目标窗口上；最小化/被遮挡时 fail-closed。
- B0 键盘/文本不更新 OS 修饰键状态；组合键仍前台。
- B1 只支持左单击；无滚轮/键盘；目标必须处理 `WM_POINTER`，或由系统把合成 pointer 转换为 `WM_TOUCH`（探针的 touch-only 窗口收到 `WMTOUCH`；普通应用仍需逐个确认）。anchor 取虚拟屏幕角落；显示器错位/全屏遮挡时可能 fail-closed。
- B2 会抢光标；`BlockInput` 在部分会话被拒绝。
- B3 会移动窗口；用户移动光标/窗口时失败关闭；不做离屏截图。
- 不做拖拽/滚轮/IME/右键/双击（除 B0 支持的双击/右键）；不做全局键/驱动。
- 真机结果受桌面占用/安全软件/多显示器影响；BLOCKED 不等于 PASS。

## 14. 回滚

- 三键全 `off`：零 spawn、零行为变化。
- 删除 `lib/backgroundInput.js` + `tools/background-input.ps1` 即回到 0.5.8 行为；无数据迁移。
- `computer_stop` 会调用 `stopBackgroundInput()`：发 `restore` + `shutdown` 停止 B1 worker 并释放 anchor；B2/B3 在各自请求的 `finally` 内还原光标/窗口。若请求已挂死、客户端超时 kill helper，仍可能残留移动后的光标/窗口，需人工检查。
