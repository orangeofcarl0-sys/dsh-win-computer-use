# MAINTAINING — 维护者手册

> 目的：干净工作区重新开始时，这份文档 + 仓库内文档 = 足够的上下文。
> 读者：本仓库维护者。它取代 2026-09-16 的 `HANDOFF`；历史细节仍在 git 历史与 [CHANGELOG](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/CHANGELOG.md) 中。
> 最近更新：2026-11-10（`0.5.7-dev`；`v0.5.6` 已发布）。

## 1. 项目状态

- **名称**：`dsh-win-computer-use`（原名 `dsh-computer-use`，2026-11-10 更名）。
- **定位**：Windows-first Computer Use 插件，DeepSeek Harness（dsh）的桌面操作层；个人项目，MIT。
- **仓库**：`github.com/orangeofcarl0-sys/dsh-win-computer-use`，默认分支 `main`。
- **版本**：`v0.5.6` 已发布（tag → `68770fd`）；`main` 为 `0.5.7-dev`（未发布：更名、dispatcher 默认、P0/P1 边界）。
- **工具面**：22 工具 = 21 桌面能力 + 1 dispatcher；默认 `dispatcher` 可见 2 / 隐藏 20；`hybrid` 可见 7 / 隐藏 15。
- **安全姿态**：无感自治——零审批、零打断；凭据硬保护是唯一内容级硬拒绝；极危只注记。
- **测试基线**：`npm test` 10 套 / 231 断言；`npm run check` 16/16；`verify-runtime` 16/16。

## 2. 文档地图

| 文档 | 角色 |
|---|---|
| [README](README.md) | 用户入口、工具参考、配置、边界 |
| [docs/ARCHITECTURE](docs/ARCHITECTURE.md) | 模块、流水线、快照/投递、扩展指南、已知缺口 |
| [docs/WINDOWS](docs/WINDOWS.md) | Windows 工程细节、冒烟矩阵、清理规则 |
| [docs/TESTING](docs/TESTING.md) | 测试分层、断言清单、排障 |
| [VERIFICATION](VERIFICATION.md) | 验证矩阵、历史证据、未验证项 |
| [PERMISSIONS](PERMISSIONS.md) | 权限面、网络/凭据/命令、承诺矩阵 |
| [docs/store-evidence](docs/store-evidence.md) | STORE 安装/启动/卸载证据 |
| [ROADMAP](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/ROADMAP.md) | 已交付、待实验、上游缺口、明确不做 |
| [PUBLISH](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) | 版本口径、发布检查、部署/npm |
| [CHANGELOG](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/CHANGELOG.md) | 版本历史 |
| [evals/README](evals/README.md) | S4 任务集、oracle、runner |

## 3. 环境

| 项 | 值 |
|---|---|
| 工作副本 | `F:\Codex_Work_Space\DSH plugin\dsh-computer-use`（目录名未改；分支 `main`） |
| cua-driver | `C:\Users\66494\.cua-driver\packages\current\cua-driver.exe`（0.23.2；daemon 由 `serve --socket \\.\pipe\cua-driver` 持有） |
| dsh | 全局 `0.2.2-rc.1`（自带 `@deepseek-ai/dsh-tools 0.2.2-rc.1` / `schemastery 3.19.0`）；兼容下限 `>=0.1.5-rc.2` |
| 重启 harness | `~/.dsh/restart-dsh-capture.ps1`（把当前 boot 的 tokened URL 落盘） |
| URL/token | `~/.dsh/web-latest.log` 最后一条 |
| 模型通道 | `~/.dsh/settings.yaml`：`agent-default-model` = `opencode-go / deepseek-v4.1-flash / high`；`llm-pi-ai.providers.opencode-go` 需 `baseURL=https://opencode.ai/zen/go/v1` + 必需请求头 `x-opencode-session` |
| 凭据 | `~/.dsh/.credentials.yaml`（含 `OPENCODE_GO_API_KEY`，2026-11-12 实测已过期 401；默认 DeepSeek 通道可用）；GLM 兜底需 `ZHIPU_API_KEY`（当前未配） |
| S4 沙箱 | `%USERPROFILE%\.dsh\s4-evals\<taskId>\` |
| 一次性探针 | 工作区 `_probe-surface.yml`、`_probe-win-cu-deepseek.yml`、`_parity-observe.mjs`、`_tool-surface.mjs`（不入库） |

**不要**把 key、token、实验产物写进仓库。模型通道的 key 只从本地配置读取，测试脚本不打印。

## 4. 硬知识（实验实证，勿凭直觉推翻）

### 4.1 坐标空间

- `computer_click(x,y)` = **窗口矩形左上角为原点的物理像素**（= 窗口截图空间）。2026-09-16 自绘探针逐点最小二乘，残差 ≤0.55px。
- 驱动元素 `frame` / sidecar rect = **屏幕物理像素**（A6 复核：标题栏 y=806 vs 窗口原点 y=780）。
- 截图 = 窗口 `bounds` 的 **1:1 物理像素裁剪**（同窗口 1906×1166 == 截图 1906×1166）→ `screenOrigin = bounds.x/y`。
- observe 输出时减去 `screenOrigin`，元素坐标进入点击空间；快照内部保留原始屏幕坐标给密码标记。
- `screen_zoom`：驱动对裁剪做约 **1.2× 上采样**，裁剪宽 ≤500px；`scale` 必须用驱动返回图尺寸算，不能用 attachments 归一化尺寸。
- **A7**：驱动 0.23.2 文档契约与实测在混合 DPI 下有矛盾；screen/bounds-local/client-local 三假设均有反例。结论：element 路径可靠，像素路径 best-effort；不要写“零标定命中”。

### 4.2 Windows 输入通道

- 经典 Win32（regedit）：`ctrl+f` 3/3 送达。
- WinUI3（Win11 记事本）：`hotkey` 的 UIA 加速器扫描 **4s 超时**（稳定复现，9/10）；`press_key` 静默不达（`effect:unverifiable`）；`invoke_menu` 报 `menu_path_unavailable`。
- 替代路径：**点控件（element 编号）** 是可靠通道；保存类操作点菜单/工具栏。
- 插件把 UIA 超时翻译成“改点控件”的可执行指引；不要把原始引擎错误直接抛给模型。

### 4.3 密码框结构位

- 经典 Win32 `ES_PASSWORD` 在两种 UIA 客户端都映射 `IsPassword=false`；样式位才是系统真值（上游 #3576）。
- Windows sidecar 用 `NativeWindowHandle` + `GetWindowLongW` 读样式位；坐标与驱动 frame 同为屏幕 px，**直接匹配**。
- 旧实现按“窗口本地 + 原点换算”标记，实测标错相邻元素（真密码框漏标、普通框误标）；0.5.3 已改为屏幕坐标直配。
- 误差方向安全：坐标错配只会漏标，不会误标；漏标时启发式接管。

### 4.4 完整性级别与清理

- `cua-driver.exe` 清单 `requireAdministrator` → daemon High IL；`app_launch` 子进程继承 High IL（对照：同一 shell `Start-Process notepad` 为 Medium）。
- 驱动**能**操作自己启动的 High IL 窗口（提权记事本 `computer_type` 成功且 confirmed）；非提权客户端**清不掉**（UIPI 拒绝 taskkill/Stop-Process/WM_CLOSE）。
- WinUI 目标上 `alt+f4` 撞 #3908、`invoke_menu` 不可用 → 只能人工收尾。
- 测试/评测优先操作已在运行的普通应用；`app_launch` 任务接受人工关闭成本。

### 4.5 dsh 工具注册与事件

- **必须用 `defineTool()` 的返回值注册**。它把作者面 schema 投影成宿主强制子集（属性级 `required:true` → object 级 `required` 数组；参数映射为隐式开放对象根）。直接传原始字面量会被 `assertSupportedJsonSchema` 拒绝 → **整棵插件树加载失败**（离线假注册表不校验，所以必须真机探针）。
- **不要订阅 waterfall 事件做观测**。`tools/post-execute` 是 cordis waterfall，监听器不调用 `next()` 就返回 undefined，注册表读 `decision.kind` 崩 → 每次工具调用都失败。仅观测挂 `tools/result`。
- 宿主参数表编译后不含 `additionalProperties`；写错的参数名会被静默丢弃。插件在 `wrap()` 单点拒绝未知参数，避免回退到非目标窗口。
- dsh 0.1.5+ 对工具输出严格校验（`additionalProperties:false`）；返回字段必须在 output schema 声明，降级路径也不例外。
- 依赖：`dsh-tools`/`schemastery` 放 peerDependencies，devDependencies 固定实测版本；不要把宿主包放进 dependencies。

### 4.6 子 agent 能力

- `toolFilter` 在宿主内部是 scoped `tools.restrict()`，名字校验**只认全局层**；默认 dispatcher 下 20 个桌面工具不注册为全局工具 → toolFilter 很可能被拒（`tools.restrict() names unknown global tools`）。
- `outputSchema`/`maxDepth` 在 spawn-in-process provider 上仍可用；降级不能“一把全丢”，要按阶梯：全量 → 去 toolFilter → 去 outputSchema → 报错。
- 每次降级都要把**拒绝原因与权限后果**写进回执（“子 agent 拥有与父会话同级的能力”）。
- 子 agent 不能再派生：`maxDepth=1` 且白名单不含 `computer_task`。

### 4.7 PowerShell / Windows 脚本

- PowerShell 5.1 把无 BOM 脚本按 ANSI 解析：`.ps1` 必须 **ASCII-only**，中文用码点构造。
- `TEMP=C:\Windows\TEMP` 时 `Add-Type -TypeDefinition` 可能报“未能找到源文件 …*.cs”（2026-11-12 实测导致 S4 0/10）；跑 `evals/` 前把 `TEMP`/`TMP` 指到 `%LOCALAPPDATA%\Temp`。
- 变量大小写不敏感，注意遮蔽；单元素数组会被解包，解析时做 `Array.isArray` 防御。
- sidecar 由 node 派生，继承 DPI 感知，返回物理 px；bash 直跑探针可能得逻辑 px，仅影响独立实验。
- 运行时 spawn 用固定 argv、`shell:false`、`windowsHide:true`；不要拼命令串。

### 4.8 Node / 测试

- Windows 上动态 `import()` 必须用 `pathToFileURL()`（绝对路径 `F:\...` 会被 ESM 拒绝）。
- `npm test` 用 `&&` 串联；必须看 `$?`，不能只 grep 输出。
- 工作副本放 `.dsh-test/`（已 gitignore）；测试结束清理。
- 驱动 daemon 偶发挂死/静默退出：重启 daemon 后复跑，先排除环境态再改代码。

### 4.9 记事本清理（血泪）

- Win11 记事本单进程多窗口/多标签，进程可能同时持有用户未保存文档；**绝不按进程名杀**。
- WM_CLOSE 会先弹“另存为”，该对话框 UIA 子树可能为空；无人值守时比不清理更危险。
- UIA “关闭标签页” `Invoke` 实测 no-op（#3908 同源）。
- `Start-Process -PassThru` 的 pid 是启动器，可能已退出；据此判断“已关闭”是假阳性。
- 结论：测试只报告残留标签，人工关闭；`live-action.e2e` 用唯一命名临时文件 + 标题匹配。

### 4.10 缓存与工具面

- 2026-11-09 opencode/deepseek-v4.1-flash 实测：稳定 dispatcher 重复 99.5%、首 tool_call 后 92.1%、第二次后 85.4%；tools 变化首击 0–18%。
- 因此：不要在会话中途注册/注销工具；不要复活 dynamic/lazy search；`hybrid` 也只是“更少隐藏”，可见面仍需稳定。
- `catalog` 是文本签名，复杂参数先查签名；必要时 system prompt 给示例。

## 5. 工作约定

1. **spec 先行**：详细推演 → 规范落文档（背景/目标/规格/AC/风险/分歧/审计）→ 分歧点用 AskUserQuestion → 拍板后逐阶段实现，每阶段审计测试。
2. **结构直接简洁，严禁兼容层**；重构零行为变化需机械验证（parity/JSON diff）。
3. **测量驱动**：方案先实验；被数据否决的果断放弃（SoM、双原点、坐标三假设、动态工具面）。
4. **权限面诚实**：PERMISSIONS / summary / 矩阵与实现一致；条件性网络不能写成“无网络”。
5. **发布 gated**：push/tag/npm/部署切换只在用户明说“发布”时执行；本地提交自主。
6. **文档中文**；提交信息中文一句话（版本 + 主题）；LF/CRLF 警告忽略。
7. **真值/实验产物不进仓库**：报告、探针、截图、`dsv4fv-exp/` 一律工作区；仓库只进脚本与文档。
8. **测试窗口用完即清**：探针自带超时自关 + 脚本末尾清理 + 复核残留；清理按**标题**匹配，绝不按进程名。
9. **验证看退出码**：`npm test; echo $?` 或 `set -e`；`tail`/grep 会掩盖失败。
10. **禁止在 bash 命令里用反引号**（含内联 `node -e`）：反引号先被 shell 展开，会静默吞掉 Markdown/代码片段。写文件用编辑工具；必须内联时用 heredoc + 引号且内容不放反引号。

## 6. 部署现实

- **web profile 是拷贝，不是链接**：发布 tag 不会自动进入用户 harness；必须重新安装/链接并重启。
- 当前（2026-11-10）：
  - `~/.dsh/profiles/web/node_modules/dsh-computer-use` = **v0.5.3**（旧名，用户拍板保留）；
  - `dsh-computer-use.0.5.5-kept` = 0.5.5 副本；
  - 新包名/安装名 = `dsh-win-computer-use`。
- 切换版本：用新名重装/改目录名 → `restart-dsh-capture.ps1` → 会话内 `computer_do(status)` 冒烟。
- **headless 探针通道**（不影响 web 客户端）：
  - `~/.dsh/profiles/headless/node_modules/dsh-win-computer-use` 已建 junction → 本仓库（2026-11-12；旧名 junction 保留）。
  - 叠加层：仓库内 `evals/headless-patch.yml`（推荐；启用 `credentials` + insert 本插件）或工作区 `_probe-win-cu-deepseek.yml`；模型走 dsh 默认 `deepseek-official/deepseek-flash`。
  - **headless 默认禁用 `credentials`**（`id: credentials disabled: true`）；不启用会报 `MISSING_CREDENTIAL`，这不是插件加载错误。
  - 用法：`dsh --profile headless --patch "<...>/_probe-win-cu-deepseek.yml" --permission-mode read-only --approval-policy never "<任务>"`；headless 是“答一个任务即退出”的 profile。
  - 2026-11-12 实测：1 轮 5 步完成 `status` / `screen_observe` / `catalog` / 隐藏 `computer_wait`；2 可见/20 隐藏；cacheRead 6528→7296。
  - S4 headless 直跑：`node evals/headless-run.mjs --tier smoke --timeout-min 10`（复用 setup/oracle/cleanup，日志在 `evals/headless-runs/`）。
  - 本机 `OPENCODE_GO_API_KEY` 已过期（401），opencode-go 通道暂不可用；默认 DeepSeek 通道正常。
- npm 未发布；dsh-market 安装途径暂不可用。
- 详细步骤见 [PUBLISH](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) §6。

## 7. 已知缺口 / 文档-实现不一致

> 这些是当前真实状态。要么修代码，要么在文档中保留限制；不要写成“已支持”。

| # | 位置 | 现象 | 影响 | 建议 |
|---|---|---|---|---|
| G1 | `lib/actions.js` `scroll`/`drag` | schema 接受 `snapshot_id`，实现未 `validateSnapshotId` | 显式证据基线对这两个动作不生效 | 补校验 + 测试 |
| G5 | `lib/observe.js` `screenZoom` | `coordinateSpace: 'screen-physical-px'`，但点击输入是 window-screenshot-px | 换算终点易误读 | 统一字段或改名 |
| G6 | 平台 | macOS 近期未回归；Linux 未验证 | 不要把“能加载”当“已验收” | 有环境时补矩阵 |
| G7 | 部署/npm | web profile 仍旧版；npm 未发布 | 用户看到的可能不是 main | 按 PUBLISH 执行 |
| G8 | `evals/run.mjs` Web runner | dsh 0.2.2 下创建空会话、`steps` 误读；Web `0/4` 无效 | 任务级错误率不可用 Web runner 统计 | 更新 UI 选择器/发送路径（ROADMAP C9） |
| G9 | S4 `wa2` | 8min fail / 10min pass（72 次工具调用）；Round 2 的 12 次错误含 snapshot_mismatch、Explorer 前台确认失败、menu path 非 JSON | 时间预算/步速敏感，另有提示层/焦点问题 | 轨迹分析，降低步速（C10） |
| A7 | 像素点击 | 驱动 0.23.2 混合 DPI 落点缺陷 | 像素路径 best-effort | 等上游；element 优先 |

**当前文档的处理**：G1/G5 已在 [ARCHITECTURE](docs/ARCHITECTURE.md) §13 与 [ROADMAP](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/ROADMAP.md) 中如实标注；README 不把它们写成已支持能力。原先的 install.sh 默认值、`computer_task` 描述默认值、委派白名单漏 `set_value` 三项已在 2026-11-10 文档重写批一并修正。

## 8. 待办

| 优先级 | 事项 |
|---|---|
| P1 | 修 G1/G5（都是小改动，补测试后合入） |
| P1 | 修 `evals/run.mjs` 的 dsh 0.2.2 Web UI 兼容（G8）；当前 Web 冒烟结果无效 |
| P1 | npm 发布 + web profile 切新版（需用户“发布”授权） |
| P2 | S4 任务级复跑 + AC6（降噪/预算的 per-task token/步数） |
| P2 | daemon 提权/清理问题（#3607）；先试非提权重启 daemon |
| P2 | #3908 实战影响面；把“路径受阻→改点控件”写进提示层 |
| P3 | macOS 回归；Linux 不在承诺范围 |
| P3 | 驱动库存候补（browser_*、set_window_frame、trajectory…） |
| P3 | S3b 独立观察者裁决（需 ZHIPU key 或 dsv4fv 文本修复） |

## 9. 历史（已并入本文档）

- 2026-08-15：macOS 初始验证（cua-driver/MCP/11 工具/备忘录闭环/TTL/白名单/危险词审批）。
- 2026-08-25：原生视觉接入（`screen_zoom`、native 图片块、12/12）。
- 2026-09-06/07：A6 密码结构位、A7 坐标标定、快照新鲜度、S3a、上游 #3576/#3586/#3587。
- 2026-09-08~16：S4 评测系统；坐标契约根治；dsh 0.1.5 适配；上下文预算 A–F；`computer_task`。
- 2026-09-17：结构治理（测试脚手架、schema 20/20、config plumbing、回执统一、注册数据化）；v0.5.4/0.5.5/0.5.6。
- 2026-11-09/10：P0/P1 边界、`dispatcher` 默认、`dynamic` 删除、更名、文档体系重写。
- 2026-11-12：dsh 0.2.2-rc.1 headless 真机加载（默认 DeepSeek 通道，5 步只读，2 可见/20 隐藏）；S4 oracle 10/10；headless smoke 3/4（`wa2` fail）；Web runner 的 0/4 判为 dsh 0.2.2 UI 兼容问题。

> 更早的逐日交接（2026-09-16 `HANDOFF`）已不在工作树；需要时从 git 历史取回。

## 10. 改代码前的检查清单

- [ ] 是否先写了 spec/AC？分歧是否问过用户？
- [ ] 是否改变了工具面（描述/参数/输出 schema/可见性）？更新了 README/ARCHITECTURE/CHANGELOG 与工具面 diff？
- [ ] 是否新增了配置键？`config.plumbing` 是否覆盖 schema↔cfg↔读取点？
- [ ] 是否新增了操作类工具？`OPERATION_TOOLS` / `settleAction` / 快照绑定是否覆盖？
- [ ] 是否新增了返回字段/降级形态？`schema.conformance` 是否覆盖？
- [ ] 是否改了权限面（spawn/网络/env/文件）？`PERMISSIONS.md` + `package.json dsh.permissions` 是否同步？
- [ ] `npm test; echo $?`、`npm run check`、`verify-runtime` 是否全绿？
- [ ] 测试窗口是否按标题清理、没有按进程名杀？
- [ ] 真值/实验产物是否仍在工作区，没有进仓库？
