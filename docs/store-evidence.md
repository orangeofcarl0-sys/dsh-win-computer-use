# store-evidence — 安装 / 启动 / 卸载证据

> 用途：DSH STORE 审查要求的一次性 profile 安装、启动、卸载证据与可复现步骤。
> 状态：当前实现（最后核对 2026-11-20；包名 `dsh-win-computer-use`，`0.5.8` 已发布 npm）。
> 权限面详见 [PERMISSIONS](../PERMISSIONS.md)；验证报告见 [VERIFICATION](../VERIFICATION.md)；安装细节见 [INSTALL](INSTALL.md)。

## 1. 一次性 profile 步骤（在 DSH 宿主执行）

```bash
# 0) 隔离环境（不触碰 ~/.dsh）
export DSH_HOME=$(mktemp -d /tmp/dsh-cu-profile-XXXXXX)

# 1) 安装
#    方式 A（npm 发布后）：npm install -g dsh-win-computer-use
#    方式 B（当前推荐，本地目录）：dsh plugin --profile cu-demo add /path/to/dsh-win-computer-use
#    方式 C（手动）：把本仓库链接/复制到 $DSH_HOME/profiles/<profile>/node_modules/dsh-win-computer-use
#    并在 $DSH_HOME/cordis.patch.yml 写入 insert 块（参考 cordis.patch.yml）

# 2) 启动冒烟：profile 应正常启动，工具注册表出现
#    默认 dispatcher：直接可见 computer_do + screen_observe；其余 21 个经 computer_do 路由
dsh --profile cu-demo --dump-config | grep dsh-win-computer-use

# 3) 实机只读冒烟（可选，需图形会话）
dsh --profile cu-demo "调用 computer_do(action='status')，把返回原文贴出来"
#    期望：surface=dispatcher；直接可见 computer_do,screen_observe；隐藏 21 个

# 4) 卸载
dsh plugin --profile cu-demo remove dsh-win-computer-use
#    重启后工具清单不再含 screen_observe / computer_*；
#    DSH_HOME 是临时目录，可整体删除实现彻底卸载
rm -rf "$DSH_HOME"
```

> npm 已发布 **`dsh-win-computer-use@0.5.8`**；方式 A 可用 `npm view dsh-win-computer-use version` 复核。发布步骤见 [PUBLISH](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) §7。

## 2. 证据（离线等价 + 真机加载）

| 检查 | 命令 | 结果 |
|---|---|---|
| 语法 + 安装脚本 | `npm run check` | **46/46** JS + `bash -n install.sh/uninstall.sh` + 文档/任务一致性 |
| 入口可加载 | `node -e "import('./index.js')"` | 成功（导出 `name` / `inject` / `Config` / `apply` / `toolDefinitions`） |
| 离线测试 | `npm test; echo $?` | **30 套 / 748 ✅ / 0 ❌** |
| dsh 真机加载 | `dsh --profile headless --patch <overlay> ...` | **✅ 2026-11-12**：dsh 0.2.2-rc.1，1 轮 5 步，2 可见/20 隐藏（当时），真实 `screen_observe` + dispatcher 路由 |
| 工具定义面 | `toolDefinitions()`（测试/诊断） | **23 个**：`computer_do` / `screen_observe` / `screen_zoom` / click / double / right / type / set_value / key / scroll / drag / wait / verify / wait_for / clipboard / menu / hover / stop / resume / app_list / app_launch / computer_activate / computer_task |
| 默认注册面 | `apply()` + 假注册表 | `dispatcher` 只注册 `computer_do` + `screen_observe`；隐藏 21 个经 dispatcher 路由；`hybrid` 注册 7 个 |
| 安全护栏 | `guard()` / `wrap()` | 凭据硬保护、无快照/过期拒绝、`allowedApps`、极危注记、stop/resume 锁存 |
| 权限声明 | `PERMISSIONS.md` + `package.json dsh.permissions` | spawn 固定 argv；核心无网络；可选 GLM 外呼如实声明；无 lifecycle |
| 文档/任务一致性 | `npm run check` | 工具/配置/错误码/链接/计数/标题结构 + S1-S4 阶段/脚本/AC2 |
| 打包面 | `npm pack --dry-run --json` | 以实际输出为准（见 §4） |

## 3. STORE 五信号

| 信号 | 响应 |
|---|---|
| 规范仓库 | `package.json` `repository` → `git+https://github.com/orangeofcarl0-sys/dsh-win-computer-use.git` |
| Node 兼容性 | `engines.node >= 22.18.0` + `dsh.compatibility.node`；dsh 兼容基线 `>=0.2.2-rc.1 <0.3.0` |
| 供应链 | 运行时 peer 依赖仅 `@deepseek-ai/dsh-tools` + `@deepseek-ai/schemastery`（宿主提供）；无第三方 runtime/optional 依赖；devDependencies 只用于测试 |
| 文件权限 | 有 `spawn`（cua-driver；Windows 按需 powershell.exe 跑 UIA 密码扫描/私有拖拽/原生对话框/实验后台输入）——插件核心能力；默认无用户文件读写；轨迹开启时写指定 JSONL；仅 `existsSync` 探测驱动 |
| 命令权限 | 固定 argv、`shell:false`：`cua-driver call …`；Windows `powershell.exe -File tools/uia-password-scan.ps1`（只读）、`tools/private-drag.ps1`（私有 SendInput 拖拽，按需）、`tools/native-dialog.ps1`（标准 #32770 扫描 + BM_CLICK，按需）、`tools/native-menu.ps1`（经典 HMENU 解析 + WM_COMMAND，默认 off）、`tools/background-input.ps1`（实验 B0/B1/B2/B3，默认 off） |
| 网络权限 | 核心无网络；可选 GLM 视觉兜底在配置 `ZHIPU_API_KEY`/`GLM_API_KEY` 后向 `GLM_API_BASE` 外呼（含截图）；`native`/DeepSeek 观察者经宿主模型通道 |
| 凭据权限 | 仅环境变量：`CUA_DRIVER_BIN`、`CUA_DRIVER_VERSION`、`CUA_DRIVER_PROFILE`、`CUA_CALL_TIMEOUT_MS`、`CUA_SESSION`、`DSH_CU_TRAJECTORY_FILE`、`DSH_POWERSHELL`、`S4_TEMP`/`DSH_TEMP`（`S4_TEMP` 为历史命名）、`ZHIPU_API_KEY`/`GLM_API_KEY`、`GLM_API_BASE`、`GLM_VISION_MODEL`；不读密钥文件 |
| 生命周期脚本 | 无 install/postinstall/prepare |

## 4. 打包内容

> 本节以 `npm pack --dry-run --json` 的实际输出为准；新增/删除发布文件后必须同步本清单、`tests/docs.facts.json` 与 `tests/package-manifest.test.mjs`。当前基线为 **64 文件**。

```text
LICENSE
PERMISSIONS.md
README.md
VERIFICATION.md
assets/demo-verified.png
cordis.patch.yml
docs/ARCHITECTURE.md
docs/BACKGROUND-INPUT.md
docs/COMPATIBILITY-0.2.2.md
docs/COMPATIBILITY.md
docs/CONFIGURATION.md
docs/CU-RESEARCH.md
docs/DRIVER-SDK.md
docs/ERRORS.md
docs/EVIDENCE.md
docs/INSTALL.md
docs/README.md
docs/RUNTIME-PIPELINE.md
docs/SECURITY.md
docs/store-evidence.md
docs/TESTING.md
docs/TOOLS.md
docs/TRAJECTORY-ANALYSIS.md
docs/TROUBLESHOOTING.md
docs/WINDOWS.md
index.js
lib/actions.js
lib/backgroundInput.js
lib/attach.js
lib/cua.js
lib/dispatcher.js
lib/driver/capabilities.js
lib/driver/info.js
lib/driver/normalize.js
lib/driver/transport.js
lib/engine.js
lib/guard.js
lib/human.js
lib/keyFallback.js
lib/loopGuard.js
lib/menu.js
lib/nativeDialogs.js
lib/nativeMenus.js
lib/observe.js
lib/ops.js
lib/passwordScan.js
lib/privateDrag.js
lib/receipt.js
lib/roles.js
lib/snapshot.js
lib/task.js
lib/trajectory.js
lib/vision.js
lib/windowMap.js
package.json
tools/background-input.ps1
tools/make_theme.py
tools/native-dialog.ps1
tools/native-menu.ps1
tools/password-probe.ps1
tools/private-drag.ps1
tools/uia-password-scan.ps1
verify-runtime.mjs
```

不包含：`tests/`、`evals/`、`node_modules/`、`.dsh-test/`、工作区探针、真值报告。`package.json` 的 `files` 是唯一白名单；新增发布文件必须同步本清单与 `tests/package-manifest.test.mjs`。

## 5. 安装后自检

```bash
node verify-runtime.mjs
```

期望：`结果：18/18 通过`。该脚本要求 `cua-driver` 可用且有可见窗口；只读观察，不执行桌面动作。若失败：

- `cua-driver not found` → 设 `CUA_DRIVER_BIN`；
- 没有可见窗口 → 打开一个普通应用窗口；
- 选中 `0×0` shell 弹窗 → 脚本已跳过 `bounds` 为 0 的窗口；仍有问题看 [WINDOWS](WINDOWS.md) §8。

## 6. 已知限制

- headless profile 默认禁用 `credentials`；探针 patch 启用后，2026-11-12 已在 dsh 0.2.2-rc.1 上完成真机加载与 5 步只读调用（2 可见/20 隐藏，当时）。默认配置下 `MISSING_CREDENTIAL` 不是插件加载错误。
- npm 已发布 `dsh-win-computer-use@0.5.8`；dsh-market 的 npm tarball 安装路径可用（需宿主支持）。
- web profile 已安装 `dsh-win-computer-use@0.5.8` 并切换 bundles（旧 `dsh-computer-use` 0.5.6 已移除，0.5.5-kept 保留备份）；运行中的 web 进程需重启生效。
- Linux 未验证；macOS 近期未回归。不要把“安装成功”当成“平台已验收”。
