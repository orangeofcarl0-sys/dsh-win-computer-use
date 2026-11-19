# TROUBLESHOOTING — 按症状排障

> 目的：按失败阶段定位问题，而不是凭错误文本猜。错误码定义见 [ERRORS](ERRORS.md)，Windows 底层原因见 [WINDOWS](WINDOWS.md)。
> 读者：使用者、排障者。
> 状态：当前实现（最后核对 2026-11-18）。
> 相关：[INSTALL](INSTALL.md) · [CONFIGURATION](CONFIGURATION.md) · [DRIVER-SDK](DRIVER-SDK.md)。

## 1. 决策树

```text
工具调用失败
  ├─ 驱动能启动吗？
  │    ├─ 否 → 安装/路径/daemon/contract（§2）
  │    └─ 是
  ├─ 目标窗口找到了吗？
  │    ├─ 否 → window/window_id/候选/关闭（§3）
  │    └─ 是
  ├─ 观察成功了吗？
  │    ├─ 否 → 权限/树空/desktop-visual/native 拒绝（§4）
  │    └─ 是
  ├─ 有可用快照吗？
  │    ├─ 否 → snapshot_missing/expired/mismatch/query（§5）
  │    └─ 是
  ├─ 动作送达了吗？
  │    ├─ 否 → background/foreground/delivery_failed/UIPI（§6）
  │    └─ 是
  └─ 动作生效了吗？
       ├─ 不确定 → unverifiable/suspected_noop/回读/verify（§7）
       └─ 确定但结果不对 → 目标/坐标/通道（§8）
```

## 2. 进程与驱动

| 现象 | 常见原因 | 处理 |
|---|---|---|
| `cua-driver not found` / `spawn` | 未安装、不在 PATH | 设 `CUA_DRIVER_BIN`；`cua-driver --version` 确认 |
| 启动即失败 | daemon 未运行/挂死 | `cua-driver status`；`cua-driver stop` 后 `autostart kick` |
| `contract version X does not match SDK Y` | CLI 与 daemon 不同版本 | 两者一起升级并重启 daemon；不要只升一侧 |
| 所有工具 schema 错误/整树不加载 | 工具定义未用 `defineTool()` 返回值，或包不完整 | 用 headless 真机探针确认；离线假注册表不校验 schema |
| 工具调用卡住不返回 | 驱动挂死；插件未声明 `timeoutMs` | 结束当前 run/step；重启 daemon；检查 `CUA_CALL_TIMEOUT_MS` |

## 3. 窗口选择

| 现象 | 常见原因 | 处理 |
|---|---|---|
| 指定窗口未找到 | 标题变化/窗口关闭/pid 不对 | 工具 fail-closed 并列候选；用 `window_id` 重选；不会回退最前窗口 |
| 同标题多窗口选错 | 多个“另存为”/同 pid 多窗口 | 用 `window_id`；头部会提示“匹配 N 个窗口” |
| 把数字塞进 `window` | `window` 只接受 pid/标题子串 | 纯数字按 pid 解释；window_id 用独立参数 |
| 观察到自己插件的覆盖层 | `Cua.AgentCursorOverlay*` / Codex overlay | 目标选择已过滤；显式指定 overlay 会报专门错误 |
| 目标最小化/不可见 | 窗口不在屏 | 先 `computer_activate`；仍失败换普通窗口 |

## 4. 观察模式

| 现象 | 常见原因 | 处理 |
|---|---|---|
| `visualOnly` / `desktop-visual` | 窗口级观察被权限/UIPI/引擎拒绝，降级为桌面采集 | 桌面坐标不能直接用于窗口动作；换普通窗口或重试窗口观察 |
| AX 树为空 | 自绘/Canvas/Electron 内容区不暴露树 | `mode:"native"` 或 `mode:"vision"`；坐标路径 best-effort |
| `native` 被拒 | 当前模型未声明 image 输入 | 换视觉模型，或用 `mode:"vision"` |
| native 超附件限额 | 截图超过 `maxImageDimension`/`maxImagePixels`/字节限额 | 改 ax/vision 或 `screen_zoom`；`compact` 当前必然失败 |
| `screen_zoom` 返回空图/不可读 | 区域太小、JPEG 有损、窗口不可见 | 放大裁剪；读文字改 native；`x2-x1 ≤ 500` |
| 视觉观察者失败 | `ctx.llm` 无凭据/模型不支持 image；GLM 无 key | 回执会显示观察者/降级原因；配置 `visionProvider`/`visionModel` 或 GLM key |
| 坐标偏移/点错列 | 按预览尺寸估坐标；混合 DPI | `@(x,y)` 是原图像素；用 `screen_zoom + from_zoom=true`；element 路径优先 |

## 5. 快照

| 现象 | 常见原因 | 处理 |
|---|---|---|
| `[snapshot_missing]` | 动作前没有全量观察；query 不建快照 | 不带 `query` 重新 `screen_observe` |
| `[snapshot_expired]` | 超过 `ttlMs`（默认 60s） | 重新观察；长流程调大 `ttlMs` 或分段 |
| `[snapshot_mismatch]` | 用了旧/别的窗口的 `snapshot_id`；快照是全局单例 | 用最新观察 id；拒绝文本带当前 app/title/pid/window_id |
| `[snapshot_consumed]` | `supersession: enforce` 下同快照第二次动作 | 重新观察，或改 `note` |
| `[snapshot_stale_tokens]` | 0.23.2 像素预取替换了 index map | 重新观察后再用编号；纯坐标仍可 |
| `[index_out_of_range]` | 编号不属于当前快照 | 重新观察取新编号 |
| query 后动作失败 | query 只读且清除了旧快照 | 已明确提示；重新全量观察 |

## 6. 投递

| 现象 | 常见原因 | 处理 |
|---|---|---|
| `background_unavailable` | Chromium/Electron/GTK/VCL 丢弃后台事件 | `deliveryMode: auto` 自动前台；或单次 `foreground:true` |
| `foreground_unavailable` | Windows 前台锁；对话框/目标未前台 | 自动 L3；仍失败先 `computer_activate`；不要重复非幂等动作 |
| `delivery_failed` | 投递未确认（后台按键常见） | 先 observe；必要时 foreground 重试一次 |
| 回执有 `background_delivery_failed` 但文字已进入 | 这是升级建议，不是硬失败 | 以 `effect`/回读为准；不要重复输入 |
| 强制前台动作很慢/重复执行 | `foreground:true` 的 click/scroll/drag 先前置、只执行一次 | 不要默认开 foreground；重复执行是旧版 L3 重试的行为，已修 |
| `Ctrl+V` 只落 `v` | 后台 synthetic 不更新 OS 修饰键状态 | 组合键已自动前台；仍异常先 activate 再试一次 |
| UIPI 高权限目标失败 | 中完整性 helper 不能向 High IL 注入 | 不要按进程名杀；提示用户手动处理 |

## 7. 动作是否生效

| 现象 | 判断 | 处理 |
|---|---|---|
| `effect:unverifiable` | 已送达但驱动无法确认 | `screen_observe` 看差分；或用 `computer_verify` |
| `suspected_noop` | 引擎受理但怀疑未生效 | 不要立即重放；先 observe，再决定 |
| 输入后界面没变 | 通道不对/焦点不对/输入被忽略 | 指定 element 走 ValuePattern；或点控件后输入 |
| 输入回读不一致 | 部分写入/错字/焦点丢失 | 回执只报长度；修正后 `inputUnconfirmed` 解除；保存意图被拦 |
| 保存对话框反复出现 | 文件名框旧值被隐藏/点错按钮 | 观察输入框 `值="..."`；点“保存”前确认路径 |
| 另存为文件名变成旧值+新值 | `computer_type` 是追加输入，不是覆盖 | 预填字段优先 `computer_set_value`；`ctrl+a` 在 WinUI 对话框可能不可用 |
| 点击后 30s 超时、对话框卡住 | 模态对话框让驱动/UIA 等待 | 回执是“结果未知”：先 observe 新顶层对话框，用其 window_id 重新观察；不要重试像素/zoom/drag；原生 MessageBox 可用 Escape/Enter |
| 菜单 `effect:unverifiable` | 菜单可能已开/未开 | 不要重复点同一项；先 observe 看弹出菜单 |
| `app_launch` 后关不掉 | 子进程可能为 High IL + UIPI；0.52.13 的 PowerShell 实测为 Medium，不能一律假定 | 先读子进程 IL；高完整性窗口提示用户手动关闭，不要按进程名杀 |

## 8. 目标与通道

| 现象 | 常见原因 | 处理 |
|---|---|---|
| Explorer 文件项单击后打开了文件 | 后台坐标点击走 UIA Invoke | 单选传 `foreground=true`；多选 Ctrl+click 已自动前台 |
| 点错按钮 | 坐标取最近元素/预览缩放 | 回执会回显目标；用 element 或 zoom |
| WinUI 组合键 4s 超时/找不到 AcceleratorKey | 命令在关闭菜单里（#3908） | 点菜单栏项 → 观察 → 点菜单项；`xamlKeyFallback: auto` 实验性 |
| `menu_path_unavailable` | XAML 菜单驱动走不到 | 改点控件；不要回退像素 |
| `computer_menu` 路径含 `->`/`→` 失败 | 旧版本只认 `/`、`›`、`>` | 已归一化 `->`/`→`；仍失败就用数组或点菜单栏 |
| Win+R 打开 Command Palette 而不是 Run | 本机策略把 Win+R 映射到 CmdPal；其 AX 为空、不能前台激活 | 用 `app_launch`/开始菜单启动应用；不要在 CmdPal 上反复输入 |
| 拖动没反应 | 目标不接受后台 drag/坐标偏移 | 先激活/聚焦；必要时 `foreground=true`；modifier 在 0.39+ 走原生，否则走私有 helper |
| 拖动后窗口位置变了 | 起点落在标题栏，drag 移动了窗口 | 回执会提示“起点在标题栏”；重新 observe，不要把它当点击/落点证据 |
| 私有拖拽报 `[private_drag_zoom_unsupported]` | 私有路径不复刻 zoom | 用窗口截图坐标重发 |
| 私有拖拽报 `[private_drag_no_frame]` | 快照缺 screenOrigin/截图尺寸 | 全量 observe（不要 query）再拖 |

## 9. 评测与清理

| 现象 | 常见原因 | 处理 |
|---|---|---|
| setup fail closed | 已有用户 Notepad/标签，或新窗口恢复 TabState | 不要杀进程；按提示保存/关闭用户标签；TabState 备份/恢复 |
| cleanup `dirty` | 无法证明测试窗口归属/有残留对话框 | 记录 leftover；人工检查；不要把 dirty 当 pass |
| 测试窗口关不掉 | Win11 Notepad 单进程多标签/UIPI | 按 HWND/标签证明归属；WM_CLOSE 只兜底；绝不按进程名杀 |
| `Add-Type` 找不到 `C:\Windows\TEMP\*.cs` | `TEMP` 指向系统目录 | 跑 eval 前把 `TEMP`/`TMP` 指到 `%LOCALAPPDATA%\Temp` |
| 截图断言 0B | 选中 `0×0` shell 弹窗 | 选择窗口要求 `bounds > 0`；排除驱动自身窗口 |

## 10. 需要更多证据时

- `verboseReceipts: true`：动作回执附原始 JSON。
- `trajectoryFile` 或 `DSH_CU_TRAJECTORY_FILE`：写 JSONL；用 `node evals/analyze-trajectory.mjs <file>` 看观察/动作、stub、未验证、重复、指针移动。
- 会话日志：`~/.dsh/sessions/<projectKey>/<sessionId>/session.v4.jsonl.zstd`；多 zstd frame，逐帧解压后按行解析。
- 原始证据按日期归档在 [EVIDENCE](EVIDENCE.md)；当前矩阵见 [VERIFICATION](../VERIFICATION.md)。
