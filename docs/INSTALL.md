# INSTALL — 安装、升级与卸载

> 目的：从零装好 `cua-driver` 与 `dsh-win-computer-use`，完成第一次观察，并知道如何升级/回退/卸载。
> 读者：首次使用者、部署维护者。
> 状态：当前实现（最后核对 2026-11-18）。安装脚本的实际行为与 npm 发布状态以本文为准。
> 相关：[README](../README.md) · [CONFIGURATION](CONFIGURATION.md) · [TROUBLESHOOTING](TROUBLESHOOTING.md) · [store-evidence](store-evidence.md)。

## 1. 前置

| 项 | 要求 | 说明 |
|---|---|---|
| 操作系统 | Windows 10/11 x64 | Windows 是深度实测目标；macOS 仅基础可用，Linux 未验证 |
| Node.js | `>=22.18.0` | `package.json` 的 `engines` 与 `dsh.compatibility.node` |
| dsh | `>=0.2.2-rc.1 <0.3.0` | 实测基线 `0.2.2-rc.1`；宿主自带 `@deepseek-ai/dsh-tools 0.2.2-rc.1` 与 `schemastery 3.19.0` |
| cua-driver | `0.23.2` 基线 / `0.52.13` canary | 驱动 CLI 与 daemon 必须同版本；兼容层见 [DRIVER-SDK](DRIVER-SDK.md) |
| 图形会话 | 有可见窗口 | 无窗口时 `screen_observe` 会返回候选为空；headless 环境不适合桌面动作 |
| 模型 | 支持工具调用 | `native`/`screen_zoom` 还要求当前模型声明 image 输入 |

## 2. 安装 cua-driver

按 [trycua/cua](https://github.com/trycua/cua) 的官方说明安装。插件按以下顺序定位可执行文件：

1. 环境变量 `CUA_DRIVER_BIN`（显式路径，优先级最高）；
2. `PATH` 中的 `cua-driver` / `cua-driver.exe`；
3. 常见安装路径：`~/.local/bin`、`/usr/local/bin`、`/opt/homebrew/bin`、`%LOCALAPPDATA%\cua-driver`、`~/.cua-driver/packages/current`；
4. 兜底字符串 `cua-driver`（由操作系统解析）。

安装后确认：

```powershell
cua-driver --version
cua-driver status
cua-driver doctor
```

Windows 上驱动二进制以管理员权限运行（清单 `requireAdministrator`），daemon 为 High IL；`app_launch` 子进程的完整性级别取决于驱动版本与启动路径（0.52.13 实测 PowerShell 为 Medium），详见 [WINDOWS](WINDOWS.md) §1。

> 驱动 CLI 与 daemon 版本不一致时，调用会报 `contract version X does not match SDK Y`。两者一起升级，再重启 daemon；不要在只升级一侧后继续排障。

## 3. 安装插件

npm 已发布 **`dsh-win-computer-use@0.5.7`**：可 `npm install dsh-win-computer-use` 或 `dsh plugin add dsh-win-computer-use`；也可用下面的源码/手工方式。

### 3.1 `install.sh`（bash，推荐给已有 `profiles/web` 的环境）

```bash
git clone https://github.com/orangeofcarl0-sys/dsh-win-computer-use.git
cd dsh-win-computer-use
./install.sh --dry-run   # 只打印将写入的路径
./install.sh             # 链接插件 + 写 home 级 patch
```

实际行为：

- `DSH_HOME` 默认是 macOS 路径 `$HOME/Library/Application Support/harness-desktop/dsh-home`；Windows/Linux 必须先设置，例如 Git Bash：

```bash
export DSH_HOME="/c/Users/<user>/.dsh"
```

- 把仓库链接到 `$DSH_HOME/profiles/web/node_modules/dsh-win-computer-use`；
- 在 `$DSH_HOME/cordis.patch.yml` 追加 `insert` 块（`surfaceMode: dispatcher`、`ttlMs: 60000`、`maxElements: 120`）；
- 已存在同名块时跳过，幂等；
- 要求 `$DSH_HOME/profiles/web/node_modules` 已存在；不是 Windows 原生安装器，也不创建 profile。

### 3.2 手动安装（Windows PowerShell）

适合不想用 bash、或需要指定其它 profile 的环境。

```powershell
$repo = "<repo>"
$dsh  = "$env:USERPROFILE\.dsh"
$nm   = "$dsh\profiles\web\node_modules"
New-Item -ItemType Directory -Force $nm | Out-Null
New-Item -ItemType Junction -Path "$nm\dsh-win-computer-use" -Target $repo
```

然后在 `$dsh\cordis.patch.yml` 加入：

```yaml
- insert:
    - id: dsh-win-computer-use
      name: dsh-win-computer-use
      config:
        surfaceMode: dispatcher
        ttlMs: 60000
        maxElements: 120
        deliveryMode: auto
```

加载器从 profile 的 `node_modules` 解析插件名；`cordis.patch.yml` 只是注册，不复制代码。改仓库代码后重启宿主即可生效（链接指向仓库）。

### 3.3 隔离 profile / headless 评测

评测建议用独立 profile，不触碰日常 web profile：

```bash
# 仓库内已提供 headless overlay（启用 credentials + 插入本插件）
dsh --profile headless --patch "<repo>/evals/headless-patch.yml" \
  --permission-mode read-only --approval-policy never \
  "调用 computer_do(action='status')，把返回原文贴出来"
```

- headless profile 默认 `credentials: disabled`；不启用 overlay 会报 `MISSING_CREDENTIAL`，这不是插件加载错误。
- headless profile 的 `node_modules` 也需要指向本仓库的 junction；具体见 [MAINTAINING](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/MAINTAINING.md)。
- `evals/headless-patch.opencode.yml` 是另一条模型通道的 overlay；不要把 key 写进仓库。

## 4. 第一次启动与自检

1. 重启宿主（web profile 需要重新加载插件）。
2. 确认合成配置包含插件：

```bash
dsh --profile web --dump-config | grep dsh-win-computer-use
```

3. 在会话里调用：

```text
computer_do(action="status")
```

期望：`dispatcher` 模式；直接可见 `computer_do, screen_observe`；隐藏 21 个。

4. 观察一个真实窗口：

```text
screen_observe(window="Notepad")
```

期望：编号元素、坐标、`snapshotId`、坐标空间说明；动作前没有快照会被拒绝（`[snapshot_missing]`），这是保护而不是故障。

5. 只读运行时检查（需要驱动与可见窗口）：

```bash
node verify-runtime.mjs
```

期望：`结果：18/18 通过`。

## 5. 配置写在哪里

| 位置 | 作用 | 优先级 |
|---|---|---|
| profile 的 `cordis.patch.yml` | 该 profile 的插件配置 | 高 |
| `$DSH_HOME/cordis.patch.yml` | 用户级 home patch（`install.sh` 写这里） | 中 |
| 插件包内 `cordis.patch.yml` | bundle 默认值 | 低 |
| `--patch <file>` | 一次性 overlay（评测/探针） | 最高（按加载顺序覆盖） |

完整 24 键说明见 [CONFIGURATION](CONFIGURATION.md)。只改 `surfaceMode` 等少量键时，保留其余默认值即可。

## 6. 升级

```bash
# 1. 先备份当前部署目录（不要直接覆盖）
# 2. 更新仓库（git pull / 切换 tag）
# 3. 重启宿主
# 4. 会话内 computer_do(action="status") 冒烟
# 5. node verify-runtime.mjs
```

- 升级驱动时 CLI 与 daemon 一起升级；升级后按 [DRIVER-SDK](DRIVER-SDK.md) §7 的顺序跑探针。
- 插件版本以 `package.json` 与 [CHANGELOG](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/CHANGELOG.md) 为准；当前 `v0.5.7` 已发布（npm `dsh-win-computer-use@0.5.7`），本地 `main` 含 0.5.8 未发布提交（未推送）。
- 升级后若工具消失：先看 `--dump-config` 和宿主日志，不要先怀疑模型。

## 7. 回退

- **插件**：把 profile 的 `dsh-win-computer-use` junction/目录指回上一个版本，重启宿主。
- **驱动**：把 `~/.cua-driver/packages/current` junction 指回旧版本目录，`cua-driver stop` 后 `cua-driver autostart kick`；或重新安装指定版本。
- **配置**：`driverProfile: legacy` 强制旧请求形态；`dragEngine: private` 强制私有拖拽 helper。两者都是排障/回退开关，不是长期默认。
- 不要把 `releases/<version>/` 覆盖或删除；每个版本目录不可变。

## 8. 卸载

```bash
DSH_HOME="/c/Users/<user>/.dsh" ./uninstall.sh
```

实际行为：删除 `$DSH_HOME/cordis.patch.yml` 中 `install.sh` 生成的注册块，并删除 `profiles/web/node_modules/dsh-win-computer-use` 链接；不删除仓库本身，不删除用户文件，不卸载驱动。

手动卸载：删除对应 `insert` 块与 junction，重启宿主。卸载后工具清单不再包含 `screen_observe` / `computer_*`。

## 9. 安装排障

| 现象 | 原因 | 处理 |
|---|---|---|
| `MISSING_CREDENTIAL` | headless 默认禁用 `credentials`，或 provider key 未配置 | 用启用 credentials 的 overlay；确认 `~/.dsh/.credentials.yaml`（不要打印 key） |
| `--dump-config` 没有插件 | patch 未加载、profile 不对、junction 不存在 | 检查 profile 层序与 `node_modules` 路径；重启宿主 |
| `cua-driver not found` | 不在 PATH | 设 `CUA_DRIVER_BIN` 或安装驱动 |
| `contract version ... does not match` | CLI 与 daemon 不同版本 | 一起升级并重启 daemon |
| 工具调用全部报 schema 错误 | 用了原始工具定义而非 `defineTool()` 返回值，或包不完整 | 这种错误通常意味着整棵插件树加载失败；用 headless 真机探针确认 |
| `screen_observe` 没有窗口 | 图形会话/权限/目标最小化 | 打开一个普通窗口；不要用 `0×0` shell 弹窗 |
| npm 安装失败 | 包名/版本/registry 不对 | 确认 `npm view dsh-win-computer-use version` 为 0.5.7；旧名 `dsh-computer-use` 是上游 0.3.1，不要装 |
| `install.sh` 报找不到 `profiles/web/node_modules` | `DSH_HOME` 不对或 profile 不存在 | 设对 `DSH_HOME`，先用 dsh 创建 web profile，或改用手动安装 |

更多运行时失败见 [TROUBLESHOOTING](TROUBLESHOOTING.md) 与 [ERRORS](ERRORS.md)。
