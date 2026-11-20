# WINDOWS — Windows 工程细节

> 目的：Windows 10/11 上的完整性级别、前台锁、输入通道、坐标/DPI、私有拖拽、密码扫描与清理规则。
> 读者：Windows 用户、排障者、维护者。
> 状态：当前实现（最后核对 2026-11-20；真机环境 Windows 11 x64 · DPI 150% · cua-driver 0.23.2 基线 + 0.52.13 canary · dsh 0.2.2-rc.1）。
> 相关：[TROUBLESHOOTING](TROUBLESHOOTING.md) · [COMPATIBILITY](COMPATIBILITY.md) · [DRIVER-SDK](DRIVER-SDK.md) · [EVIDENCE](EVIDENCE.md)。

## 1. 前置与完整性级别

| 项 | 事实 | 后果 |
|---|---|---|
| `cua-driver.exe` | 二进制清单 `requireAdministrator`，daemon 以 High IL 运行 | 插件以固定 argv spawn 它；驱动自身可能需要 UAC/已提升的 daemon |
| `app_launch` 子进程 | 完整性级别取决于驱动版本与启动路径；0.52.13 实测 daemon 为 High，但 `powershell.exe` 子进程为 Medium（`S-1-16-8192`） | 不要一律假定 High；先读实际进程 IL，再决定能否由非提权客户端关闭 |
| 对照：同一 shell 直接 `Start-Process notepad` | Medium IL | High IL 来自驱动链，不是“启动方式随便造成的” |
| 驱动操作自己启动的 High IL 窗口 | 实测可行（提权记事本 `computer_type` 成功且 `effect:confirmed`） | “管理员窗口一律不可操作”不成立；要按目标与通道分别判断 |
| WinUI/XAML 目标关闭 | `alt+f4` 可能撞 UIA 加速器超时（#3908）；`invoke_menu` 可能 `menu_path_unavailable` | 连驱动侧关闭通道也可能断，只能人工收尾 |

**实践建议**：评测/自动化优先操作**已在运行的普通应用**；确需 `app_launch` 时，接受“该窗口可能需要人工关闭”的成本。不要按进程名杀记事本——见 §7。

## 2. 前台锁与三级投递

Windows 的 `ForegroundLockTimeout` 会让 `SendInput` 在目标未前台时静默打空，且不一定报错。`deliveryMode: auto` 按下面的梯子处理：

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
- **强制前台（`foreground:true`）的指针动作例外**：先 `bring_to_front`、只执行一次、恢复原前台，不做失败后重试；否则同一文件会被点两遍、同一形状会被画两遍。`deliveryMode=auto` 的非强制路径仍保留 L3。
- `hotkey` **不做 unverified L3**：XAML 目标的 UIA 加速器先验拒绝，重试同样失败，只会增加副作用；回执会说明。但**组合键一律自动前台**（即使 `deliveryMode:background`），因为后台 synthetic 路径不更新 OS 修饰键状态，实测 `Ctrl+V` 只落 `v`。普通按键仍可后台 PostMessage。
- 没有 `pid` 的 desktop-scope 调用没有窗口可绕锁，不升级。
- 恢复依赖 `bring_to_front` 返回 `previous_fg_hwnd`；拿不到时回执明确写“原前台未恢复，请检查”，不假装成功。
- 单次动作可用 `foreground: true` 强制 L2；它更慢且会移动指针，不要默认开启。

## 3. 输入通道（按目标框架）

| 目标类型 | 文本 | 组合键 | 菜单 | 备注 |
|---|---|---|---|---|
| 经典 Win32（regedit、WinForms） | `type_text` / UIA ValuePattern | `hotkey`（带修饰键）自动前台走 SendInput；`press_key` 后台 PostMessage | 经典 `SetMenu` HMENU 可用 `nativeMenus:auto` 走精确路径 + `WM_COMMAND`（真机 fixture 已通过）；WinForms `MenuStrip` 不是 HMENU，仍 `menu_path_unavailable`；`nativeButtonTrigger:auto` 可对标准 Button 走 `BM_CLICK`（t20 形态 1.2s，默认 off） | 后台 synthetic 不更新修饰键状态，`Ctrl+V` 可能只落 `v`；组合键自动前台 |
| XAML / WinUI 3（Win11 记事本、计算器） | 指定 element 走 UIA `ValuePattern` | `hotkey` 走 UIA AcceleratorKey 匹配；**实测 4s 超时**和 `could not find a UIA AcceleratorKey`（#3908） | `invoke_menu` 可能 `menu_path_unavailable` | 保存类操作改走“点菜单栏项 → 观察弹出菜单 → 点菜单项”；`xamlKeyFallback: auto`（默认 off）可实验性自动做这一步；`press_key` 可能 `effect:unverifiable` |
| Electron / Chromium / WebView2 | 通常可 UIA ValuePattern；内容区可能不暴露树 | 后台事件可能被静默丢弃（`background_unavailable`） | 取决于应用 | 用 `native` 截图 + element/像素点击 |
| Canvas / 游戏 / 自绘 | 无 AX 树 | 同左 | 不可用 | `native` 或 `vision`；坐标点击 best-effort |

`computer_type` 在未指定 element 时输入到**快照窗口当前焦点**，不是“当前前台窗口”；这是 P0 修复后的行为，避免盲发到别的窗口。

**预填字段**：另存为文件名等已有值的输入框优先 `computer_set_value(element=..., value=完整内容)` 覆盖；`computer_type` 是追加语义，`ctrl+a` 在 WinUI 对话框/无菜单栏窗口可能不可用。2026-11-20 t05 r4 实测：`type` 把路径追加到旧文件名后，模型用 `ctrl+a`/退格/拖动都救不回来，12→43 步、1.25M total。

**另存为默认目录**：对话框通常打开源文件所在目录；只改文件名会保存回源目录（t05 r1 先写 `src\out-ansi.txt` 再整轮重做）。先看面包屑/当前目录，或直接在“文件名”框 `computer_set_value` 完整绝对路径。

**WinUI3 组合键实测结论**（2026-11-16，详见 [EVIDENCE](EVIDENCE.md) §5.4）：

- Ctrl+A 的可靠回退是“点编辑菜单 → 全选”，不是前台裸 `press_key`；后者 background 变体会把裸 `a` 插入正文。
- Alt+F 只在 foreground `press_key` 下可靠；`hotkey` 走 UIA AcceleratorKey 扫描，WinUI3 上不可达。
- Alt+Tab 只在 foreground `press_key` 下生效（真实切走）；任务里优先用 `app_list`/`computer_activate`/`app_launch`。
- 所有成功的 WinUI 键鼠动作仍可能返回 `effect:unverifiable`；必须 observe/verify。

**Win+R 不保证 Run**：本机 Win+R 打开的是 Command Palette（`Microsoft.CmdPal.UI`），其 AX 树为空且拒绝前台激活/文本投递；需要启动应用时用 `app_launch` 或开始菜单，不要在 CmdPal 上耗步骤。无目标 `screen_observe` 现在会跳过 CmdPal/TextInputHost/PowerToys 等 shell 表面；显式传 `window`/`window_id` 仍可观察它们。

**win 组合键 fail-closed**：驱动路径不能可靠发送 `win` 修饰键；旧实现把 `win+r` 解析成单键 `win`，打开 Start/SearchHost。当前明确返回“不支持，用 app_launch/开始菜单”，不再静默降级。

**显式窗口激活**：`computer_activate(window_id, pid?)` 直接把已存在窗口前置（driver `bring_to_front`），**不启动/关闭应用，也不恢复原前台**；不要求快照，但激活后操作内容仍需 `screen_observe`。脏桌面多窗口切换优先用它，而不是点任务栏或反复 Alt+Tab。

**模态点击 30s 超时（2026-11-20 根因已定位）**：MessageBox 打开期间，该进程的 UIA provider 不服务跨进程 UIA/COM 请求——同 pid 的主窗口和对话框 AX 树在 **1s/5s/15s** 预算下都是 0 元素（capture-only 仍可读）；驱动的 `click`/`press_key`/`bring_to_front` 会阻塞到模态关闭，30s 只是 transport 上限。因此：

- 不要重复点击/按键/activate，也不要把 `timeout_ms` 调大当成修复（已证伪）；
- 先等待 5–10s，再 `screen_observe`（capture/ax 均可）确认是否“延迟成功”；
- 若仍在，按对话框按钮的加速键（Alt+字母）只发一次；`Escape` 在 Yes/No 上通常无效，`Enter`/foreground 键也可能 60s 阻塞；
- 原生 Win32 `WM_COMMAND`/`BM_CLICK` 可在 ~1s 关闭标准对话框。插件已提供**私有原生对话框后端**：`nativeDialogs:auto` 时，UIA 树为 0 且目标是同 pid 标准 `#32770` 模态对话框，`screen_observe` 返回 `mode:native-dialog` 按钮，`computer_click(element=编号)` 走 `BM_CLICK`（异步/未验证）。只覆盖标准 Button，不自动选择 Yes/No；触发模态的 UIA click 仍可能 30s。`nativeDialogs:off` 完全禁用（零 PowerShell spawn）。详见 [TOOLS](TOOLS.md) §3.1/§4.1 与 [EVIDENCE §1.5](EVIDENCE.md)。

## 4. 私有拖拽（modifier / dwell_ms）

`computer_drag` 的 `modifier` 非空（或 `dwell_ms>0`）时不再走 driver drag，而是由 `tools/private-drag.ps1` 执行一次原子 SendInput 手势：

1. 父进程把窗口截图坐标按 `screenOrigin + 截图尺寸` 映射为屏幕物理像素；
2. helper 设置 PMv2 DPI、校验目标成为前台；
3. `SetCursorPos` + 真实 `MOVE|ABSOLUTE|VIRTUALDESK` 到起点；
4. modifier keydown（Ctrl/Shift/Alt/Win；用户已按住的键不重复按、也不代释放）；
5. 鼠标 down → 100ms → 先移动 6px 越过 4px 拖拽阈值 → 按 `steps/duration_ms` 插值 → 终点 → 可选 `dwell_ms`；
6. 鼠标 up → 70ms → modifier 反向 keyup；`finally` 释放按钮/修饰键；恢复原前台；
7. 回执带 `sent`、`foregroundRestored`、`stuckButton/stuckModifiers`；界面结果仍需 observe。

限制：

- 私有路径**不支持 `from_zoom`**（驱动 zoom 的真实 padding/scale 没有复刻，手算会重蹈 A7）；明确报 `[private_drag_zoom_unsupported]`。
- 需要快照的 `screenOrigin`/截图尺寸；query 只读视图没有动作快照；报 `[private_drag_no_frame]`。
- UIPI：中完整性 helper 不能向高完整性目标注入，SendInput 失败时回执明确失败；不要假成功。
- 不自动重试：drag 非幂等；只有前台校验失败（未发送输入）才可让模型 activate 后重试一次。
- 已验证：WinForms 探针 `probe-private-drag` **3/3** 在 down/move/up 三个点读到 `Shift, Control`，drop 后 `stuckModifiers` 为空。Explorer Ctrl+drag 复制、Excel 工作表标签 Ctrl+drag、PPT Shift 约束尚未纳入自动回归，作为下一轮真机项。
- 0.39+ 驱动支持原生 modifier drag；`dragEngine: auto` 优先原生，`private` 强制 helper；`dwell_ms` 始终私有。原生失败不自动重拖。
- **从标题栏拖动=移动窗口**：会改变 `windowOrigin`，不是点击/落点证明；回执会提示“起点在标题栏”并清空快照。2026-11-20 t20 二轮实测：模型把 `screenOrigin` 变化误当成坐标生效，继续点 No 仍未关对话框。

## 5. 坐标与 DPI

本仓库在 2026-09-16 用可控探针逐点标定（最小二乘残差 ≤0.55px），结论：

| 量 | 空间 | 证据/用法 |
|---|---|---|
| `computer_click(x,y)` | 窗口矩形相对物理像素（= 窗口截图空间） | 探针 MouseDown 回读客户区坐标标定 |
| 驱动元素 `frame` | 屏幕物理像素 | A6 复核：标题栏 y=806 vs 窗口原点 y=780 |
| `get_window_state` 截图 | 窗口 `bounds` 的 1:1 物理像素裁剪 | 同窗口 bounds 1906×1166 == 截图 1906×1166 |
| `screen_observe` 输出 `@(x,y)` | window-screenshot-px（原图像素） | 输出时已减 `screenOrigin`；可直接点击。宿主预览可能缩放显示，不能按预览尺寸估坐标 |
| `screen_zoom` 图内坐标 | zoom-image-px | 直接 `computer_click/drag(..., from_zoom=true)`；驱动按 padding/缩放映射，插件不再手算 |
| `screen_zoom` 输出图 | 请求区域宽 ≤500px；驱动自动加约 20% padding，超 500px 时缩放 | 结果带 `fromZoom=true`；`crop` 只是请求区域，不是换算基准 |

**Explorer 文件项**：后台坐标点击会优先走 UIA hit-test/Invoke；在文件项上 Invoke 等于“打开”。单选文件请传 `foreground=true`（真实 SendInput 单击）；多选 Ctrl+click 因 `modifier` 已自动前台。2026-11-17 t15 首轮实测：background 单击 `report-draft.txt` 直接打开 Notepad，随后又打开 Photos/PDF，导致该轮作废。

**宿主预览缩放**：2558×1598 的窗口截图在模型侧可能显示成 1610×1006，但 `@(x,y)`/`computer_click` 始终是原图像素。2026-11-17 t14 r2 与 t17 r2 都把 A1 点成 B1，就是因为按预览尺寸估坐标。头部现在带 `源图 W×H` 并明确“预览缩放时用 `screen_zoom` + `from_zoom=true`”；网格/画布/图标定位不要用整窗预览量像素。

`screen_observe` 还会在目标 z 序明显落后于另一个在屏窗口时提示“通常不是前台”，并给出 `computer_activate(pid,window_id)`；这不是 OS 前台判定，`z_index` 为 null 时不发提示。需要键盘/画布/foreground 动作时先 activate，不要 Alt+Tab/任务栏；后台 element 点击不需要。

**A7 的诚实结论**：驱动 0.23.2 的文档契约（click = window-local PNG px）与实测行为在混合 DPI 下有矛盾；六轮实验里 screen/bounds-local/client-local 三种假设都有反例。因此：

- **element 路径是可靠主路径**（`element_token`，UIA/AX 定位）。
- **像素路径是 best-effort**：点击后必须用 `screen_observe` / `computer_verify` 复核；不要把它当“零标定命中”。
- 不要把 `screenOrigin` 加进点击坐标——它是换算到屏幕绝对坐标的基准，不是点击输入。

**0.52+ 坐标差异**：截图与 `window_bounds` 仍可能差 1–2px；归一化优先用 `capture`/`screenshot_frame`，没有时按 `frame - bounds.origin` 兼容。精确像素任务仍建议 `screen_zoom + from_zoom=true`。

## 6. 观察与结构密码扫描

- `screen_observe` 先 `list_windows(on_screen_only)` 选目标；指定 `window` 未匹配时 **fail-closed**，返回候选且不建新快照；如果已有新鲜旧快照，会明确提示它仍有效（只有同窗口失败才清空）。
- **快照是全局单例**：任意窗口的新观察都会替换 `snapshot_id`；native/vision 回执文本回显当前 id 与“全局单例”，query 只读视图会清除旧快照。动作携带上一个窗口/上一次观察的 id 会得到 `[snapshot_mismatch]`。
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

## 7. 窗口/标签清理规则

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
10. **Paint/Office/浏览器 dirty 规则（2026-11-16）**：
   - Paint 11 是标签页应用：必须要求“测试 seed 的唯一 HWND/标签”；若只能并入用户窗口/标签，setup 记 ENV 或 cleanup 留窗 dirty，绝不关用户窗口。
   - PowerPoint/Excel 是单实例：只关 setup 记录的测试 HWND（pid/start/title 复核），关闭时只处理已证明归属的保存提示；**禁止 `Quit` / `Presentations.Close` 全部**，oracle 只读 OOXML ZIP/XML，不实例化 COM。
   - 浏览器复用用户会话：`--new-window` 后要求新 HWND；只关该 HWND，绝不按 chrome/msedge 进程名杀。论文下载只扫描任务开始后新增的 PDF，cleanup 只删 SHA-256 匹配的新文件，绝不碰用户已有 Downloads 文件。
   - dirty 任务 md 标记 `- **isolation: dirty**`；headless/verify runner 只在选中 Notepad 任务时备份/恢复 TabState，dirty 组不碰用户 Notepad。

## 8. 冒烟矩阵

### 8.1 引擎与加载

```powershell
cua-driver call get_screen_size '{}'
dsh --profile web --dump-config | grep dsh-win-computer-use
```

headless 探针（默认禁用 credentials；用 overlay 启用）：

```bash
dsh --profile headless --patch "<repo>/evals/headless-patch.yml" \
  --permission-mode read-only --approval-policy never \
  "调用 computer_do(action='status')，把返回原文贴出来"
```

期望：`status` 返回 `dispatcher` 模式、直接可见 `computer_do,screen_observe`、隐藏 21 个。

### 8.2 真桌面闭环

```bash
node tests/live-action.e2e.mjs 3
```

流程：唯一命名临时文件 → 打开记事本 → `screen_observe(ax)` → `computer_type(effect:confirmed)` → 脚本自读 UIA 文档文本（独立见证）→ `computer_verify` → 未知参数拒绝 → 剪贴板往返 → `computer_wait`。最近一次 23/23（2026-09-17）。清理：报告残留标签，不杀进程。

### 8.3 观察/截图/坐标

```bash
node verify-runtime.mjs
```

18 项：dispatcher 可见 2 / catalog 21 / 隐藏 click 无快照拒绝 / `screen_observe(ax)` / native 图片落盘 / native 文本快照 id / `screen_zoom` 经 dispatcher 图片透传 / 坐标字段一致。只读观察，不执行桌面动作。

### 8.4 密码框

```powershell
powershell -ExecutionPolicy Bypass -File tools/password-probe.ps1
```

期望：结构位标记命中；`computer_type` / `computer_set_value` 硬拒；普通输入框零误拒。

### 8.5 明确不再使用的旧验收项

旧版 `WINDOWS_TEST.md` 曾要求“危险词按钮 → 触发审批”。**审批网关在 0.4.0 已删除**；现在的正确验收是：

- `extremePatterns` 命中 → 结果附警告注记，**动作仍执行**；
- 凭据硬保护 → 密码框自动输入硬拒；
- 快照 TTL/无快照 → 结构化拒绝；
- `computer_stop` → 全工具锁存，`computer_resume` 解锁。

## 9. 已知限制

- 管理员/UIPI 窗口：驱动可操作其自己启动的高完整性窗口，但非提权客户端清不掉；这是 OS 边界，不是插件 bug。
- WinUI3 的快捷键/菜单通道可能整体不可达；element 点击是可靠替代。
- 像素路径受驱动 DPI 缺陷影响；element 路径优先。
- 桌面级降级只提供视觉信息，不产生可执行窗口坐标。
- 私有拖拽不支持 `from_zoom`；UIPI 高权限目标会失败。
- Linux/macOS 的 Windows 专属行为（结构密码扫描、UIPI、AttachThreadInput）不适用或未验证。

### 9.1 实验性后台输入（默认 off）

对没有可交互 UIA 元素的目标，插件提供三组实验键（全部默认 off）：

| 键 | 通道 | 等级 | 代价/限制 |
|---|---|---|---|
| `backgroundInput: auto` | B0：`PostMessage` 鼠标；`SendMessageTimeout` plain key/`WM_CHAR`；`BM_CLICK` | 不碰光标/前台 | 只对处理窗口消息的目标有效；不更新 OS 修饰键状态；目标卡住时文本每字符最多等 1s |
| `syntheticPointer: auto` | B1：`InjectSyntheticPointerInput(PT_TOUCH)` + anchor | 不碰光标/前台 | 只左单击；无滚轮/键盘；目标必须处理 `WM_POINTER`；遮挡失败关闭，不借 Z 序/透明度；需 `allowedApps` |
| `syntheticPointer: promote` | B1：无 anchor 单点合成触控，系统提升为鼠标消息 | 不碰光标/前台 | 只对普通 message 窗口；只左单击；应用是否按业务处理未验证；需 `allowedApps` |
| `anchoredInput: cursor/cursor-clip/window` | B2/B3：临时移光标/移窗口后发消息 | 不抢前台，但动光标/窗口 | 只左单击；需 `allowedApps`；`cursor` 依赖 `BlockInput`，`cursor-clip` 用 `ClipCursor` 免提权但不阻塞键盘；B3 不改 Z 序/不做离屏截图；外部移动光标/窗口时失败关闭 |

三键全 off 时零 PowerShell spawn。组合键/modifier/`foreground=true`/`deliveryMode=foreground`/`from_zoom` 一律跳过本功能；失败/未验证不自动换通道。通道矩阵、回执、错误码与实测见 [BACKGROUND-INPUT](BACKGROUND-INPUT.md)。

## 10. 上游跟踪

| 编号 | 内容 | 状态 |
|---|---|---|
| [trycua/cua#3576](https://github.com/trycua/cua/issues/3576) | 元素投影增加 `is_password` | 已提；插件用 sidecar 结构位兜底 |
| [trycua/cua#3586](https://github.com/trycua/cua/issues/3586) | UI 树 revision + 条件请求 | 已提；落地后 TTL 可退役为上限保险 |
| [trycua/cua#3587](https://github.com/trycua/cua/issues/3587) | 结构化干预信号 | 已提；落地后可疑状态可由真实干预驱动 |
| [trycua/cua#3607](https://github.com/trycua/cua/issues/3607) | 驱动高完整性/清理边界 | 上游已关闭（completed）；0.52.13 实测 daemon High、PowerShell 子进程 Medium，按实际 IL 清理 |
| [trycua/cua#3908](https://github.com/trycua/cua/issues/3908) | WinUI3 hotkey UIA 加速器超时 | 已提；插件翻译为“改点控件”指引 |
| — | 像素点击落点（A7） | 素材已备，未单独提交；插件层定性 best-effort |

路线与触发条件见 [ROADMAP](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/ROADMAP.md)；逐轮证据见 [EVIDENCE](EVIDENCE.md)。
