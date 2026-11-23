# MAINTAINING — 维护者手册

> 目的：干净工作区重新开始时，这份文档 + 仓库内文档 = 足够的上下文。
> 读者：本仓库维护者。
> 状态：当前实现（最后核对 2026-11-23；`0.6.0` 已发布并推送 npm）。
> 唯一文档索引：[docs/README.md](docs/README.md)；版本历史：[CHANGELOG.md](CHANGELOG.md)；逐轮证据：[docs/EVIDENCE.md](docs/EVIDENCE.md)。

## 1. 项目状态

- **名称**：`dsh-win-computer-use`（原名 `dsh-computer-use`，2026-11-10 更名）。
- **定位**：Windows-first Computer Use 插件，DeepSeek Harness（dsh）的桌面操作层；个人项目，MIT。
- **仓库**：`github.com/orangeofcarl0-sys/dsh-win-computer-use`，默认分支 `main`。
- **版本**：`v0.6.0` 已发布（2026-11-23；npm `dsh-win-computer-use@0.6.0`，tag `v0.6.0`）；`main` = 0.6.0，含 PTC 对象桥接（`ptcBridge` 默认 off）/`autonomy` 策略/relative 坐标。
- **工具面**：23 工具 = 22 桌面能力 + 1 dispatcher；默认 `dispatcher` 可见 2 / 隐藏 21；`hybrid` 可见 7 / 隐藏 16；`ptcBridge:on` 时 PTC preset 额外有 `computer_cua`。
- **安全姿态**：无感自治——零审批、零打断；凭据硬保护是唯一内容级硬拒绝；极危只注记。
- **测试基线**：`npm test` 33 套 / **1021** 项；`npm run check` 语法 **62/62** + 文档/任务一致性；`verify-runtime` **18/18**（0.23.2 与 0.52.13 均通过）。

## 2. 环境

| 项 | 值 |
|---|---|
| 工作副本 | `<repo>`（目录名未改；分支 `main`） |
| cua-driver | `C:\Users\<user>\.cua-driver\packages\current\cua-driver.exe`（canary **0.52.13**；基线 0.23.2 在 `packages/releases/`；daemon 由 `autostart kick` 的 `serve` 持有） |
| dsh | 全局 `0.2.2-rc.1`（自带 `@deepseek-ai/dsh-tools 0.2.2-rc.1` / `schemastery 3.19.0`）；兼容基线 `>=0.2.2-rc.1 <0.3.0` |
| 重启 harness | 本机脚本（不入库）；把当前 boot 的 tokened URL 落盘 |
| URL/token | `~/.dsh/web-latest.log` 最后一条 |
| 模型通道 | `~/.dsh/settings.yaml`：`agent-default-model` 可指向 `opencode-go / deepseek-v4.1-flash / high`；`llm-pi-ai.providers.opencode-go` 需 `baseURL=https://opencode.ai/zen/go/v1` + 请求头 `x-opencode-session` |
| 凭据 | `~/.dsh/.credentials.yaml`（`OPENCODE_GO_API_KEY` 可能过期 401；默认 DeepSeek 通道可用或余额耗尽）；GLM 兜底需 `ZHIPU_API_KEY`（当前未配） |
| eval 沙箱 | `%USERPROFILE%\.dsh\s4-evals\<taskId>\`（历史命名，冻结） |
| 一次性探针 | 工作区 `_probe-*.yml`、`_parity-*.mjs`、`_tool-surface.mjs`（不入库） |

**不要**把 key、token、实验产物写进仓库。模型通道的 key 只从本地配置读取，测试脚本不打印。

### 2.1 cua-driver 升级 / 回退

```powershell
# 安装指定版本（官方 installer；版本 pin 走环境变量）
$env:CUA_DRIVER_RS_VERSION = "0.52.13"
powershell -NoProfile -ExecutionPolicy Bypass -File <install.ps1>

# installer 若在临时目录清理阶段中止：版本目录已装好，手动完成切换
cua-driver stop
# current 是 junction：先删链接，再指向新版本（不要删 releases 目录）
cmd /c rmdir "$env:USERPROFILE\.cua-driver\packages\current"
cmd /c mklink /J "$env:USERPROFILE\.cua-driver\packages\current" `
  "$env:USERPROFILE\.cua-driver\packages\releases\0.52.13-x86_64-pc-windows-msvc"
cua-driver autostart kick
```

- **CLI 与 daemon 必须一起升级**；contract 不匹配会明确报 `contract version X does not match SDK Y`，插件给同步升级指引。
- 升级后顺序：`cua-driver --version` → `status` → `doctor` → `node verify-runtime.mjs` → `node evals/probe-driver-shape.mjs` → `probe-modifier` / `probe-combo-foreground` / `probe-private-drag` / `probe-from-zoom` / `probe-native-freshness` → t11/t14/t15/t17。
- 回退：重新 pin 0.23.2 安装，或把 `current` junction 指回 `releases/0.23.2-x86_64-pc-windows-msvc`，再 `stop` + `autostart kick`。
- 插件侧回退：配置 `driverProfile: legacy`（不发 `tree_format`、私有 modifier drag）；原生 drag 异常时 `dragEngine: private`。
- 每个版本目录不可变；不要覆盖 `releases/<version>/`，也不要把测量产物提交。

## 3. 硬知识（实验实证，勿凭直觉推翻）

### 3.1 坐标空间

- `computer_click(x,y)` = **窗口矩形左上角为原点的物理像素**（= 窗口截图空间）。2026-09-16 自绘探针逐点最小二乘，残差 ≤0.55px。
- 驱动元素 `frame` / sidecar rect = **屏幕物理像素**（A6 复核：标题栏 y=806 vs 窗口原点 y=780）。
- 截图 = 窗口 `bounds` 的 **1:1 物理像素裁剪**（同窗口 1906×1166 == 截图 1906×1166）→ `screenOrigin = bounds.x/y`。
- observe 输出时减去 `screenOrigin`，元素坐标进入点击空间；快照内部保留原始屏幕坐标给密码标记。
- `screen_zoom`：驱动对裁剪做约 **1.2× 上采样**，裁剪宽 ≤500px；`scale` 必须用驱动返回图尺寸算，不能用 attachments 归一化尺寸。
- **A7**：驱动 0.23.2 文档契约与实测在混合 DPI 下有矛盾；screen/bounds-local/client-local 三假设均有反例。结论：element 路径可靠，像素路径 best-effort；不要写“零标定命中”。

### 3.2 Windows 输入通道

- 经典 Win32（regedit）：`ctrl+f` 3/3 送达。
- WinUI3（Win11 记事本）：`hotkey` 有两种失败——UIA 加速器扫描 **4s 超时**（稳定复现，9/10）和 `could not find a UIA AcceleratorKey`（命令在关闭菜单里）；`press_key` 静默不达（`effect:unverifiable`）；`invoke_menu` 报 `menu_path_unavailable`。
- 替代路径：**点控件（element 编号）** 是可靠通道；保存类操作先点菜单栏项，再观察弹出菜单点具体项。
- 组合键必须前台注入：后台 synthetic 不更新 OS 修饰键状态，`Ctrl+V` 只落 `v`；插件自动前台并恢复原前台。
- 不要把原始引擎错误（尤其 `get_window_state` 建议）直接抛给模型。

### 3.3 密码框结构位

- 经典 Win32 `ES_PASSWORD` 在两种 UIA 客户端都映射 `IsPassword=false`；样式位才是系统真值（上游 #3576）。
- Windows sidecar 用 `NativeWindowHandle` + `GetWindowLongW` 读样式位；坐标与驱动 frame 同为屏幕 px，**直接匹配**。
- 旧实现按“窗口本地 + 原点换算”标记，实测标错相邻元素；0.5.3 已改为屏幕坐标直配。
- 误差方向安全：坐标错配只会漏标，不会误标；漏标时启发式接管。
- 密码硬拒只在 `element` 模式生效；坐标输入无法预知目标。

### 3.4 完整性级别与清理

- 0.23.2（当时）清单为 `requireAdministrator` → daemon High IL；**0.52.13 清单实测为 `asInvoker`**（2026-11-22 PE 复核：全二进制仅一处 `requestedExecutionLevel`；见 [docs/EVIDENCE](docs/EVIDENCE.md) §3）——daemon 是否 High 取决于启动方式，不是主 CLI 清单强制；`app_launch` 子进程 IL 取决于驱动/启动路径（0.52.13 实测 PowerShell 为 Medium；对照：同一 shell `Start-Process notepad` 也为 Medium）。
- 驱动**能**操作自己启动的 High IL 窗口（提权记事本 `computer_type` 成功且 confirmed）；非提权客户端**清不掉**（UIPI 拒绝 taskkill/Stop-Process/WM_CLOSE）。
- WinUI 目标上 `alt+f4` 撞 #3908、`invoke_menu` 不可用 → 只能人工收尾。
- 测试/评测优先操作已在运行的普通应用；`app_launch` 任务接受人工关闭成本。

### 3.5 dsh 工具注册与事件

- **必须用 `defineTool()` 的返回值注册**。它把作者面 schema 投影成宿主强制子集；直接传原始字面量会被 `assertSupportedJsonSchema` 拒绝 → **整棵插件树加载失败**（离线假注册表不校验，所以必须真机探针）。
- **不要订阅 waterfall 事件做观测**。`tools/post-execute` 是 cordis waterfall，监听器不调用 `next()` 就返回 undefined，注册表读 `decision.kind` 崩 → 每次工具调用都失败。仅观测挂 `tools/result`。
- 宿主参数表编译后不含 `additionalProperties`；写错的参数名会被静默丢弃。插件在 `wrap()` 单点拒绝未知参数。
- dsh 0.2.2 对工具输出严格校验（`additionalProperties:false`）；返回字段必须在 output schema 声明，降级路径也不例外。
- 依赖：`dsh-tools`/`schemastery` 放 peerDependencies，devDependencies 固定实测版本；不要把宿主包放进 dependencies。

### 3.6 子 agent 能力

- `ctx.subagents.startActivation(spec)` 使用**扁平 spec**：`{ provider, label, prompt, parent, signal, delivery:'caller', maxDepth, outputSchema, agentOptions }`。0.2.2-rc.2 类型声明写成嵌套 `request`，运行时读扁平字段——以运行时为准；`list()` 在 rc.2 运行时也不存在，provider 用 `getProvider` 探测。
- `outputSchema`/`maxDepth` 在 spawn-in-process provider 上可用；降级阶梯：全量 → 去 `outputSchema` → 报错。
- 每次降级/成功都要把**权限后果**写进回执（“子 agent 拥有与父会话同级的能力”）；0.2.2 即使全量成功也要写，因为它没有工具限制参数。
- 子 agent 默认不能再派生：`maxDepth=1`；工具集由宿主 Preset 决定，插件不维护白名单。

### 3.7 PowerShell / Windows 脚本

- PowerShell 5.1 把无 BOM 脚本按 ANSI 解析：`.ps1` 必须 **ASCII-only**，中文用码点构造。
- `TEMP=C:\Windows\TEMP` 时 `Add-Type -TypeDefinition` 可能报“未能找到源文件 …*.cs”；跑 `evals/` 前把 `TEMP`/`TMP` 指到 `%LOCALAPPDATA%\Temp`。
- 变量大小写不敏感，注意遮蔽；单元素数组会被解包，解析时做 `Array.isArray` 防御。
- sidecar 由 node 派生，继承 DPI 感知，返回物理 px；bash 直跑探针可能得逻辑 px，仅影响独立实验。
- 运行时 spawn 用固定 argv、`shell:false`、`windowsHide:true`；不要拼命令串。

### 3.8 Node / 测试

- Windows 上动态 `import()` 必须用 `pathToFileURL()`（绝对路径 `F:\...` 会被 ESM 拒绝）。
- `npm test` 用 `&&` 串联；必须看 `$?`，不能只 grep 输出。
- 工作副本放 `.dsh-test/`（已 gitignore）；测试结束清理。
- 驱动 daemon 偶发挂死/静默退出：重启 daemon 后复跑，先排除环境态再改代码。
- `npm run check` 现在包含 `tests/docs.check.mjs`；文档漂移会以 file:line 报错。

### 3.9 记事本清理

- Win11 记事本单进程多窗口/多标签，进程可能同时持有用户未保存文档；**绝不按进程名杀**。
- WM_CLOSE 会先弹“另存为”，该对话框 UIA 子树可能为空；无人值守时比不清理更危险。
- UIA “关闭标签页” `Invoke` 实测 no-op（#3908 同源）。
- `Start-Process -PassThru` 的 pid 是启动器，可能已退出；据此判断“已关闭”是假阳性。
- 结论：测试只报告残留标签，人工关闭；`live-action.e2e` 用唯一命名临时文件 + 标题匹配。
- 新 HWND 不等于干净窗口：Win11 会把 `TabState/*.bin` 恢复进新窗口；`Open/Close-TestNotepad` 必须按 UIA `TabItem` 校验精确 ExpectedTabs、无 modified/unknown；不安全就 fail closed/留窗。
- 运行 GUI eval 前先确认 Notepad 没有用户标签；标签白名单会拒绝污染窗口，但那只保护数据，不会让任务通过。

### 3.10 缓存与工具面

- 2026-11-09 opencode/deepseek-v4.1-flash 实测：稳定 dispatcher 重复 99.5%、首 tool_call 后 92.1%、第二次后 85.4%；tools 变化首击 0–18%。
- 因此：不要在会话中途注册/注销工具；不要复活 dynamic/lazy search；`hybrid` 也只是“更少隐藏”，可见面仍需稳定。
- `catalog` 是文本签名，复杂参数先查签名；必要时 system prompt 给示例。

## 4. 工作约定

1. **spec 先行**：详细推演 → 规范落文档（背景/目标/规格/AC/风险/分歧/审计）→ 分歧点用 AskUserQuestion → 拍板后逐阶段实现，每阶段审计测试。
2. **结构直接简洁，严禁兼容层**；重构零行为变化需机械验证（parity/JSON diff）。唯一的兼容层是 `lib/driver/`（驱动版本差异），不要为业务动作写第二套语义。
3. **测量驱动**：方案先实验；被数据否决的果断放弃（SoM、双原点、坐标三假设、动态工具面）。
4. **权限面诚实**：PERMISSIONS / summary / 矩阵与实现一致；条件性网络不能写成“无网络”。
5. **发布 gated**：push/tag/npm/部署切换只在用户明说“发布”时执行；本地提交自主。
6. **文档中文**；提交信息中文一句话（版本 + 主题）；LF/CRLF 警告忽略。
7. **真值/实验产物不进仓库**：报告、探针、截图、`dsv4fv-exp/` 一律工作区；仓库只进脚本与文档。
8. **测试窗口用完即清**：探针自带超时自关 + 脚本末尾清理 + 复核残留；清理按**标题/HWND**匹配，绝不按进程名。
9. **验证看退出码**：`npm test; echo $?` 或 `set -e`；`tail`/grep 会掩盖失败。
10. **禁止在 bash 命令里用反引号**（含内联 `node -e`）：反引号先被 shell 展开，会静默吞掉 Markdown/代码片段。写文件用编辑工具；必须内联时用 heredoc + 引号且内容不放反引号。

## 5. 部署现实

- **web profile 是拷贝，不是链接**：发布 tag 不会自动进入用户 harness；必须重新安装/链接并重启。
- 当前：`~/.dsh/profiles/web/node_modules/dsh-win-computer-use` = **0.5.8**（2026-11-20 安装并写入 bundles）；旧 `dsh-computer-use` 0.5.6 已移除，`dsh-computer-use.0.5.5-kept` 保留为备份。
- 切换版本：用新名重装/改目录名 → 重启 harness → 会话内 `computer_do(status)` 冒烟。
- **headless 探针通道**（不影响 web 客户端）：
  - `~/.dsh/profiles/headless/node_modules/dsh-win-computer-use` 建 junction → 本仓库。
  - overlay：仓库内 `evals/headless-patch.yml`（推荐；启用 `credentials` + insert 本插件）或工作区 `_probe-win-cu-deepseek.yml`；模型走 dsh 默认 `deepseek-official/deepseek-flash`。
  - **headless 默认禁用 `credentials`**；不启用会报 `MISSING_CREDENTIAL`，这不是插件加载错误。
  - 用法：`dsh --profile headless --patch "<repo>/evals/headless-patch.yml" --permission-mode read-only --approval-policy never "<任务>"`；headless 是“答一个任务即退出”的 profile。
  - eval headless 直跑：`node evals/headless-run.mjs --stage S1 --timeout-min 10`（日志在 `evals/headless-runs/`，gitignore）；旧 `--tier smoke` 仍可用。
- npm 已发布 `dsh-win-computer-use@0.6.0`；`dsh plugin add dsh-win-computer-use` 可用（需宿主支持）。
- CI：ubuntu Actions 跑 `npm ci` + `npm run check` + `npm test`；Windows self-hosted 为手动 workflow（同一套 + `verify-runtime`，exit 2 记 ENV；可选 safety/scroll/ops/modifier-drop/launch probes）。两个 workflow 都已在 `origin/main`；**Windows self-hosted 从未运行**，需要 runner + 人工 `workflow_dispatch`。ubuntu `npm test` 在 0.5.8 后因平台守卫失败，2026-11-20 已修；此后连续 success（截至 2026-11-22 已核 run 44956657353 / `1505db6`）。
- 详细步骤见 [PUBLISH.md](PUBLISH.md) §6。

## 6. 已知缺口

> 这些是当前真实状态。要么修代码，要么在文档中保留限制；不要写成“已支持”。

缺口清单**统一维护在 [ARCHITECTURE](docs/ARCHITECTURE.md) §13**（A7 像素落点、A11 手势原语、A17 私有拖拽、A18 `app_launch` 子进程 IL、A19 实验后台输入、A20 经典 HMENU、A21 原生 Button、G6 平台、G7 部署）；解除阻塞后先在 §13 删行，再同步 [VERIFICATION](VERIFICATION.md) 与 [docs/EVIDENCE](docs/EVIDENCE.md)。无法证明的能力不入 pass，见 [evals/BLOCKED](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/evals/BLOCKED.md)。

## 7. 待办

| 优先级 | 事项 |
|---|---|
| P1 | web profile 当前为 0.5.9（备份 `dsh-win-computer-use.0.5.8-kept`）；0.6.0 待切换；当前 3080 未监听，切换后下次启动生效；会话内冒烟待做 |
| P2 | AC6 长任务 5 轮（t01/t05 已完成；t11/t14/t15 待空闲桌面/模型额度） |
| P2 | daemon 提权/清理问题（#3607 上游已关闭）；0.52.13 实测 PowerShell 子进程 Medium，按实际 IL 判断 |
| P2 | #3908 实战影响面；把“路径受阻→改点控件”写进提示层 |
| P3 | macOS 回归；Linux 不在承诺范围 |
| P3 | 驱动库存候补（browser_*、set_window_frame、trajectory…） |
| P3 | 独立观察者裁决（原 S3b；需 ZHIPU key 或 dsv4fv 文本修复） |
| P3 | awesome-dsh-plugin 收录提交（草稿见 [PUBLISH](PUBLISH.md) §8） |

## 8. 文档维护规则

改代码时按下表同步文档；`npm run docs:check` 会校验工具名、配置键、错误码、链接、关键计数与标题结构。

| 改动 | 必须同步 |
|---|---|
| 工具名/参数/默认值/输出 schema | `docs/TOOLS.md`、`docs/ARCHITECTURE.md` 组计数、`CHANGELOG.md`；跑 `schema.conformance`/`dispatcher.test` |
| Config 键 | `docs/CONFIGURATION.md`、`tests/docs.facts.json` 的 `configKeys`、`tests/config.plumbing.mjs` |
| 错误码/回执语义 | `docs/ERRORS.md`、`docs/TROUBLESHOOTING.md`、`docs/RUNTIME-PIPELINE.md` §8 |
| 权限面（spawn/网络/env/文件） | `PERMISSIONS.md`、`package.json dsh.permissions`、`docs/SECURITY.md` |
| 发布文件/版本/依赖 | `docs/store-evidence.md`、`tests/docs.facts.json`、`docs/COMPATIBILITY.md` |
| 测试数/runtime 数/pack 数 | `tests/docs.facts.json`、`VERIFICATION.md`、`docs/TESTING.md`、`docs/store-evidence.md` |
| 评测任务/阶段 | `evals/tasks/*.md` 的 `stages`、`tests/tasks.check.mjs`、`evals/README.md`、`docs/TESTING.md`、`ROADMAP.md` |
| 历史运行/探针结果 | 只追加 `docs/EVIDENCE.md`；当前参考文档不写日期化步数 |

## 9. 改代码前的检查清单

- [ ] 是否先写了 spec/AC？分歧是否问过用户？
- [ ] 是否改变了工具面（描述/参数/输出 schema/可见性）？更新了 `docs/TOOLS.md`/`ARCHITECTURE.md`/`CHANGELOG.md` 与工具面 diff？
- [ ] 是否新增了配置键？`config.plumbing` 是否覆盖 schema↔cfg↔读取点？`docs.facts.json` 是否更新？
- [ ] 是否新增了操作类工具？`OPERATION_TOOLS` / `settleAction` / 快照绑定是否覆盖？
- [ ] 是否新增了返回字段/降级形态？`schema.conformance` 是否覆盖？
- [ ] 是否改了权限面（spawn/网络/env/文件）？`PERMISSIONS.md` + `package.json dsh.permissions` 是否同步？
- [ ] `npm test; echo $?`、`npm run check`、`verify-runtime` 是否全绿？
- [ ] 测试窗口是否按标题/HWND 清理、没有按进程名杀？
- [ ] 真值/实验产物是否仍在工作区，没有进仓库？
- [ ] `npm run check` 是否通过（语法 + docs + tasks）？
