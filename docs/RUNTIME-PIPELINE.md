# RUNTIME-PIPELINE — 运行时与执行链路

> 目的：把 dsh 宿主、插件工具面、cua-driver、会话日志与 S4 eval 串成一张可诊断的图。
> 适用：dsh 0.2.2-rc.1/rc.2；插件 `0.5.7-dev`；Windows 优先。
> 相关：[ARCHITECTURE](ARCHITECTURE.md)、[WINDOWS](WINDOWS.md)、[TESTING](TESTING.md)。

## 1. 总览

```text
dsh CLI
  -> profile + patch 叠加
  -> cordis Loader / ToolsService
  -> 插件 apply(ctx, config)（编译 22 个 defineTool，只注册可见子集）
  -> 模型 step
  -> tools.execute
       -> 参数校验（defineTool）
       -> wrap（stop latch / 未知参数 / guard）
       -> 工具实现
            -> screen_observe / actions / ops / task
            -> cua-driver（每次调用一个子进程）
       -> 输出 schema 校验（宿主）
  -> tool/result 写入 session
  -> 下一 step

S4 eval:
  cleanup -> setup（Notepad 标签集校验）-> dsh headless -> oracle -> cleanup（dirty/leftover）
```

## 2. 宿主启动与工具面

- 启动器只解析 `--profile/--patch`；其余参数交给 headless app。
- patch 层序：profile bundles → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch` overlays → telemetry disable。`evals/headless-patch.yml` 重新启用 `credentials` 并插入本插件。
- 插件从 profile 的 `node_modules/dsh-win-computer-use`（junction 到仓库）解析；`inject=['tools']` 使 fiber 等 ToolsService。
- `apply()`：
  - 重置 dedup/task 预算；
  - 归一化 Config；
  - fire-and-forget `start_session` + 光标主题；
  - 建立 stop latch 与 `wrap()`；
  - **一次性编译全部工具**；任一 schema 非法会让整行 apply 失败，dsh 只 warning，随后没有桌面工具。
  - 只注册 surface 可见子集：
    - `dispatcher`：`computer_do` + `screen_observe`（隐藏 20）；
    - `hybrid`：再加 click/type/key/scroll/verify（隐藏 15）。
- 隐藏工具只存在于 `computer_do` 的闭包；`computer_do({action:'call'})` 直接 `def.execute`，绕过宿主 output schema/timeout/post-execute，只透传 `ok/result/image`。
- 宿主把插件返回的 `{ok:false}` 仍看作成功的 tool result（`isError` 不置位）；只有参数/输出 schema 错误是 host error。**失败语义必须由回执文字自己承担。**
- 同一会话工具列表稳定；每步重建 system prompt 但工具列表不变，保护 prompt cache。
- 插件没有声明 `timeoutMs`；驱动挂死会一直占用 step，只有 runner 的 timeout/taskkill 能结束。

## 3. 观察 pipeline

```text
pickObserveTarget
  -> list_windows(on_screen_only)
  -> check_permissions（30s 缓存，避免每次观察固定多付 ~2s）
  -> get_window_state(include_screenshot?, max_elements, query?)
  -> rawElements.filter(isActionable)
  -> resolveObserveMode(ax/native/vision/desktop fallback)
  -> markStructuralPasswords（Windows sidecar，最多 5s）
  -> diffObserve（标题/输入值/状态栏/元素增删；必须在密码标记之后）
  -> consumedBefore / suspectBefore
  -> cacheSnapshot（x/y 已减 screenOrigin）
  -> mapElementsForModel（含 value）
  -> renderLine / renderObserveText（含“自上次观察”差分与输入框/菜单提示）
  -> dedupEvaluate（suspect 时强制全量；stub 复用 elements + 关键控件）
  -> observePayload（changedSinceLast / changes）
```

- 文本 `@(x,y)`、结构化 `elements.x/y`、快照条目 x/y、`computer_click` 输入统一为 window-screenshot-px。
- 输入类角色（Edit/ComboBox/Spinner/Slider/AXTextField）同时输出 `value`：文本行 `值="..."`，结构化 `elements.value`；密码只显示 `值=•••`（实际为空），Document/AXTextArea 不展示正文。
- 状态差分只保留一行：`自上次观察：标题 “a” → “*a”；[1] 输入框 “seed” → “note”；[2] 文本 “0 个字符” → “33 个字符”；[3] 输入框 值变化（隐藏）`。时间/行列噪声按 `normalizeForHash` 归一；文档正文只报“文档内容变化”。
- 缺 `bounds` 时：`screenOrigin=null`、`coordinateSpace=screen-physical-px`，头部明确警告“不要直接点击”。
- 同 pid 多窗口：`window_id` 精确匹配优先；否则按 on-screen、z_index、标题具体度排序。同标题匹配多个窗口时头部/降噪 stub 都明确提示 `目标匹配 N 个窗口`，要求改用 `window_id`。
- 权限面 30s 缓存；`apply`/降级时清空。去重仍发生在驱动工作之后，但 stub 现在带关键控件，模型不必为“编号在哪”再 force/native。
- 未找到目标、窗口级观察失败、桌面降级、native 失败：清空旧快照，避免动作继续落到旧窗口。
- `dedupEvaluate` 的 suspect 必须在 `cacheSnapshot` 之前捕获；安装新快照会清 suspect。

## 4. 动作、投递与回执

```text
humanAction / type / key / scroll / drag / set_value
  -> validateSnapshotId
  -> freshnessGate（必须在投递前）
  -> resolveToken / resolveWindow / resolveClickTarget（元素点击也检查 TTL）
  -> describeClickTarget（回执回显：编号/角色/标签/最近元素）
  -> humanClick: glideCursor（auto 单次 / human 5 段 / off 不动）
  -> cuaDeliver
       L1 background
       L2 foreground（background_unavailable）
       L3 bring_to_front + foreground retry + restore
       （force/foreground 遇到 foreground_unavailable 也走 L3）
  -> normalizeMcp
  -> engineRefusal / deliveryFailure / isUnverified
  -> settleAction
       -> receipt / refusalReceipt（含目标回显）
       -> markConsumed / markSuspect
```

### 4.1 坐标、滑行与重复点击

- 快照条目 x/y = driver frame 中心减窗口原点；元素点击的 token 路径不依赖坐标，但可视滑行使用该坐标。
- token 点击 payload 也带 `window_id`：Win11 记事本单进程多窗口（主窗/另存为/覆盖确认同 pid），只带 pid 时 L3 `bring_to_front` 可能选错窗口。
- `cursorMotion`：
  - `auto`（默认）：前景最多 1 次 `move_cursor`，不查 `get_cursor_position`；
  - `human`：保留 1 次 `get_cursor_position` + 5 段 `move_cursor` 弧线（演示用）；
  - `off`：所有点击不滑行；
  - background 投递在任何模式下都不滑行。
- 同窗口同目标 16px/2s 内再次点击：完全跳过滑行（连续点击同一按钮不再产生一串小段移动）。
- `actionGuard`（默认 `on`）：同一窗口 + 同一目标 + 同一投递模式 + 同一 count，5s 内重复，且期间观察未报告变化 → `[repeat_suppressed]`，不消耗快照。观察到变化会清除该窗口的重复计数；`double_click` 不拦。
- `count:3` 不会自动变成三次点击；它是一次 `click` payload 的 count 参数，是否支持取决于驱动/目标。

### 4.2 投递失败

- `deliveryFailure(value)` 识别 `background_unavailable`、`foreground_unavailable`、`delivery_failed`。
- `settleAction` 在这类值上返回 `ok:false`，不消费快照；`delivery_failed` 另标 suspect。
- 普通 `effect:unverifiable` 仍是“已送达但未验证”：`ok:true` + `UNVERIFIED_NOTE`（先观察、界面已变勿重复；确认未变再考虑 foreground）。
- 强制前台（`foreground:true` / `deliveryMode=foreground`）遇到 `foreground_unavailable` 时，只要 payload 有 `pid+window_id`，同样执行一次 L3：`bring_to_front` → 前台重试 → 恢复原前台。hotkey 也适用；XAML Accelerator 拒绝不升级。
- L3 只有 retry 不是 delivery failure/refusal 时才写“重试完成”；否则写“重试仍未送达”。

### 4.3 动作回执

- 每次点击回执回显目标：`（目标 ≈ [3] 按钮 "否(N)" @(465,171)）`。坐标点击按快照条目中心 24px 内取最近元素；元素点击回显编号/角色/标签/当前值。这样点错按钮（例如把“否”当“是”）在回执里立刻可见。
- 输入/设值同样回显目标元素或窗口焦点。
- 回执文字是模型唯一可靠的状态证据：目标回显 + 下一次观察差分共同承担“动作是否生效”。

### 4.4 快照语义

- 默认 `supersession: note`：同一快照可连续动作，只附一致性注记。
- `enforce`：已消费快照的第二次动作被拒绝；所有动作应在投递前求值。
- 元素点击现在同样受 TTL 约束；过期直接 `[snapshot_expired]`。
- `markConsumed` 只记录最后一次动作；`markSuspect` 表示状态不确定，不阻断后续动作。

## 5. 快捷键/XAML

- 组合键 → `hotkey`；无修饰键 → `press_key`。
- 两类 XAML 失败：4s UIA 超时；`could not find a UIA AcceleratorKey`（命令在关闭菜单）。
- 默认 `xamlKeyFallback: off`：返回“点菜单栏项 → 点菜单项”的可执行指引。
- `auto`：白名单组合；快照中唯一菜单栏项 → 后台 token 点击 → 轮询同 pid 窗口 → 唯一菜单项点击；歧义/缺失即停；成功后清空快照；不处理另存为/覆盖对话框。
- 没有菜单栏的对话框（另存为/打开/属性）不再误报“没有编辑菜单”：
  - 未前台：先建议 `foreground:true` 重试一次；
  - 已前台：不再重复“用 foreground”，改为“点击输入框（element=编号）→ computer_type(element=编号, text=完整内容）”；
  - `xamlKeyFallback=auto` 且已前台时，对 ctrl+a/c/v/x/z 额外尝试一次 `press_key`（带 modifiers + window_id，前台）作为实验性回退；成功/未验证回执要求先观察输入框当前值。
- 对话框里 hotkey 的失败是“UIA 加速器不存在”，与 `foreground_unavailable` 是两类问题；后者仍走 force 前台 L3。

## 6. Eval / Notepad 生命周期

```text
cleanup -> setup -> dsh headless -> oracle -> cleanup
```

- `Open-TestNotepad`：
  - **preflight**：若已存在任何 Notepad 窗口（且不是本任务显式允许的第一个 HWND），直接 fail closed，**不启动**——避免把测试文档作为标签加进用户窗口；
  - 先 `Close-OrphanTestNotepads` 回收上次遗留的测试窗口；
  - 启动 seed；等待标题与标签集稳定；
  - 记录 pid、process start、tabs、expectedTabs、safeToClose；
  - 必须是新 HWND、精确标签集、全部未修改；否则 setup fail closed。
- `Close-TestNotepad`：
  - 按精确 HWND 查找（不看标题）；
  - 校验 pid/start time；
  - 重新枚举标签，必须等于 expectedTabs 且无 modified/unknown；cleanup 传 `-AllowDiscardTestOnlyModified` 时，允许丢弃“全部标签都在任务 allowedTabs 内”的测试修改（用户标签仍失败并留窗）；
  - 通过后先关闭 owned 模态对话框（`Get-OwnedWindows`，GW_OWNER=测试 HWND；标签已证明全是测试文件），否则主窗关闭会被忽略、`另存为` 残留；
  - 关闭优先 `UIA WindowPattern.Close`，WM_CLOSE 仅兜底：Win11 Notepad 对非提权客户端的 WM_CLOSE 会静默忽略（2026-11-15 实测）；修改中的测试文档由 `Dismiss-TestSavePrompt` 点“不保存”；
  - 只有 safeToClose 才关闭；否则留窗并写 `_leftovers/<task>-<stamp>.json`。
- `Close-OrphanTestNotepads`：全局测试文件名白名单 + 至少一个唯一 seed（或进程启动时间晚于 eval 备份时间）；只有全部标签都是测试文件才关闭，用户标签/未知后缀/通用名单独出现时留窗报告。空的无标题窗口仅在 eval 期间创建时才关。
- Win11 Notepad 会从 `TabState/*.bin` 恢复上次会话；**新 HWND 不等于干净窗口**。当前 t01 窗口曾出现 8 个标签：2 个用户已修改文档 + 6 个测试文件。
- `evals/lib/tabstate.ps1 backup|restore`：eval 前把用户 TabState 全部 bin 备份到 `~/.dsh/s4-evals/_tabstate-backup/`，每个任务启动前删除上一个任务留下的 eval bin（`Clear-TestTabStateForLaunch`），跑完 restore。没有这层隔离，任务 N 的 seed/draft/workfile 会被任务 N+1 恢复，形成跨任务污染。
- `Close-TaskWindows` 只接受显式 patterns；无 patterns 不关闭任何窗口。
- cleanup JSON 带 `dirty`；留窗不会删 state 副本（leftover 文件在任务沙箱外）。
- `headless-run.mjs` 消费 `cleanup.dirty`：记录 `rec.dirty`，pass 改记为 `dirty`，汇总打印 `dirty=N`，退出码非 0——不再把“留窗/残留对话框”当干净通过。
- `headless-run.mjs` / `verify-oracles.mjs` 在任何 setup 前调用 `tabstate.ps1 backup`，全部任务后 `restore`；备份失败（Notepad 正在运行）直接退出 2，restore 失败保留 backup 路径并退出非 0。备份/恢复结果写入 headless 报告 `tabState`。

## 7. 会话日志与诊断

- 权威日志：`~/.dsh/sessions/<projectKey>/<sessionId>/session.v4.jsonl.zstd`。
- 文件是**多 zstd frame 拼接**；逐 frame 解压后按行 JSON 解析。`zstdDecompressSync` 一次性解多 frame 的行为不可依赖。
- 关键事件：
  - `tool/call`：`data.name` + `data.arguments`；
  - `tool/result`：`data.message.toolCallId` + `content`；
  - `assistant/message`：模型文本/工具调用块；
  - `step/start|end`、`request/header`（工具列表快照）。
- 隐藏工具没有嵌套 `tool/call`；从 `computer_do` 的 `arguments.tool` 归因。
- `--json` stdout 是截断视图（8KiB 字符串/32KiB 行，丢图片、丢 replacement）；完整复盘用 session 文件。
- 命令：
  - `node evals/analyze-sessions.mjs`（已支持 v4 多 frame + 隐藏工具归因）；
  - 手工解压：逐帧 `zstdDecompressSync` 后拼接。

## 7.1 CU 轨迹监控（trajectory）

- 开启：`trajectoryFile: <path>.jsonl` 或环境变量 `DSH_CU_TRAJECTORY_FILE`；默认关闭。
- 写入端简化（避免把用户文档/长树写进日志）：
  - `type`/`set_value`/`clipboard`/`computer_task` 的文本只记 `len` + 12 位 SHA-1；
  - `get_window_state` 只记元素数/快照 id/是否有截图，不记整棵树；
  - `list_windows` 只记数量 + 前 8 个窗口的 pid/id/app/title/z（title 截断）；
  - 每个工具一个 id，驱动调用通过 AsyncLocalStorage 归属到父工具。
- 事件：`session_start`、`tool_start`、`tool_end`、`driver`、`loop`、`session_end`。
- `computer_do` 外壳透明：只记录内层真实工具；`summary.tools` 不再把 58 次调用显示成 115。
- `tool_end` 带 `unverified` / `observeStub` 标记；摘要增加 `unverified`、`observeStubs`、`toolAvgMs`、`deliveryModes`、`movesPerClick`。
- 自动 loop 标记：
  - `repeat_action` / `repeat_observe`：60s 内同一签名≥3 次；
  - `observe_burst`：连续≥3 次观察没有动作；
  - `relocate_ratio`：观察/动作≥2.5 且动作≥5；
  - `pointer_burst`：3s 内≥20 次 `move_cursor`。
- 分析：`node evals/analyze-trajectory.mjs <file>`（或 `npm run trajectory:analyze`）；输出观察/动作、stub、unverified、拖慢工具、每次点击移动数。
- eval 集成：`headless-run.mjs` 为每次 dsh 运行设置 `DSH_CU_TRAJECTORY_FILE=<task>-r<n>.trajectory.jsonl`，报告里记录 `trajectory` 路径。

## 8. 当前已知的 loop 放大点

| 点 | 现状 | 本轮处理 |
|---|---|---|
| 元素点击绕过 TTL | 已修：`resolveClickTarget` 检查 `isFresh` | ✅ |
| 快照条目屏幕坐标 | 已修：`cacheSnapshot` 减 `screenOrigin` | ✅ |
| 投递失败 `ok:true` | 已修：`deliveryFailure` → `ok:false` | ✅ |
| L3 假成功注记 | 已修：检查 retry 值 | ✅ |
| 后台点击也滑行 | 已修：`cursorMotion` + 近距离不画弧 | ✅ |
| 对话框 fallback 误导 | 已修：无菜单栏时给 foreground 指引；已前台不再重复建议 foreground | ✅ |
| 另存为文件名盲区 | 已修：输入类 `value` 进入文本/结构化/差分（密码隐藏） | ✅ |
| unverifiable 无状态证据 | 已修：`自上次观察` 标题/值/字符数差分 + `changedSinceLast` | ✅ |
| 点错按钮不自知 | 已修：动作回执回显目标（最近元素/编号/标签/当前值） | ✅ |
| 连续点同一目标 | 已修：`actionGuard` 5s 重复抑制 + 观察变化清除 | ✅ |
| 强制前台绕过 L3 | 已修：force + `foreground_unavailable` 也走 bring_to_front（精确 window_id） | ✅ |
| 5 段滑行 15–18s/点击 | 已修：`auto` 单次移动；`human` 保留 5 段；同目标 2s 跳过 | ✅ |
| 轨迹计数翻倍 | 已修：`computer_do` 透明；新增耗时/未验证/stub/每次点击移动数 | ✅ |
| 每次观察重复 check_permissions | 已修：30s 缓存 | ✅ |
| 同标题多窗口静默取最前 | 已修：头部/stub 警告“匹配 N 个，改用 window_id” | ✅ |
| 残留另存为对话框 | 已修：cleanup 先关 owned 对话框；runner 消费 dirty | ✅ |
| 观察失败保留旧快照 | 已修：清空 | ✅ |
| suspect 去重 stub | 已修：`suspectBefore` 强制全量 | ✅ |
| Notepad 新窗口含用户标签 | 已修：标签白名单 + fail closed + leftover | ✅ |
| `computer_menu` 无 effect 仍可能成功 | P2 | 未处理 |
| `computer_do` 丢结构化字段 | P2 | 未处理 |
| runner cleanup 永远 Ok | 已加 `dirty`；runner 尚未消费 | P2 |
| t03/wa2/t07 宽匹配 | P2 | 未处理 |

## 9. 失败语义速查

| 驱动回执 | `ok` | 快照 | 模型应做什么 |
|---|---|---|---|
| `effect:confirmed` | true | consumed | 继续 |
| `effect:unverifiable` | true | consumed + suspect | 先 observe 确认 |
| `suspected_noop` | false | suspect（不 consume） | 先 observe |
| `background_unavailable` | false | 不 consume | foreground=true 重试 |
| `foreground_unavailable` | false | 不 consume | 先让目标前台/换控件 |
| `delivery_failed` | false | suspect | 先 observe，必要时 foreground |
| `refusal` / `error` | false | 不 consume | 按拒绝原因处理 |
| `snapshot_expired` | false | cleared | 重新 observe |
