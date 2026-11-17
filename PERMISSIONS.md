# PERMISSIONS — dsh-win-computer-use 权限与安全声明

> 本文件声明插件在运行时**实际**使用的权限面（DSH STORE / 人工审查依据）。
> 变更任何 spawn、网络、环境变量、文件访问或安全承诺时，必须同步更新本文件与 `package.json` 的 `dsh.permissions`，并补测试。
> 最近核对：2026-11-10（`0.5.7-dev`）。

## 1. 运行时行为总览

插件本身不做桌面 I/O；它通过宿主 `spawn` 调用两个本地进程，并通过宿主服务读写图片/模型：

| 能力 | 机制 | 范围 |
|---|---|---|
| 桌面观察 | `cua-driver call get_window_state / get_desktop_state / list_windows / check_permissions …` | AX/UIA 树、窗口截图、权限面探测 |
| 桌面动作 | `cua-driver call click / type_text / set_value / press_key / hotkey / scroll / drag / …` | 虚拟光标、UIA/PostMessage/SendInput |
| 应用枚举/启动 | `cua-driver call list_apps / launch_app / bring_to_front` | 运行中应用与启动 |
| 验证/剪贴板/菜单 | `cua-driver call verify_state / clipboard_* / invoke_menu / move_cursor` | 确定性谓词、剪贴板、菜单、悬停 |
| 图片持久化 | 宿主 `attachments.saveImage` | 截图/zoom 图片，不直接写文件 |
| 视觉观察者 | 宿主 `ctx.llm`（`vision` 模式） | 截图 + 问题交给配置的视觉模型 |
| 子 agent 委派 | 宿主 `subagents.start`（`computer_task`） | 一次性子会话，能力受宿主限制 |
| 结构密码扫描 | `powershell.exe` + `tools/uia-password-scan.ps1` | Windows，只读 UIA/样式位 |
| 私有拖拽 | `powershell.exe` + `tools/private-drag.ps1` | Windows 前台 SendInput；仅 modifier drag / dwell_ms 路径，原子手势并恢复原前台 |

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
- 不写用户文件、不联网；`Add-Type` 使用调用方用户 TEMP（不是 `C:\Windows\TEMP`）。

### 2.4 非运行时脚本

`install.sh` / `uninstall.sh` 是给用户手动执行的安装辅助脚本，**不是 npm lifecycle**；`package.json` 没有 `install` / `postinstall` / `prepare` 等脚本。

## 3. 文件与环境变量

### 3.1 文件访问

| 类型 | 状态 |
|---|---|
| 用户文件/项目文件读写 | ❌ 无 |
| 直接文件写入 | ❌ 无（截图经宿主 attachments 持久化） |
| 直接文件读取 | ⚠️ 仅 `existsSync()` 探测驱动可执行文件是否存在（`lib/cua.js`） |
| 随包脚本 | `tools/uia-password-scan.ps1`、`tools/password-probe.ps1`（手动探针）、`tools/private-drag.ps1`（私有拖拽） |
| 临时文件 | Windows PowerShell `Add-Type` 会在用户 TEMP 写临时编译文件（UIA scan / private drag）；插件不主动写用户文件；测试在工作区 `.dsh-test/` 下建工作副本 |

### 3.2 环境变量

| 变量 | 必填 | 用途 |
|---|---|---|
| `CUA_DRIVER_BIN` | 否 | 显式指定 cua-driver 路径 |
| `PATH` | 否 | 查找 `cua-driver` / `powershell.exe` |
| `CUA_SESSION` | 否 | 虚拟光标会话 id，默认 `dsh-win-computer-use` |
| `ZHIPU_API_KEY` / `GLM_API_KEY` | 否 | GLM 视觉兜底；未配置则该路径停用 |
| `GLM_API_BASE` | 否 | GLM 端点，默认 `https://open.bigmodel.cn/api/paas/v4/chat/completions` |
| `GLM_VISION_MODEL` | 否 | GLM 首选模型，默认 `glm-4.6v-flash` |

不读取任何密钥文件（`~/.zhipu-key` 等历史路径已移除）。

## 4. 网络

| 路径 | 网络 | 说明 |
|---|---|---|
| 核心插件（观察/动作/验证/剪贴板/菜单/应用） | ❌ 无 | 只经本地驱动 |
| GLM 视觉兜底 | ⚠️ 条件性 | 仅当 `vision` 路径触发且 `ZHIPU_API_KEY`/`GLM_API_KEY` 已配置：`fetch(GLM_API_BASE)` POST 截图 base64 + 问题；默认端点是智谱官方 API |
| DeepSeek 视觉观察者（`vision` 模式） | ⚠️ 经宿主 | 插件调用 `ctx.llm.stream`；实际网络由宿主/模型 provider 发起，插件不直接 fetch |
| `native` 模式 | ❌ 无额外网络 | 截图作为图片块交给当前对话模型；模型调用本身由宿主负责 |
| 子 agent 委派 | ⚠️ 经宿主 | 子会话的模型调用由宿主负责 |

**诚实表述**：核心插件无网络；启用 GLM 兜底后存在到智谱端点的外呼，且会把截图内容发送到该端点——这是数据外发，必须在部署时知悉。`package.json` 的 `externalServices` 已改为条件性说明（核心无外部服务；可选 GLM 兜底外呼），但以本文件为准。

## 5. 凭据与隐私

- **密码框硬保护**：`computer_type` / `computer_set_value` 命中密码框时拒绝自动输入；这是内容级唯一硬拒绝。
- **坐标模式盲区**：未指定 `element` 的坐标输入无法预知目标控件，密码保护只在 element 模式生效；回执会注记。
- **剪贴板**：`computer_clipboard(action="read")` 返回系统剪贴板真实文本，结果自带隐私注记；不要转述。
- **截图**：观察/zoom 的截图可能包含屏幕上的敏感信息；`native`/`vision` 会把它交给当前模型或观察者，`GLM` 兜底会外发到智谱。
- **无密钥文件读取**：仅环境变量。
- **不修改 OS 权限边界**：UIPI、TCC、管理员窗口仍由操作系统决定。

## 6. 权限信号（STORE 五信号）

| 信号 | 状态 | 说明 |
|---|---|---|
| 文件权限 | ⚠️ 命中 | `spawn` 子进程是核心能力；无用户文件读写，仅 `existsSync` 探测驱动 |
| 命令权限 | ⚠️ 命中 | 固定 argv：`cua-driver` 与 Windows `powershell.exe`（随包只读 sidecar）；`shell:false`；无 `exec`/`eval` |
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

- ❌ 不读取/修改用户文件、项目文件。
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

完整安装/启动/卸载证据见 [docs/store-evidence.md](docs/store-evidence.md)。
