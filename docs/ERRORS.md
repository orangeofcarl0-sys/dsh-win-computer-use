# ERRORS — 错误码与失败语义

> 目的：把回执里的拒绝码、驱动码、投递码、传输错误统一成一张可查表：`ok`、快照影响、模型下一步、人工处理。
> 读者：使用者、排障者、维护者。
> 状态：当前实现（最后核对 2026-11-18；由 `npm run docs:check` 校验方括号码覆盖）。
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

> `[<tool-name>]` 是 `computer_do` 路由成功/失败时加的结果前缀（如 `[computer_click] ...`），不是错误码。

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
| `timeout` | 超过 `CUA_CALL_TIMEOUT_MS`（默认 30s） | 结构化超时；不自动重试。click 超时后回执提示“结果未知”：先等待 5–10s，再 observe（capture/ax）确认是否延迟成功；模态期间 UIA 树可能持续 0 元素，不要连续重试/换键/activate。根因见 [EVIDENCE §1.4](EVIDENCE.md#14-2026-11-20--t20-模态-30s-超时根因探针)。type 超时提示可能已部分写入 |
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
