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
  -> check_permissions
  -> get_window_state(include_screenshot?, max_elements, query?)
  -> rawElements.filter(isActionable)
  -> resolveObserveMode(ax/native/vision/desktop fallback)
  -> markStructuralPasswords（Windows sidecar，最多 5s）
  -> consumedBefore / suspectBefore
  -> cacheSnapshot（x/y 已减 screenOrigin）
  -> mapElementsForModel
  -> renderLine / renderObserveText
  -> dedupEvaluate（suspect 时强制全量）
  -> observePayload
```

- 文本 `@(x,y)`、结构化 `elements.x/y`、快照条目 x/y、`computer_click` 输入统一为 window-screenshot-px。
- 缺 `bounds` 时：`screenOrigin=null`、`coordinateSpace=screen-physical-px`，头部明确警告“不要直接点击”。
- 同 pid 多窗口：`window_id` 精确匹配优先；否则按 on-screen、z_index、标题具体度排序。
- 去重发生在所有驱动工作之后：只省模型文本，不省 `list_windows/get_window_state/密码扫描` 的时间。
- 未找到目标、窗口级观察失败、桌面降级、native 失败：清空旧快照，避免动作继续落到旧窗口。
- `dedupEvaluate` 的 suspect 必须在 `cacheSnapshot` 之前捕获；安装新快照会清 suspect。

## 4. 动作、投递与回执

```text
humanAction / type / key / scroll / drag / set_value
  -> validateSnapshotId
  -> freshnessGate（必须在投递前）
  -> resolveToken / resolveWindow / resolveClickTarget（元素点击也检查 TTL）
  -> humanClick: glideCursor（click/double/right；background 可跳过）
  -> cuaDeliver
       L1 background
       L2 foreground（background_unavailable）
       L3 bring_to_front + foreground retry + restore
  -> normalizeMcp
  -> engineRefusal / deliveryFailure / isUnverified
  -> settleAction
       -> receipt / refusalReceipt
       -> markConsumed / markSuspect
```

### 4.1 坐标与滑行

- 快照条目 x/y = driver frame 中心减窗口原点；元素点击的 token 路径不依赖坐标，但可视滑行使用该坐标。
- `glideCursor`：1 次 `get_cursor_position` + 5 段 `move_cursor`；距离 <4px 时只做一次终点移动；弧高随距离缩放。
- `cursorMotion`：
  - `auto`（默认）：background 且未 `foreground:true` 不滑行；前台保留轨迹；
  - `off`：所有点击不滑行。
- `count:3` 不会自动变成三次点击；它是一次 `click` payload 的 count 参数，是否支持取决于驱动/目标。

### 4.2 投递失败

- `deliveryFailure(value)` 识别 `background_unavailable`、`foreground_unavailable`、`delivery_failed`。
- `settleAction` 在这类值上返回 `ok:false`，不消费快照；`delivery_failed` 另标 suspect。
- 普通 `effect:unverifiable` 仍是“已送达但未验证”：`ok:true` + `UNVERIFIED_NOTE`。
- L3 只有 retry 不是 delivery failure/refusal 时才写“重试完成”；否则写“重试仍未送达”。

### 4.3 快照语义

- 默认 `supersession: note`：同一快照可连续动作，只附一致性注记。
- `enforce`：已消费快照的第二次动作被拒绝；所有动作应在投递前求值。
- 元素点击现在同样受 TTL 约束；过期直接 `[snapshot_expired]`。
- `markConsumed` 只记录最后一次动作；`markSuspect` 表示状态不确定，不阻断后续动作。

## 5. 快捷键/XAML

- 组合键 → `hotkey`；无修饰键 → `press_key`。
- 两类 XAML 失败：4s UIA 超时；`could not find a UIA AcceleratorKey`（命令在关闭菜单）。
- 默认 `xamlKeyFallback: off`：返回“点菜单栏项 → 点菜单项”的可执行指引。
- `auto`：白名单组合；快照中唯一菜单栏项 → 后台 token 点击 → 轮询同 pid 窗口 → 唯一菜单项点击；歧义/缺失即停；成功后清空快照；不处理另存为/覆盖对话框。
- 没有菜单栏的对话框（另存为/打开/属性）不再误报“没有编辑菜单”，而是建议：
  - `foreground:true` 重试按键；
  - 或 foreground 点击输入框后 foreground type。

## 6. Eval / Notepad 生命周期

```text
cleanup -> setup -> dsh headless -> oracle -> cleanup
```

- `Open-TestNotepad`：
  - 启动前记录 HWND；
  - 启动 seed；
  - 等待标题与标签集稳定；
  - 记录 pid、process start、tabs、expectedTabs、safeToClose；
  - 必须是新 HWND、精确标签集、全部未修改；否则 setup fail closed。
- `Close-TestNotepad`：
  - 按精确 HWND 查找（不看标题）；
  - 校验 pid/start time；
  - 重新枚举标签，必须等于 expectedTabs 且无 modified/unknown；
  - 只有 safeToClose 才 `WM_CLOSE`；否则留窗并写 `_leftovers/<task>-<stamp>.json`。
- Win11 Notepad 会从 `TabState/*.bin` 恢复上次会话；**新 HWND 不等于干净窗口**。当前 t01 窗口曾出现 8 个标签：2 个用户已修改文档 + 6 个测试文件。
- `Close-TaskWindows` 只接受显式 patterns；无 patterns 不关闭任何窗口。
- cleanup JSON 带 `dirty`；留窗不会删 state 副本（leftover 文件在任务沙箱外）。

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
- 自动 loop 标记：
  - `repeat_action` / `repeat_observe`：60s 内同一签名≥3 次；
  - `observe_burst`：连续≥3 次观察没有动作；
  - `relocate_ratio`：观察/动作≥2.5 且动作≥5；
  - `pointer_burst`：3s 内≥20 次 `move_cursor`。
- 分析：`node evals/analyze-trajectory.mjs <file>`（或 `npm run trajectory:analyze`）。
- eval 集成：`headless-run.mjs` 为每次 dsh 运行设置 `DSH_CU_TRAJECTORY_FILE=<task>-r<n>.trajectory.jsonl`，报告里记录 `trajectory` 路径。

## 8. 当前已知的 loop 放大点

| 点 | 现状 | 本轮处理 |
|---|---|---|
| 元素点击绕过 TTL | 已修：`resolveClickTarget` 检查 `isFresh` | ✅ |
| 快照条目屏幕坐标 | 已修：`cacheSnapshot` 减 `screenOrigin` | ✅ |
| 投递失败 `ok:true` | 已修：`deliveryFailure` → `ok:false` | ✅ |
| L3 假成功注记 | 已修：检查 retry 值 | ✅ |
| 后台点击也滑行 | 已修：`cursorMotion` + 近距离不画弧 | ✅ |
| 对话框 fallback 误导 | 已修：无菜单栏时给 foreground 指引 | ✅ |
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
