# WINDOWS — Windows 工程细节与验证指南

> 适用：Windows 10/11。本文记录本仓库在真机上踩过的 Windows 特性、验证步骤与清理规则。
> 通用使用说明见 [README](../README.md)；结构见 [ARCHITECTURE](ARCHITECTURE.md)。
> 最近一次真机环境：Windows 11 x64 · DPI 150% · cua-driver 0.23.2 · dsh 0.2.2-rc.1。

## 1. 前置与完整性级别

| 项 | 事实 | 后果 |
|---|---|---|
| `cua-driver.exe` | 二进制清单 `requireAdministrator`，daemon 以 High IL 运行 | 插件以固定 argv spawn 它；驱动自身可能需要 UAC/已提升的 daemon |
| `app_launch` 子进程 | 继承驱动的高完整性级别（High IL） | 非提权客户端 `taskkill` / `Stop-Process` / `PostMessage(WM_CLOSE)` 都可能被 UIPI 拒绝 |
| 对照：同一 shell 直接 `Start-Process notepad` | Medium IL | 说明 High IL 来自驱动链，不是“启动方式随便造成的” |
| 驱动操作自己启动的 High IL 窗口 | 实测可行（提权记事本 `computer_type` 成功且 `effect:confirmed`） | “管理员窗口一律不可操作”的说法不成立；要按目标与通道分别判断 |
| WinUI/XAML 目标关闭 | `alt+f4` 可能撞 UIA 加速器超时（#3908）；`invoke_menu` 可能 `menu_path_unavailable` | 连驱动侧关闭通道也可能断，只能人工收尾 |

**实践建议**：评测/自动化优先操作**已在运行的普通应用**；确需 `app_launch` 时，接受“该窗口可能需要人工关闭”的成本。不要按进程名杀记事本——见 §6。

## 2. 前台锁与三级投递

Windows 的 `ForegroundLockTimeout` 会让 `SendInput` 在目标未前台时静默打空，且不一定报错。插件的 `deliveryMode: auto` 按下面的梯子处理：

```text
L1 background（UIA Invoke / PostMessage，不抢焦点）
  └─ background_unavailable
       └─ L2 foreground（驱动激活 → SendInput → 恢复）
            └─ foreground_unavailable
                 └─ L3 bring_to_front（AttachThreadInput 绕锁）
                      → 目标动作（foreground）
                      → bring_to_front(previous_fg_hwnd) 恢复原前台
```

关键点：

- L3 也会在“L1/L2 返回 `unverifiable` 且工具是 click/scroll/drag 且有 pid”时触发——SendInput 可能已进系统队列但打到了错误前台。
- `hotkey` **不做 L3**：XAML 目标的 UIA 加速器先验拒绝，重试同样失败，只会增加副作用；回执会说明。
- 没有 `pid` 的 desktop-scope 调用没有窗口可绕锁，不升级。
- 恢复依赖 `bring_to_front` 返回 `previous_fg_hwnd`；拿不到时回执明确写“原前台未恢复，请检查”，不假装成功。
- 单次动作可用 `foreground: true` 强制 L2。

## 3. 输入通道（按目标框架）

| 目标类型 | 文本 | 组合键 | 菜单 | 备注 |
|---|---|---|---|---|
| 经典 Win32（regedit、WinForms） | `type_text` / UIA ValuePattern | `hotkey`（带修饰键）走 SendInput；`press_key` 后台 PostMessage | `invoke_menu` 可用 | 对照实验：regedit `ctrl+f` 3/3 送达 |
| XAML / WinUI 3（Win11 记事本、计算器） | 指定 element 走 UIA `ValuePattern` | `hotkey` 走 UIA AcceleratorKey 匹配；**实测 4s 超时**和 `could not find a UIA AcceleratorKey`（#3908） | `invoke_menu` 可能 `menu_path_unavailable` | 保存类操作改走“点菜单栏项 → 观察弹出菜单 → 点菜单项”；`xamlKeyFallback: auto`（默认 off）可实验性自动做这一步；`press_key` 可能 `effect:unverifiable` |
| Electron / Chromium / WebView2 | 通常可 UIA ValuePattern；内容区可能不暴露树 | 后台事件可能被静默丢弃（`background_unavailable`） | 取决于应用 | 用 `native` 截图 + element/像素点击 |
| Canvas / 游戏 / 自绘 | 无 AX 树 | 同左 | 不可用 | `native` 或 `vision`；坐标点击 best-effort |

`computer_type` 在未指定 element 时输入到**快照窗口当前焦点**，不是“当前前台窗口”；这是 P0 修复后的行为，避免盲发到别的窗口。

## 4. 坐标与 DPI

本仓库在 2026-09-16 用可控探针逐点标定（最小二乘残差 ≤0.55px），结论：

| 量 | 空间 | 证据/用法 |
|---|---|---|
| `computer_click(x,y)` | 窗口矩形相对物理像素（= 窗口截图空间） | 探针 MouseDown 回读客户区坐标标定 |
| 驱动元素 `frame` | 屏幕物理像素 | A6 复核：标题栏 y=806 vs 窗口原点 y=780 |
| `get_window_state` 截图 | 窗口 `bounds` 的 1:1 物理像素裁剪 | 同窗口 bounds 1906×1166 == 截图 1906×1166 |
| `screen_observe` 输出 `@(x,y)` | window-screenshot-px | 已在输出时减去 `screenOrigin`；可直接点击 |
| `screen_zoom` 图内坐标 | zoom-image-px | 直接 `computer_click(x=,y=,from_zoom=true)`；驱动按 padding/缩放映射，插件不再手算 |
| `screen_zoom` 输出图 | 请求区域宽 ≤500px；驱动自动加约 20% padding，超 500px 时缩放 | 结果带 `fromZoom=true`；`crop` 只是请求区域，不是换算基准 |

`screen_observe` 的文本行 `@(x,y)` 与结构化 `elements[].x/y` 必须完全一致，都是减过 `screenOrigin` 的点击空间；2026-11-14 t01 的“反复定位”根因就是文本行漏了换算。取不到窗口 `bounds` 时不会假装可点击：头部会标注“屏幕物理像素，不要直接用于 computer_click”，`coordinateSpace` 为 `screen-physical-px`。

**A7 的诚实结论**：驱动 0.23.2 的文档契约（click = window-local PNG px）与实测行为在混合 DPI 下有矛盾；六轮实验里 screen/bounds-local/client-local 三种假设都有反例。因此：

- **element 路径是可靠主路径**（`element_token`，UIA/AX 定位）。
- **像素路径是 best-effort**：点击后必须用 `screen_observe` / `computer_verify` 复核；不要把它当“零标定命中”。
- 不要把 `screenOrigin` 加进点击坐标——它是换算到屏幕绝对坐标的基准，不是点击输入。

## 5. 观察与结构密码扫描

- `screen_observe` 先 `list_windows(on_screen_only)` 选目标；指定 `window` 未匹配时 **fail-closed**，返回候选且不建新快照；如果已有新鲜旧快照，会明确提示它仍有效（只有同窗口失败才清空）。
- 窗口级 `get_window_state` 失败 → `get_desktop_state` 桌面级降级：`mode=desktop-visual`、`visualOnly=true`，坐标是桌面像素，**不能直接用于窗口动作**。
- `driverAccess` 来自 `check_permissions`（只读）：`elevated`、`integrityLevel`、`uia`、`postMessage`；结果头会显示权限面摘要。
- `passwordScan: auto`（Windows）在观察时 spawn：

```text
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass
  -File tools/uia-password-scan.ps1 -Hwnd <window_id>
```

  超时 5s；输出单行 JSON；失败/超时返回 null，调用方降级启发式并注记。扫描是只读的，不写文件、不联网。

结构位事实：

- 经典 Win32 `ES_PASSWORD` 在两种 UIA 客户端中都映射 `IsPassword=false`；样式位才是系统真值（上游 #3576）。
- sidecar 用 `NativeWindowHandle` + `GetWindowLongW` 读样式位；坐标与驱动 `frame` 同为屏幕物理像素，**直接匹配，不做原点换算**。
- 误差方向安全：坐标错配只会漏标，不会误标；漏标时启发式接管。
- A6 真机 9/9：结构标记、guard 硬拒、普通框零误拒、sidecar 时延 1.4–1.6s、zoom crop 元数据。

## 6. 窗口/标签清理规则（血泪）

Win11 记事本是**单进程多窗口/多标签**，进程可能同时持有用户未保存文档。因此：

1. **绝不按进程名杀**（`Stop-Process -Name Notepad` 会连用户文档一起杀）。
2. **不要用 WM_CLOSE 批量关**：已修改文档会弹“另存为”，无人值守时会把对话框留在桌面上；关闭会遍历每个已修改文档的保存流程，比不清理更危险。对测试窗口，`Close-TestNotepad` 只在标签校验通过（全是测试文件且未修改）后，先关 `GW_OWNER=测试 HWND` 的模态对话框，再关主窗；用户窗口仍不自动关。
3. **UIA 关标签不可靠**：“关闭标签页”按钮存在，但 `Invoke` 实测 no-op（与 #3908 同源）；先 `Select` 也一样。
4. **`Start-Process -PassThru` 的 pid 是启动器**，可能随即退出；据此判断“已关闭”是假阳性。
5. 测试脚本只**报告残留标签名**，由人工关闭（选中标签 → Ctrl+W → 不保存）。`tests/live-action.e2e.mjs` 使用唯一命名临时文件窗口做确定性选择，不杀进程。
6. eval 的 Notepad 任务使用 `Open-TestNotepad` / `Close-TestNotepad`：**新 HWND 不等于干净窗口**——Win11 会把 `TabState/*.bin` 恢复进新窗口。必须按 UIA `TabItem` 校验精确标签集（无额外用户标签、无 modified、后缀可识别）；任一不符 setup fail closed，cleanup 留窗并写 `_leftovers/`，绝不只看活动标题的 `*`。`Close-TaskWindows` 不再有默认 Notepad 宽匹配，调用必须带显式模式。
7. **preflight 不把测试标签加进用户窗口**：`Open-TestNotepad` 在启动前若发现任何 Notepad 窗口（且不是本任务显式允许的第一个 HWND），直接 fail closed，不启动。
8. **TabState 隔离**：`evals/lib/tabstate.ps1 backup|restore` 把用户 TabState 全部 bin 搬到 `_tabstate-backup/`，每个任务启动前清掉上一个任务的 eval bin，跑完恢复。没有它，任务 N 的 seed/draft/workfile 会被任务 N+1 恢复（2026-11-15 实测 cascade）。**运行 eval 期间不要用 Notepad 编辑用户文档**。
9. **关闭用 UIA，WM_CLOSE 只兜底**：Win11 Notepad 对非提权客户端的 WM_CLOSE 静默忽略；`Close-WindowUia`（`WindowPattern.Close`）可靠。测试窗口标签全是测试文件时才允许丢弃修改（cleanup 的 `-AllowDiscardTestOnlyModified`）。

## 7. 冒烟矩阵

### 7.1 引擎与加载

```bash
# 1) 引擎连通
cua-driver call get_screen_size '{}'

# 2) 插件出现在合成配置中
dsh --profile web --dump-config | grep dsh-win-computer-use

# 3) dispatcher 面（headless 探针；headless 默认禁用 credentials，探针 patch 需启用）
dsh --profile headless --patch "<工作区>/_probe-win-cu-deepseek.yml" \
  --permission-mode read-only --approval-policy never \
  "调用 computer_do(action='status')，把返回原文贴出来"
```

期望：`status` 返回 `dispatcher` 模式、直接可见 `computer_do,screen_observe`、隐藏 20 个。2026-11-12 实测：默认 DeepSeek 通道，1 轮 5 步完成 `status` / `screen_observe` / `catalog` / 隐藏 `computer_wait`；headless 默认 `credentials: disabled`，不启用会报 `MISSING_CREDENTIAL`，这不是插件加载错误。

### 7.2 真桌面闭环（推荐脚本）

```bash
node tests/live-action.e2e.mjs 3
```

流程：创建唯一命名临时文件 → 打开记事本 → `screen_observe(ax)` 找文档元素 → `computer_type(effect:confirmed)` → 脚本自读 UIA 文档文本含标记（独立见证）→ `computer_verify` 窗口谓词 satisfied / 自输入文本 unknown+untrusted_source → 未知参数拒绝 → 剪贴板往返 → `computer_wait`。最近一次 23/23（2026-09-17）。

清理：脚本报告残留标签，不杀进程；人工关闭临时文件标签。

### 7.3 观察/截图/坐标

```bash
node verify-runtime.mjs
```

16 项：dispatcher 可见 2 / catalog 20 / 隐藏 click 无快照拒绝 / `screen_observe(ax)` / native 图片落盘 / `screen_zoom` 经 dispatcher 图片透传 / 坐标字段一致。只读观察，不执行桌面动作。

### 7.4 密码框

```powershell
# 自包含探针：WinForms 密码框 + UIA 自扫 + Win32 样式真值
powershell -ExecutionPolicy Bypass -File tools/password-probe.ps1
```

期望：结构位标记命中；`computer_type` / `computer_set_value` 硬拒；普通输入框零误拒。

### 7.5 明确不再使用的旧验收项

旧版 `WINDOWS_TEST.md` 曾要求“危险词按钮 → 触发审批”。**审批网关在 0.4.0 已删除**；现在的正确验收是：

- `extremePatterns` 命中 → 结果附警告注记，**动作仍执行**；
- 凭据硬保护 → 密码框自动输入硬拒；
- 快照 TTL/无快照 → 结构化拒绝；
- `computer_stop` → 全工具锁存，`computer_resume` 解锁。

## 8. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| `cua-driver` 启动失败/ENOENT | 不在 PATH 或未安装 | 设 `CUA_DRIVER_BIN`；确认 daemon 在跑 |
| 窗口级观察被拒，返回 `desktop-visual` | 权限/UIPI/目标不可访问 | 换普通窗口；桌面坐标不能直接点击 |
| `background_unavailable` | Chromium/Electron/GTK/VCL 等丢弃后台事件 | `deliveryMode: auto` 自动前台；或 `foreground:true` |
| `foreground_unavailable` | 前台锁（对话框常见） | 自动 L3；`foreground:true` 也会升级（要求 payload 有 `pid+window_id`）；仍失败先让目标前置 |
| `[repeat_suppressed]` | 同一窗口/目标/投递模式 5s 内重复，且观察未变化 | 先 `screen_observe`；确认要再点就换目标或 `count=2`；`actionGuard:off` 可关 |
| `alt+f4`/hotkey 4s 超时 | WinUI3 UIA 加速器不可达（#3908） | 点菜单/工具栏控件；或稍后重试；可试 `xamlKeyFallback: auto` |
| `could not find a UIA AcceleratorKey` | 命令在关闭菜单里（保存/全选等）；PostMessage 被忽略 | 点菜单栏项打开菜单，再点具体菜单项；不要重复按键 |
| `menu_path_unavailable` | XAML 菜单驱动走不到 | 改点控件；不要回退像素 |
| 像素点击偏 | 混合 DPI + 驱动 0.23.2 落点缺陷（A7） | 用 element 路径；像素点击后复核 |
| `computer_type` 送达但无效果 | 目标不接受该通道/焦点不对 | 指定 element 走 ValuePattern；或点控件后输入 |
| 剪贴板 read 为空 | 被其它进程占用 | write 后 verify/重试；用粘贴流 |
| `app_launch` 后无法关闭 | High IL + UIPI | 提示用户手动关闭；不要按进程名杀 |
| 测试选中错误窗口 | 桌面有同名/残留窗口 | 用唯一命名临时文件 + 标题精确匹配；不要用进程名 |
| PowerShell `Add-Type` 报 `C:\Windows\TEMP\*.cs` 找不到 | 进程 `TEMP` 指向系统目录 | 跑 `evals/` 前设 `TEMP`/`TMP` 到 `%LOCALAPPDATA%\Temp` |

## 9. 上游问题跟踪

| 编号 | 内容 | 状态 |
|---|---|---|
| [trycua/cua#3576](https://github.com/trycua/cua/issues/3576) | 元素投影增加 `is_password` | 已提；插件用 sidecar 结构位兜底 |
| [trycua/cua#3586](https://github.com/trycua/cua/issues/3586) | UI 树 revision + 条件请求（no_change） | 已提；落地后 TTL 可退役为上限保险 |
| [trycua/cua#3587](https://github.com/trycua/cua/issues/3587) | 结构化干预信号（光标位移/钩子） | 已提；落地后可疑状态可由真实干预驱动 |
| [trycua/cua#3607](https://github.com/trycua/cua/issues/3607) | 驱动高完整性/清理边界 | 已附对照实验与清理后果 |
| [trycua/cua#3908](https://github.com/trycua/cua/issues/3908) | WinUI3 hotkey UIA 加速器超时 | 已提；插件翻译为“改点控件”指引 |
| — | 像素点击落点（A7） | 素材已备，未单独提交；插件层定性 best-effort |

## 10. 已知限制

- 管理员/UIPI 窗口：驱动可操作其自己启动的高完整性窗口，但非提权客户端清不掉；这是 OS 边界，不是插件 bug。
- WinUI3 的快捷键/菜单通道可能整体不可达；element 点击是可靠替代。
- 像素路径受驱动 DPI 缺陷影响；element 路径优先。
- 桌面级降级只提供视觉信息，不产生可执行窗口坐标。
- Linux/macOS 的 Windows 专属行为（结构密码扫描、UIPI、AttachThreadInput）不适用或未验证。
