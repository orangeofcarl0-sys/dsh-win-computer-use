# store-evidence — dsh-win-computer-use 安装 / 启动 / 卸载证据

> 用途：DSH STORE 审查要求的一次性 profile 安装、启动、卸载证据与可复现步骤。
> 最近核对：2026-11-10（`0.5.7-dev`；包名 `dsh-win-computer-use`）。
> 权限面详见 [PERMISSIONS.md](../PERMISSIONS.md)；验证报告见 [VERIFICATION.md](../VERIFICATION.md)。

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
#    默认 dispatcher：直接可见 computer_do + screen_observe；其余 20 个经 computer_do 路由
dsh --profile cu-demo --dump-config | grep dsh-win-computer-use

# 3) 实机只读冒烟（可选，需图形会话）
dsh --profile cu-demo "调用 computer_do(action='status')，把返回原文贴出来"
#    期望：surface=dispatcher；直接可见 computer_do,screen_observe；隐藏 20 个

# 4) 卸载
dsh plugin --profile cu-demo remove dsh-win-computer-use
#    重启后工具清单不再含 screen_observe / computer_*；
#    DSH_HOME 是临时目录，可整体删除实现彻底卸载
rm -rf "$DSH_HOME"
```

> 当前 npm **尚未发布**；方式 A 只有在 `npm view dsh-win-computer-use version` 有输出后才可用。发布步骤见 [PUBLISH.md](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) §7。

## 2. 证据（离线等价 + 真机加载）

| 检查 | 命令 | 结果 |
|---|---|---|
| 语法 + 安装脚本 | `npm run check` | **26/26** JS + `bash -n install.sh/uninstall.sh` |
| 入口可加载 | `node -e "import('./index.js')"` | 成功（导出 `name` / `inject` / `Config` / `apply` / `toolDefinitions`） |
| 离线测试 | `npm test; echo $?` | **26 套 / 621 ✅ / 0 ❌** |
| dsh 真机加载 | `dsh --profile headless --patch <probe.yml> ...` | **✅ 2026-11-12**：dsh 0.2.2-rc.1，1 轮 5 步，2 可见/20 隐藏（当时），真实 `screen_observe` + dispatcher 路由 |
| 工具定义面 | `toolDefinitions()`（测试/诊断） | **23 个**：`computer_do` / `screen_observe` / `screen_zoom` / click / double / right / type / set_value / key / scroll / drag / wait / verify / wait_for / clipboard / menu / hover / stop / resume / app_list / app_launch / computer_activate / computer_task |
| 默认注册面 | `apply()` + 假注册表 | `dispatcher` 只注册 `computer_do` + `screen_observe`；隐藏 21 个经 dispatcher 路由；`hybrid` 注册 7 个 |
| 安全护栏 | `guard()` / `wrap()` | 凭据硬保护、无快照/过期拒绝、`allowedApps`、极危注记、stop/resume 锁存 |
| 权限声明 | `PERMISSIONS.md` + `package.json dsh.permissions` | spawn 固定 argv；核心无网络；可选 GLM 外呼如实声明；无 lifecycle |
| 打包面 | `npm pack --dry-run --json` | **47 文件**（见 §4），无 `node_modules` / `.dsh-test` / `tests` / `evals` |

## 3. STORE 五信号

| 信号 | 响应 |
|---|---|
| 规范仓库 | `package.json` `repository` → `git+https://github.com/orangeofcarl0-sys/dsh-win-computer-use.git` |
| Node 兼容性 | `engines.node >= 22.18.0` + `dsh.compatibility.node`；dsh 兼容基线 `>=0.2.2-rc.1 <0.3.0` |
| 供应链 | 运行时 peer 依赖仅 `@deepseek-ai/dsh-tools` + `@deepseek-ai/schemastery`（宿主提供）；无第三方 runtime/optional 依赖；devDependencies 只用于测试 |
| 文件权限 | 有 `spawn`（cua-driver；Windows 按需 powershell.exe 跑 UIA 密码扫描/私有拖拽）——插件核心能力；无用户文件读写；仅 `existsSync` 探测驱动 |
| 命令权限 | 固定 argv、`shell:false`：`cua-driver call …`；Windows `powershell.exe -File tools/uia-password-scan.ps1`（只读）、`tools/private-drag.ps1`（私有 SendInput 拖拽，按需） |
| 网络权限 | 核心无网络；可选 GLM 视觉兜底在配置 `ZHIPU_API_KEY`/`GLM_API_KEY` 后向 `GLM_API_BASE` 外呼（含截图）；`native`/DeepSeek 观察者经宿主模型通道 |
| 凭据权限 | 仅环境变量：`CUA_DRIVER_BIN`、`CUA_SESSION`、`ZHIPU_API_KEY`/`GLM_API_KEY`、`GLM_API_BASE`、`GLM_VISION_MODEL`；不读密钥文件 |
| 生命周期脚本 | 无 install/postinstall/prepare |

## 4. 打包内容（47 文件）

```text
LICENSE
PERMISSIONS.md
README.md
VERIFICATION.md
assets/demo-verified.png
cordis.patch.yml
docs/ARCHITECTURE.md
docs/COMPATIBILITY-0.2.2.md
docs/CU-RESEARCH.md
docs/DRIVER-SDK.md
docs/RUNTIME-PIPELINE.md
docs/TESTING.md
docs/TRAJECTORY-ANALYSIS.md
docs/WINDOWS.md
docs/store-evidence.md
index.js
lib/actions.js
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
tools/make_theme.py
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

期望：`结果：17/17 通过`。该脚本要求 `cua-driver` 可用且有可见窗口；只读观察，不执行桌面动作。若失败：

- `cua-driver not found` → 设 `CUA_DRIVER_BIN`；
- 没有可见窗口 → 打开一个普通应用窗口；
- 选中 `0×0` shell 弹窗 → 脚本已跳过 `bounds` 为 0 的窗口；仍有问题看 [docs/WINDOWS.md](WINDOWS.md) §8。

## 6. 已知限制

- headless profile 默认禁用 `credentials`；探针 patch 启用后，2026-11-12 已在 dsh 0.2.2-rc.1 上完成真机加载与 5 步只读调用（2 可见/20 隐藏）。默认配置下 `MISSING_CREDENTIAL` 不是插件加载错误。
- npm 未发布；dsh-market 的 npm tarball 安装路径暂不可用。
- web profile 当前仍是旧名 `dsh-computer-use` v0.5.3；更名后需重新安装为 `dsh-win-computer-use`。
- Linux 未验证；macOS 近期未回归。不要把“安装成功”当成“平台已验收”。
