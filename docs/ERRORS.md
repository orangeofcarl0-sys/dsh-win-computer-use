# ERRORS — 错误码与失败语义

> 目的：把回执里的拒绝码、驱动码、投递码、传输错误统一成一张可查表：`ok`、快照影响、模型下一步、人工处理。
> 读者：使用者、排障者、维护者。
> 状态：当前实现（最后核对 2026-11-22；由 `npm run docs:check` 校验方括号码覆盖）。
> 相关：[TROUBLESHOOTING](TROUBLESHOOTING.md) · [TOOLS](TOOLS.md) · [RUNTIME-PIPELINE](RUNTIME-PIPELINE.md)。

## 1. 怎么读回执

- 所有工具都返回 `ok` + `result`；`ok:false` 表示拒绝/未送达/失败，不代表宿主层工具调用失败（宿主通常仍把 `{ok:false}` 当作成功 tool result）。
- `ok:true` 不等于动作一定生效：`effect:unverifiable` 是“已送达但未确认”，需要 `screen_observe`/`computer_verify` 复核。
- 方括号码（如 `[snapshot_missing]`）是插件自己生成的拒绝/提示；驱动码（如 `element_not_visible`）通常不带方括号。
- 回执文本是模型唯一可靠的状态证据；不要只看 `ok`。

## 2. 插件方括号码

| 代码 | 层 | `ok` | 快照影响 | 模型下一步 | 人工处理 |
|---|---|---|---|---|---|
| `[snapshot_missing]` | `guard` / `snapshot` | false | 无快照 | 先全量 `screen_observe`；query 不算动作快照 | 确认目标窗口存在 |
| `[snapshot_expired]` | `snapshot` | false | 清空 | 重新观察 | 长流程可调大 `ttlMs`；不要复用旧编号 |
| `[snapshot_mismatch]` | `snapshot` | false | 不清空 | 用最新观察的 `snapshot_id`；拒绝文本带当前快照 app/title/pid/window_id | 确认是否跨窗口观察过 |
| `[snapshot_consumed]` | `freshnessGate` | false | 不清空 | 重新观察，或把 `supersession` 改 `note` | `enforce` 下每动作一观察是预期成本 |
| `[snapshot_stale_tokens]` | `snapshot` | false | 保留但 token 失效 | 重新观察后再用编号；纯坐标动作仍可继续 | 0.23.2 像素预取会替换 index map |
| `[index_out_of_range]` | `snapshot` | false | 不清空 | 重新观察取新编号 | 编号来自旧快照/别的窗口 |
| `[index_no_coordinate]` | `human` | false | 不清空 | 该元素没有可用坐标；改用编号动作或重新观察 | 元素 frame 缺失 |
| `[zoom_missing]` | `actions` | false | 不清空 | 先 `screen_zoom`，再用 `from_zoom=true` | zoom 与当前窗口不匹配 |
| `[zoom_stale]` | `actions` | false | 不清空 | 重新 zoom（必须晚于当前观察、同 pid/window） | 观察后 zoom 已过期 |
| `[pointer_capture_missing]` | `actions` | false | 不清空 | 先观察/zoom 建立截图上下文；或重试一次像素动作 | 0.52+ 像素动作需要 capture |
| `[private_drag_zoom_unsupported]` | `actions` | false | 不清空 | 用窗口截图坐标重发；不要 modifier+from_zoom | 私有路径不复刻 zoom 映射 |
| `[private_drag_no_frame]` | `actions` | false | 不清空 | 先全量 `screen_observe`（不要 query） | 快照缺 `screenOrigin`/截图尺寸 |
| `[input_unconfirmed]` | `guard` | false | 不清空 | 先回读/修正输入；保存意图被拦 | 回读一致、native observe 或 zoom 可解除 |
| `[repeat_suppressed]` | `loopGuard` | false | 不消费 | 先观察；确认要再点就换目标或 `count=2` | 5s 同窗口/同目标/同投递模式 |
| `[stale_element_token]` | `receipt` | false（引擎拒绝） | 清空 | 重新观察，不要重试旧编号 | 驱动 session/token 失效 |
| `[policy_blocked_app]` | `policy` | false | 不消费 | 应用在 `autonomy.blockedApps`；观察仍可用，换应用或改配置 | 确认是否误列 |
| `[policy_sensitive_app]` | `policy` | false | 不消费 | auto/locked 下只读；要操作切 `guarded` 或移出 `sensitiveApps` | 敏感应用清单 |
| `[policy_locked]` | `policy` | false | 不消费 | locked 只允许 `allowedApps`；换应用或改配置 | 白名单模式 |
| `[policy_locked_no_allowlist]` | `policy` | false | 不消费 | locked 需要非空 `allowedApps`；否则观察仍可用、操作全拒绝 | 配置 fail-closed |
| `[policy_not_allowlisted]` | `policy` | false | 不消费 | 应用不在 `allowedApps`；换应用或改配置 | 白名单模式 |
| `[policy_real_pointer_denied]` | `policy` | false | 不消费 | `realPointer=deny`；改用虚拟悬停/点击 | 共享机器建议 |
| `[policy_subagent_pointer]` | `policy` | false | 不消费 | 子 Agent 不能移动真实指针；交回主 Agent | 委派边界 |
| `[policy_delegation_denied]` | `policy` | false | 不消费 | locked/deny/子 Agent 不能委派；改为内联操作 | 委派预算/策略 |
| `[policy_approval_unavailable]` | `policy` | false | 不消费 | guarded 需要主 Agent + `userQuestions`；缺失/子 Agent 一律拒绝 | 宿主能力 |
| `[policy_approval_denied]` | `policy` | false | 不消费 | 用户本会话已拒绝；不要重复询问 | 用户决定 |
| `[policy_approval_cancelled]` | `policy` | false | 不消费 | 询问被取消；本会话按拒绝处理 | 用户取消 |
| `[relative_coordinate_invalid]` | `actions`/`ops` | false | 不消费 | relative 只接受 0–999 整数；与 element/real=true 互斥 | 坐标参数 |
| `[relative_coordinate_unavailable]` | `snapshot` | false | 不消费 | 先全量 `screen_observe` 获取截图尺寸，或改用像素坐标 | 快照缺尺寸 |
| `[relative_from_zoom_conflict]` | `actions` | false | 不消费 | `relative` 与 `from_zoom` 二选一 | 坐标空间 |
| `[model_image_unsupported]` | `observe` | false | 不消费 | 当前模型未声明 image；改用 `mode="ax"` 或视觉模型 | route 能力 |

### 2.1 实验性后台输入

这些码来自 `lib/backgroundInput.js`/`tools/background-input.ps1`，只在 `backgroundInput`/`syntheticPointer`/`anchoredInput` 启用且目标没有可交互 UIA 元素时出现。全部 `ok:false`、不消费快照、不自动换通道。下表是快速索引；**完整含义、回执字段与安全边界见 [BACKGROUND-INPUT §10](BACKGROUND-INPUT.md)**。

| 代码 | 含义 | 模型下一步 |
|---|---|---|
| `background_input_occluded` | 目标点被遮挡/不在目标窗口；未发送 | 先 `computer_activate` 或移开遮挡窗口；不要重复 |
| `background_input_anchor_blocked` | B1 anchor 被 topmost 窗口遮挡；未注入 | 移开遮挡或改用前台 |
| `background_input_uipi` | 完整性/session 不匹配 | 不要绕过 UIPI；改用同 IL 进程/前台 |
| `background_input_secure_desktop` | 非 Default 输入桌面 | 不要自动化 UAC；人工处理 |
| `background_input_clip_cursor` | `ClipCursor` 不允许目标点 | 让目标释放光标裁剪 |
| `background_input_window_not_movable` | 最小化/最大化/全屏/拒绝移动 | 还原窗口或改用 B1/B0 |
| `background_input_window_move_failed` | 移动/对齐失败；窗口已还原 | 先 observe；不要重复 |
| `background_input_cursor_changed` | 操作期间光标被外部移动 | 先 observe；干净桌面再试 |
| `background_input_window_changed_externally` | 操作期间窗口被外部移动；为避免抢回用户窗口，未还原/未继续 | 先 observe；不要重复 |
| `background_input_block_input_denied` | B2 的 `BlockInput` 被当前会话拒绝；未移动光标、未发送；带 `win32_error`/`diagnostics` | 不要重试 B2；改用 `cursor-clip`、B0/B1 或前台 |
| `background_input_desktop_busy` | 静默预检发现光标仍在移动；未发送；带 `drift` | 停止移动鼠标后重试；或改用前台 |
| `background_input_clip_anchor_failed` | `cursor-clip` 的 `ClipCursor` 失败；未移动光标/未发送 | 改用 `cursor` 或前台 |
| `background_input_synthetic_unavailable` | 系统不支持合成触控（`CreateSyntheticPointerDevice` 不可用） | 不要重试 B1 |
| `background_input_injection_failed` | 合成触控/注入失败，结果未知或未完整 | 不要重复；先 observe |
| `background_input_window_not_available` | 目标窗口不可见/最小化或已消失；未发送 | 先 observe/activate |
| `background_input_partial_delivery` | 只投递了部分输入（鼠标 up/按键 up/文本未发完） | 不要整段重复；先 observe/回读 |
| `background_input_password_denied` | 焦点/目标是密码框 | 由用户本人输入 |
| `background_input_timeout` | helper 超时，结果未知 | 不要重复；先 observe |
| `background_input_helper_exited` | helper 异常退出，结果未知 | 不要重复；先 observe |
| `background_input_failed` | 其他未发送/失败 | 先 observe；必要时改用 foreground=true |

> B1 遮挡失败关闭；B2 `BlockInput` 失败时不移动光标；B2/B3 还原失败会返回 `ok:true` + `complete:false` + `warning_code`（`cursor_restore_failed`/`window_restore_failed`/`input_unblock_failed`/`clip_restore_failed`），避免重复点击。结构化回执同时带 `cursor_restored`/`window_restored`/`input_blocked_ms`/`clip_anchored`/`clip_restored`/`win32_error`/`diagnostics`。

> `[<tool-name>]` 是 `computer_do` 路由成功/失败时加的结果前缀（如 `[computer_click] ...`），不是错误码。

### 2.2 原生菜单兜底码（`nativeMenus:auto`）

这些码出现在 `computer_menu` 的“原生 HMENU 兜底失败（code）”文本里；只在驱动结构化拒绝后出现。

| 代码 | 含义 | 模型下一步 |
|---|---|---|
| `no_hmenu` | 目标没有标准 HMENU（MenuStrip/WPF/WinUI） | 不要用坐标点击；先 observe，走 UIA 菜单路径 |
| `path_not_found` | 路径段不存在或不是子菜单 | 先 observe 确认菜单文本；不要模糊匹配 |
| `ambiguous` | 同层多个同名项 | 不猜；改用 UIA/点击具体项 |
| `disabled` | 最终项禁用 | 先处理禁用原因；不要重复 |
| `item_not_command` | 最终项仍是子菜单 | 补全路径到叶子命令 |
| `stale_command` | resolve 与 invoke 之间菜单变化 | 重新 observe；不要重复 |
| `post_message_failed` | `PostMessage(WM_COMMAND)` 失败 | 先 observe；不要重复 |
| `timeout` | 原生菜单超时；`WM_COMMAND` 可能已发送 | 不要重复；先 observe |
| `pid_missing`/`window_missing`/`bad_path` | 回退参数不足 | 补 pid/window_id/路径 |
| `unavailable`/`failed` | 脚本缺失或执行失败 | 回退 UIA；不要重复 |

### 2.3 原生 Button 触发码（`nativeButtonTrigger:auto`）

| 代码 | 含义 | 模型下一步 |
|---|---|---|
| `native_button_owner_disabled` | 主窗口已被模态禁用；未发送 | 先 observe 同 pid 新对话框；不要重复点主窗口按钮 |
| `native_button_latched` | 10s 内同一按钮已触发过；未发送 | 先 observe；不要重复 |
| `native_button_unknown` | helper 超时/异常，BM_CLICK 可能已发送 | 不要重复；先 observe 是否出现新同 pid 窗口 |
| `no_match`/`ambiguous` | 未找到/多个标准 Button 匹配 | 回退 driver；不要坐标乱点 |
| `window_not_found`/`pid_mismatch`/`post_message_failed` | 未投递 | 回退 driver；先 observe |

## 3. 驱动码

这些码通常出现在 `result` 文本里，由 `engineRefusal`/`deliveryFailure` 分类；是否 `ok:false` 取决于层。

| 代码 | 含义 | 插件处理 | 模型下一步 |
|---|---|---|---|
| `invalid_arguments` | 参数形态不被驱动接受 | 拒绝回执；不重试 | 按工具参数表重发；检查 enum/范围 |
| `unavailable` | 能力/通道不可用 | 拒绝回执 | 换通道（element/坐标/native/vision） |
| `not_supported` | 驱动不支持该操作 | 拒绝回执 | 换工具或降级路径 |
| `screenshot_context_missing` | 像素动作/zoom 前没有截图上下文 | 0.52+ 自动补 capture-only；仍失败则拒绝 | 先观察/zoom；不要重复盲点 |
| `window_target_not_found` | 目标窗口已关闭/不存在 | 拒绝回执 | 重新 `list_windows`/观察；不要用旧 window_id |
| `target_not_found` | 元素/菜单目标不存在 | 拒绝回执 | 重新观察；菜单先打开再调用 |
| `stale_element_token` | 元素 token 失效 | 清空快照 | 重新观察 |
| `element_not_visible` | 元素不可见/已变化（也可能驱动误报） | 拒绝/未确认 | 先 observe/verify；WinUI 改点控件 |
| `menu_path_unavailable` | 菜单路径走不到 | 失败回执；不回退像素 | 先点菜单栏项，观察弹出菜单再点 |

## 4. 投递码

| 代码 | 含义 | `ok` | 快照影响 | 模型下一步 |
|---|---|---|---|---|
| `background_unavailable` | 目标输入栈丢弃后台事件 | false | 不消费 | `deliveryMode: auto` 自动前台；或单次 `foreground:true` |
| `foreground_unavailable` | 前台锁/目标未前台 | false | 不消费 | 自动 L3；仍失败先让目标前置 |
| `delivery_failed` | 投递未确认（常见于后台按键） | false | 标 suspect | 先 observe，必要时 foreground 重试一次 |
| `background_delivery_failed` | 驱动的“建议升级前台”escalation，**不是硬失败** | 仍按 `unverifiable` | 消费 + suspect | 以 `effect`/回读为准；不要因整段 JSON 子串误判 |

## 5. 传输层 `DriverCallError.kind`

| kind | 含义 | 上层行为 |
|---|---|---|
| `spawn` | 找不到/无法启动驱动 | 结构化错误 + `CUA_DRIVER_BIN` 指引 |
| `timeout` | 超过 `CUA_CALL_TIMEOUT_MS`（默认 30s） | 结构化超时；不自动重试。click 超时后回执提示“结果未知”：先等待 5–10s，再 observe 确认是否延迟成功；模态期间 UIA 树可能持续 0 元素，不要连续重试/换键/activate，完整操作指引见 [WINDOWS §6.1](WINDOWS.md)；根因见 [EVIDENCE §18](EVIDENCE.md#18-2026-11-20--t20-模态-30s-超时根因探针)。type 超时提示可能已部分写入 |
| `exit` | 非零退出且非 JSON | 原样报错 |
| `structured` | 非零退出 + JSON 拒绝 | 动作类当回执值；观察类抛错走降级 |
| `nonjson` | 退出 0 但 stdout 非 JSON | 原样报错 |
| `contract_mismatch` | CLI/daemon contract 不一致 | 明确要求一起升级并重启 daemon |
| `session_ended` | session 被回收 | `start_session` 自愈一次 |

## 6. 负向 `effect` / `status`

`engineRefusal` 识别的负向词汇：

| 形态 | 取值 |
|---|---|
| `effect` | `refused`、`rejected`、`suspected_noop`、`failed`、`error`、`denied` |
| `status` | `failed`、`denied`、`refused`、`error` |
| `refusal` | `{code, message}` |
| 布尔/错误码 | `ok:false`、`success:false`、`supported:false`、`error_code` |

- `suspected_noop`：终态 `ok:false`，标 suspect，不消费；提示先观察，不立即重放非幂等动作。
- `refused`/`rejected`/`failed`/`error`/`denied`：拒绝/失败；不消费（`suspected_noop` 除外）。
- 未知回执不升级成 `confirmed`；只做保守分类。

## 7. 回执状态矩阵

| 回执形态 | `ok` | 快照标记 | 模型应做什么 |
|---|---|---|---|
| 正常 + `effect:confirmed` | true | `markConsumed` | 继续 |
| `effect:unverifiable` | true | `markConsumed` + `markSuspect` | 先 observe/verify 确认 |
| `suspected_noop` | false | `markSuspect`，不消费 | 先 observe，再决定是否重试 |
| 投递失败 | false | 不消费；`delivery_failed` 另标 suspect | 按码处理；不要重复非幂等动作 |
| 引擎拒绝 | false | 不消费（stale token 清空） | 按拒绝原因处理 |
| 密码硬拒 | false | 不消费 | 由用户本人输入密码 |

## 8. 死代码/历史码

- `sendinput_blocked`：旧回执文案里可能提到，但私有 helper 实际把 SendInput 失败报成 `exception`；不要据此排查。
- `background_delivery_failed` 曾被整段 JSON 子串误判成硬失败（t14 r1 的 26/28 次假失败）；现在按词边界识别为 escalation 建议。
- `[snapshot_stale_tokens]` 只与 0.23.2 的像素预取路径有关；0.52+ 的 capture-only 保留 token，不再标记。

## 9. 人工升级路径

1. 先看 [TROUBLESHOOTING](TROUBLESHOOTING.md) 的决策树，确认失败阶段。
2. 驱动/传输问题看 [DRIVER-SDK](DRIVER-SDK.md) §5；Windows 前台锁/UIPI 看 [WINDOWS](WINDOWS.md)。
3. 需要原始 JSON：`verboseReceipts: true`；需要完整调用链：开 `trajectoryFile`，用 `node evals/analyze-trajectory.mjs <file>`。
4. 回执与代码不一致时，以代码/测试为准并补 `docs:check`/单测，不要把临时文案当契约。
