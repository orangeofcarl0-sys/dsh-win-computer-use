# PERMISSIONS — dsh-win-computer-use 权限与安全声明

> 本文件声明插件在运行时**实际**使用的权限面（DSH STORE / 人工审查依据）。
> 变更任何 spawn、网络、环境变量、文件访问或安全承诺时，必须同步更新本文件与 `package.json` 的 `dsh.permissions`，并补测试。
> 状态：当前实现（最后核对 2026-11-22；`0.5.9`）。威胁模型见 [docs/SECURITY.md](docs/SECURITY.md)。

## 1. 运行时行为总览

插件本身不做桌面 I/O；它通过宿主 `spawn` 调用两个本地进程，并通过宿主服务读写图片/模型：

| 能力 | 机制 | 范围 |
|---|---|---|
| 桌面观察 | `cua-driver call get_window_state / get_desktop_state / list_windows / check_permissions …` | AX/UIA 树、窗口截图、权限面探测 |
| 驱动探测 | `cua-driver --version` / `status` | 只读版本/契约探测；进程级缓存，每进程 1–2 次 |
| 桌面动作 | `cua-driver call click / type_text / set_value / press_key / hotkey / scroll / drag / …` | 虚拟光标、UIA/PostMessage/SendInput |
| 应用枚举/启动 | `cua-driver call list_apps / launch_app / bring_to_front` | 运行中应用与启动 |
| 验证/剪贴板/菜单 | `cua-driver call verify_state / clipboard_* / invoke_menu / move_cursor` | 确定性谓词、剪贴板、菜单、悬停 |
| 图片持久化 | 宿主 `attachments.saveImage` | 截图/zoom 图片，不直接写文件 |
| 视觉观察者 | 宿主 `ctx.llm`（`vision` 模式） | 截图 + 问题交给配置的视觉模型 |
| 子 agent 委派 | 宿主 `subagents.startActivation`（`computer_task`） | 一次性子会话，能力受宿主限制 |
| 结构密码扫描 | `powershell.exe` + `tools/uia-password-scan.ps1` | Windows，只读 UIA/样式位 |
| 私有拖拽 | `powershell.exe` + `tools/private-drag.ps1` | Windows 前台 SendInput；仅 modifier/dwell 路径 |
| 实验后台输入 | `powershell.exe` + `tools/background-input.ps1` | Windows 实验性 B0/B1/B2/B3；同 pid；三键默认 off；B1/B2/B3 需 `allowedApps`；无文件/网络；PTC `show` 复用 `SW_SHOWNOACTIVATE` |
| PTC 点滚动 | `powershell.exe` + `tools/uia-scroll.ps1` | UIA ScrollPattern；同 pid + 点命中校验；固定 argv；无文件/网络；仅 `computer_cua.scroll` 调用 |
| 原生对话框 | `powershell.exe` + `tools/native-dialog.ps1` | Windows 标准 `#32770` 模态对话框：只读子控件枚举 + `BM_CLICK`；`nativeDialogs:off` 禁用 |
| 原生菜单 | `powershell.exe` + `tools/native-menu.ps1` | Windows 经典 HMENU：同 pid、精确路径、叶子命令、`PostMessage(WM_COMMAND)`；`nativeMenus:off` 禁用 |
| 原生 Button | `powershell.exe` + `tools/native-button.ps1` | Windows 标准 Win32/WinForms Button：同 pid、唯一 class/style/label/屏幕点匹配、单次 `BM_CLICK`；`nativeButtonTrigger:off` 禁用 |
| PTC 对象桥接（可选） | 同上：现有工具 + `cua-driver` + 宿主 `attachments` + `tools/uia-scroll.ps1` | `ptcBridge:on` 时仅 PTC preset 的 `computer_cua`；show/scroll 走同一 guard/policy；无新可执行文件/网络；默认 off |
| 轨迹日志（可选） | `node:fs` 写 `trajectoryFile`/`DSH_CU_TRAJECTORY_FILE` | 默认关闭；开启后写本地 JSONL |

插件**不**使用 `approval` 服务；动作零审批、零打断。

## 2. 进程与命令面

### 2.1 cua-driver

```js
spawn(CUA_BIN, ['call', tool, JSON.stringify(args)], {
  stdio: ['ignore', 'pipe', 'pipe'],
})
```

- `shell` 默认 `false`（非 shell 固定 argv）；没有 `exec` / `eval` / `shell:true`。
- `CUA_BIN` 解析顺序：`CUA_DRIVER_BIN` → `PATH` → `~/.local/bin`、`/usr/local/bin`、`/opt/homebrew/bin`、`%LOCALAPPDATA%\cua-driver`、`~/.cua-driver/packages/current` → 兜底 `cua-driver`。
- 子进程只承载一次 `call`，不常驻；daemon 由驱动自身管理。
- 另有固定 argv 的只读探测 `cua-driver --version` 与 `cua-driver status`；`runOnce` 不写文件、不联网、不执行 `update`。

### 2.2 PowerShell sidecar（Windows 可选）

```js
spawn('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', SCRIPT, '-Hwnd', String(hwnd),
], { windowsHide: true })
```

- 仅在 `process.platform === 'win32'`、`passwordScan !== 'off'`、观察有元素时触发。
- 脚本是随包只读文件 `tools/uia-password-scan.ps1`；超时 5s；输出单行 JSON；失败返回 null 并降级启发式。
- 不写文件、不联网、不读用户文件；只读目标窗口的 UIA 属性与 Win32 样式位。

### 2.3 私有拖拽 helper（Windows，按需）

```js
spawn('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', 'tools/private-drag.ps1',
], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
```

- 仅在 `computer_drag` 带 `modifier` 或 `dwell_ms` 时惰性启动；持久进程，stdin/stdout JSON 行；父进程退出后 stdin EOF 自动退出；空闲 120s 退出。
- 一次手势内完成：前台校验 → modifier down → mouse down → 插值 move → mouse up → modifier up → 恢复原前台；失败路径 `finally` 释放按钮/修饰键。
- 坐标是屏幕物理像素（virtual desktop），由插件从 `screenOrigin + 截图尺寸` 映射；私有路径不支持 `from_zoom`（明确报错，不静默丢 modifier）。
- 不写用户文件、不联网；`Add-Type` 使用调用方用户 TEMP（可用 `DSH_POWERSHELL`、`S4_TEMP`/`DSH_TEMP` 覆盖；`S4_TEMP` 是历史命名）。

### 2.4 原生对话框 helper（Windows，按需）

```js
spawn('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', 'tools/native-dialog.ps1',
  '-Action', 'scan|click', '-Pid', pid, '-Hwnd', hwnd, ...
], { windowsHide: true })
```

- 仅在 `nativeDialogs !== 'off'`、Windows、`screen_observe` 的 UIA 树为空且目标为同 pid 标准 `#32770` 模态对话框时触发；`off` 零 spawn。
- `scan`：只读 `EnumChildWindows`/`GetClassName`/`GetWindowText`/`IsWindowEnabled`/`GetWindowRect`；只返回 Button/Static，不返回 Edit 内容。
- `click`：再次校验 pid/class/modal/按钮 id+class+label+enabled+visible，只发 `PostMessage(BM_CLICK)`；native-dialog 不按 ID 盲发 `WM_COMMAND`；不做二次投递。
- 不写用户文件、不联网；`Add-Type` 使用用户 TEMP。

### 2.4.1 原生菜单 helper（Windows，实验性，按需）

```js
spawn('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', 'tools/native-menu.ps1',
  '-Action', 'resolve|invoke', '-Pid', pid, '-Hwnd', hwnd,
  '-PathB64', pathB64, '-CommandId', id,
], { windowsHide: true })
```

- 仅在 `nativeMenus:auto`、Windows、驱动 `invoke_menu` 结构化拒绝且 `pid` 有效时触发；`off` 零 spawn。
- `resolve`：只读 `GetMenu`/`GetSubMenu`/`GetMenuItemInfo`/`GetMenuString`，按精确路径返回 commandId；缺失/歧义/禁用/owner-draw/最终项含子菜单即拒绝。
- `invoke`：重新解析并校验 commandId 未变，只发一次 `PostMessage(WM_COMMAND)`；同 pid、只顶层窗口标准 HMENU，不碰系统菜单。
- PostMessage 只证明投递，不证明执行；结果 `effect:unverifiable`，不写用户文件、不联网；`Add-Type` 使用用户 TEMP。

### 2.4.2 原生 Button helper（Windows，实验性，按需）

```js
spawn('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', 'tools/native-button.ps1',
  '-Action', 'trigger', '-Pid', pid, '-Hwnd', hwnd,
  '-LabelB64', labelB64, '-TitleB64', titleB64, '-ScreenX', x, '-ScreenY', y,
], { windowsHide: true })
```

- 仅 `nativeButtonTrigger:auto`、Windows、`computer_click(element=Button)` 单次左键时触发；`off` 零 spawn。
- 只对同 pid 顶层窗口的标准 `Button`/`WindowsForms10.BUTTON*`；要求 `BS_PUSHBUTTON`/`BS_DEFPUSHBUTTON`（WinForms 允许 owner-draw）、label 归一化相等、屏幕点在 rect 内、全局唯一。
- 只发一次 `PostMessage(BM_CLICK)`；不激活、不自动选择 Yes/No；明确未匹配回退 driver；owner_disabled/超时不回退。

### 2.5 实验后台输入 helper（Windows，按需）

```js
spawn('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
  '-File', 'tools/background-input.ps1',
], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
```

- 仅 `backgroundInput/syntheticPointer/anchoredInput` 任一非 off、Windows、且目标没有可交互 UIA 元素时惰性启动；三键全 off 零 spawn。
- 持久进程，stdin/stdout JSON 行；启动输出 `{"ready":true}`；空闲 120s 退出；`computer_stop` 先发 `restore` + `shutdown`。
- 只对同 pid 目标：`probe` 校验 session/完整性/可见/最小化；B0 发 `WM_*`/`BM_CLICK`；B1 `InjectSyntheticPointerInput`；B2 `SetCursorPos`+`BlockInput`；B3 `SetWindowPos`。
- 不写用户文件、不联网；`Add-Type` 使用用户 TEMP；文本以 base64 跨 argv/stdin。

### 2.6 非运行时脚本

`install.sh` / `uninstall.sh` 是给用户手动执行的安装辅助脚本，**不是 npm lifecycle**；`package.json` 没有 `install` / `postinstall` / `prepare` 等脚本。

## 3. 文件与环境变量

### 3.1 文件访问

| 类型 | 状态 |
|---|---|
| 用户文件/项目文件读写 | ❌ 无 |
| 直接文件写入 | ⚠️ 默认无；仅当显式配置 `trajectoryFile` 或 `DSH_CU_TRAJECTORY_FILE` 时写该 JSONL（`mkdirSync` + `appendFileSync`） |
| 直接文件读取 | ⚠️ 仅 `existsSync()` 探测驱动可执行文件是否存在 |
| 随包脚本 | `tools/uia-password-scan.ps1`、`tools/password-probe.ps1`（手动探针）、`tools/private-drag.ps1`、`tools/native-dialog.ps1`、`tools/native-menu.ps1`、`tools/native-button.ps1`、`tools/background-input.ps1` |
| 临时文件 | Windows PowerShell `Add-Type` 会在用户 TEMP 写临时编译文件；插件不主动写用户文件；测试在工作区 `.dsh-test/` 下建工作副本 |

### 3.2 环境变量

| 变量 | 必填 | 用途 |
|---|---|---|
| `CUA_DRIVER_BIN` | 否 | 显式指定 cua-driver 路径 |
| `CUA_DRIVER_VERSION` | 否 | 覆盖版本探测（离线测试/排障） |
| `CUA_DRIVER_PROFILE` | 否 | 覆盖兼容档 `auto/legacy/latest`（配置 `driverProfile` 优先） |
| `CUA_CALL_TIMEOUT_MS` | 否 | 单次驱动调用超时，默认 30000ms（最小 1000） |
| `CUA_SESSION` | 否 | 驱动会话 id，默认 `dsh-win-computer-use` |
| `DSH_CU_TRAJECTORY_FILE` | 否 | 轨迹 JSONL 路径；优先于配置 `trajectoryFile` |
| `DSH_POWERSHELL` | 否 | 指定 PowerShell 可执行文件 |
| `S4_TEMP` / `DSH_TEMP` | 否 | 私有拖拽 `Add-Type` 编译临时目录；`S4_TEMP` 是历史命名，保留兼容 |
| `PATH` | 否 | 查找 `cua-driver` / `powershell.exe` |
| `ZHIPU_API_KEY` / `GLM_API_KEY` | 否 | GLM 视觉兜底；未配置则该路径停用 |
| `GLM_API_BASE` | 否 | GLM 端点，默认智谱官方 API |
| `GLM_VISION_MODEL` | 否 | GLM 首选模型，默认 `glm-4.6v-flash` |

不读取任何密钥文件（`~/.zhipu-key` 等历史路径已移除）。

## 4. 网络

| 路径 | 网络 | 说明 |
|---|---|---|
| 核心插件（观察/动作/验证/剪贴板/菜单/应用） | ❌ 无 | 只经本地驱动 |
| GLM 视觉兜底 | ⚠️ 条件性 | 仅当 `vision` 路径触发且 `ZHIPU_API_KEY`/`GLM_API_KEY` 已配置：`fetch(GLM_API_BASE)` POST 截图 base64 + 问题 |
| DeepSeek 视觉观察者（`vision` 模式） | ⚠️ 经宿主 | 插件调用 `ctx.llm.stream`；实际网络由宿主/模型 provider 发起 |
| `native` 模式 | ❌ 无额外网络 | 截图作为图片块交给当前对话模型；模型调用由宿主负责 |
| 子 agent 委派 | ⚠️ 经宿主 | 子会话的模型调用由宿主负责 |

**诚实表述**：核心插件无网络；启用 GLM 兜底后存在到智谱端点的外呼，且会把截图内容发送到该端点——这是数据外发，必须在部署时知悉。`package.json` 的 `externalServices` 已为条件性说明（核心无外部服务；可选 GLM 兜底外呼），以本文件为准。

## 5. 凭据与隐私

- **密码框硬保护**：`computer_type` / `computer_set_value` 命中密码框时拒绝自动输入；这是内容级唯一硬拒绝。
- **坐标模式盲区**：未指定 `element` 的坐标输入无法预知目标控件，密码保护只在 element 模式生效；回执会注记。
- **密码回显**：观察文本只显示 `值=•••`；点击回执对 `is_password` 元素显示 `值（已隐藏）`。
- **剪贴板**：`computer_clipboard(action="read")` 返回系统剪贴板真实文本，结果自带隐私注记；不要转述。
- **截图**：观察/zoom 的截图可能包含屏幕上的敏感信息；`native`/`vision` 会把它交给当前模型或观察者，GLM 兜底会外发到智谱。
- **无密钥文件读取**：仅环境变量。
- **不修改 OS 权限边界**：UIPI、TCC、管理员窗口仍由操作系统决定。

## 6. 权限信号（STORE 五信号）

| 信号 | 状态 | 说明 |
|---|---|---|
| 文件权限 | ⚠️ 命中 | `spawn` 子进程是核心能力；默认无用户文件读写；轨迹开启时写指定 JSONL；仅 `existsSync` 探测驱动 |
| 命令权限 | ⚠️ 命中 | 固定 argv：`cua-driver call/--version/status` 与 Windows `powershell.exe`（随包 sidecar）；`shell:false`；无 `exec`/`eval` |
| 网络权限 | ⚠️ 条件命中 | 核心无网络；可选 GLM 兜底在配置 key 后向 `GLM_API_BASE` 外呼（含截图） |
| 凭据权限 | ⚠️ 轻微命中（可选） | 读取 `ZHIPU_API_KEY`/`GLM_API_KEY` 环境变量；不读密钥文件；`CUA_DRIVER_BIN` 仅定位 |
| 生命周期脚本 | ✅ 无 | `package.json` 无 install/postinstall/prepare |

## 7. 承诺验证矩阵

> 安全承诺按平台实测；“代码看起来对”不算数。变更承诺必须同步本表与验证载体。

| 承诺 | Windows | macOS | Linux | 载体 |
|---|---|---|---|---|
| 凭据硬保护（密码框拒自动输入） | ✅ 结构位 + 启发式 | ✅ AX 角色（历史） | 未验证 | `posture.smoke` G/H + A6 探针 |
| 极危注记（不阻断） | ✅ | ✅ | ✅ 离线 | `posture.smoke` |
| `allowedApps` 白名单 | ✅ | ✅ 离线 | ✅ 离线 | `posture.smoke` / `config.plumbing` |
| 快照 TTL / 无快照拒绝 | ✅ | ✅ 离线 | ✅ 离线 | `posture.smoke` / `action-bounds` |
| 三级投递链 + 恢复原前台 | ✅ 真机 | 仅离线 | 仅离线 | `delivery-chain.smoke` |
| 强杀锁存（stop/resume） | ✅ 离线 | ✅ 离线 | ✅ 离线 | `tools.smoke` / `dispatcher.test` |
| `unknown ≠ 成功` | ✅ | ✅ 离线 | ✅ 离线 | `tools.smoke` / `schema.conformance` |
| 结构密码扫描 | ✅ 真机 9/9 | 不适用 | 不适用 | A6 探针 + `posture.smoke` |

## 8. 明确不做

- ❌ 不读取/修改用户文件、项目文件（轨迹是显式 opt-in 的本地日志）。
- ❌ 不写入宿主文件系统（截图走 attachments 服务）。
- ❌ 不读取密钥文件；不把 key 写入日志/回执。
- ❌ 不提供审批弹窗、危险词拦截或“确认后执行”；`extremePatterns` 只注记。
- ❌ 不承诺绕过 UIPI/TCC/管理员窗口边界。
- ❌ 不在 npm 生命周期中执行任何脚本。

## 9. 依赖

| 依赖 | 用途 | 解析方 |
|---|---|---|
| `@deepseek-ai/dsh-tools` | `defineTool` 注册与 schema 投影 | 宿主（peerDependencies `>=0.2.2-rc.1 <0.3.0`） |
| `@deepseek-ai/schemastery` | 配置 schema | 宿主（peerDependencies `>=3.19.0 <4`） |

`devDependencies` 固定实测宿主版本 `0.2.2-rc.1` / `3.19.0`；发布包不带 `node_modules`。

## 10. 失败边界

| 场景 | 行为 |
|---|---|
| cua-driver 缺失/不可启动 | 结构化错误 + 自救指引（`CUA_DRIVER_BIN`/PATH） |
| 守卫拒绝（密码/白名单/快照缺失或过期） | 明确拒绝原因；不执行动作 |
| 引擎拒绝（refusal/effect/error/code） | `ok:false` 结构化回执；不伪装成功 |
| 投递不可用 | 后台→前台→绕锁；仍失败则回执说明，不静默 |
| 超时 | 结构化超时（`computer_task` / `wait_for`） |
| 视觉不可用 | `vision` 优雅降级/错误文本；`native` 明确要求 image 模型 |

## 11. 权限变更检查

改 spawn/网络/env/文件/安全承诺时：

1. 更新 `package.json` 的 `dsh.permissions`（summary/commands/writePaths/externalServices/failureBoundaries）；
2. 更新本文件与 [docs/SECURITY.md](docs/SECURITY.md)；
3. 补/改测试（`posture.smoke`、`eval-safety`、`package-manifest`）；
4. 跑 `npm test; echo $?`、`npm run check`、`npm run docs:check`；
5. 真机验证至少跑 `verify-runtime`；涉及 Windows sidecar 时跑 `tools/password-probe.ps1`/私有拖拽探针。

完整安装/启动/卸载证据见 [docs/store-evidence.md](docs/store-evidence.md)。
