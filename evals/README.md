# S4 评测回归（evals/）

插件级回归评测：确定性 setup/oracle 的桌面任务，经 harness 真实会话执行，PowerShell oracle 记分。
spec 见工作区 `PLAN-s4-eval-regression.md`（§3 两组结构、§6 AC、§8 拍板、§10 基线与分析）。

> 前置：runner 从 `~/.dsh/profiles/web/node_modules/dsh-win-computer-use/package.json` 读取插件版本。当前 web profile 若仍是旧名 `dsh-computer-use` v0.5.3，报告里的 `pluginVersion` 会缺失/过期；先按 [PUBLISH.md](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) §6 部署新版再跑评测。
>
> **2026-11-14 状态**：`run.mjs` 是 dsh 0.1.5 时代的 Web UI runner，已**退役**；在 0.2.2 下它会创建空会话并误读步数，默认直接拒绝运行（`--allow-legacy-web` 仅供旧 UI 调试，`--dry-setup` 不受影响）。当前 S4 用 `headless-run.mjs`（dsh 0.2.2 已验证）。
>
> **轨迹复盘**：t11/t12/t14/t15/t17 的逐轮时间线、工具计数、失败模式与 ZCode CU 探针见 [TRAJECTORY-ANALYSIS](../docs/TRAJECTORY-ANALYSIS.md)；社区 CU 处理模型见 [CU-RESEARCH](../docs/CU-RESEARCH.md)。原始 report/trajectory 在 `evals/headless-runs/`（gitignored），不提交测量产物。

## 任务集（2026-09-09 基线后重排：只留重要×快；重要但慢的做优化）

> 共 **17 条**：冒烟 4 + 核心 6（含 `x1` 委派通道集成）+ dirty 脏桌面 7（t11-t17）。旧的 10 条基线对应 t01-t10/wa2/x1；dirty 组单独统计。

**优化原则**：oracle 一律不改（判据不变才可跨版本比较），只把 setup **预置到决策点**——
应用已开、目录已停、内容已载。被测能力保留，启动/导航/发现的探索成本砍掉。
另加两层运行期加速：`--max-steps` 步数预算（快速失败）、推理档位对照（跑 Medium 档）。

### 冒烟组 smoke（日常回归必跑，目标单条 ≤5min）

| id | 任务 | 被测能力 | 预置 | 基线步数 |
|---|---|---|---|---|
| t01 | 记事本输入两行并保存 | type/key/save 闭环 | 空白记事本已开 | 25（试跑 pass） |
| t04 | 计算器 1234×5678 | 多步操作 + UIA 数值断言 | 计算器已开 | 73（pass） |
| t07 | 窗口最大化并保持 | 窗口控制 / perform_action | workfile 已开 | 14-18 |
| wa2 | 设文件为隐藏（WAA 0c9d… 本地化） | 资源管理器属性操作 | 资源管理器已停在目标并选中文件 | 73（timeout，导航导致） |

### 核心组 core（低频跑，重要但慢 → 已优化）

| id | 任务 | 被测能力 | 预置 | 基线步数 |
|---|---|---|---|---|
| t03 | 资源管理器重命名文件 | 就地文件操作 | 资源管理器已停在目标目录 | 59（timeout） |
| t05 | 另存为 + ANSI 编码 | 另存为对话框/编码下拉（长尾能力缺口） | 源文件已用记事本打开 | 50（旧失败样本）；最新 3/3 pass（26/28/19 步） |
| t06 | 剪贴板粘贴保存 | 剪贴板链路 | 剪贴板已置 + 空白记事本已开 | 57（timeout） |
| t09 | 画图填充纯红并保存 | 图形表面 + 像素级 oracle | 画图已开 | 57（timeout） |
| t10 | 两文档内容互换 | **多文档/多窗口状态管理（最大缺口）** | 两文件已载入记事本 | 48（timeout） |
| x1 | 委派记事本保存 | **`computer_task` 子 agent 委派通道** | 沙箱目标目录已建 | 17（timeout，0.5.3 / dsh 0.1.5 报告） |

### Dirty 脏桌面组（2026-11-16，真实用户会话；不要求先关用户应用）

| id | 任务 | 依赖 | oracle / 备注 |
|---|---|---|---|
| t11 | Paint 鼠绘复刻 | Paint + 浏览器参考窗 | PNG 800x600 + 三色 ROI mask/bbox/coverage 容差；setup 用 AX `大小` 固定 8px，题面给精确画布原点并先 activate/焦点 click；2026-11-17 **3/3 pass，70/88/48 步** |
| t12 | PPT 布局复刻 | PowerPoint + 浏览器参考窗 | 白底单页 16:9 seed + 预填 title/subtitle + 3 个灰色占位柱 + `seedHash`；题面按形状名选择/标准色/直接输入标签；40 分钟预算；2026-11-17 **2/2 pass，140/169 步**；第七轮 forced pointer 后 **1/1 pass，152 步**；AC2 SKIP |
| t13 | 论文下载 | 用户浏览器 + 网络 | 用户 Downloads 新增 PDF 的 SHA-256；只删匹配新文件 |
| t14 | Excel 数据+柱状图 | Excel | XLSX XML 单元格 + 原生 barChart；先 activate/wait，表格用剪贴板 TSV + 功能区 Paste（禁止逐格 type），A1 用 zoom/from_zoom，F12 失败走 File > Save As > Browse；setup/oracle 校验 seedHash 未变；2026-11-17 新题面 **3/3 pass，59/41/57 步**；forced pointer 前置单次后 **42 步 pass**（旧题面 141/71）；AC2 SKIP |
| t15 | Explorer 多文件整理 | Explorer | 精确文件系统终态（8 文件；先重命名再移动；Ctrl+click 用 `computer_click(..., modifier:["ctrl"])`；文件单选用 `foreground=true`；2026-11-17 **3/3 pass，77/72/59 步**） |
| t16 | 本地浏览器表单 | 用户浏览器 + 本地 server | result.json 精确字段 |
| t17 | PDF 定位+摘录 | 浏览器 PDF + Excel | XLSX A1 精确文本（不 Trim）；只允许 setup 浏览器窗口，禁止在 Firefox/其它浏览器打开 PDF；activate + wait/reload，三击句子 + Ctrl+C；Excel 先 Save As，文件名 set_value；setup 用 UIA 轮询 `S4-T17:` 做 page-3 readiness，并记录 seedHash；2026-11-17 新题面 **3/3 pass，37/53/48 步**；forced pointer 后 **42 步 pass**（旧题面 89/63）；用户 Firefox 无测试标签；高风险，已满足 3/3；AC2 SKIP |

- 这些 md 标记 `- **isolation: dirty**`；`headless-run.mjs` 只在选中任务含 Notepad 任务时做 TabState backup/restore，dirty 组不碰用户 Notepad。
- setup ENV（应用缺失/网络不可达/浏览器不能新开窗口）记 `verdict=env`；`verify-oracles` 对 `ac2: none` 任务显示 SKIP，不伪造 PASS。
- 用户已有 Paint/PowerPoint/Excel/浏览器/Notepad 窗口一律不关；cleanup 只关 setup 记录的测试 HWND/文档，证明不了就 leftover+dirty。
- t11 setup 若已有 `mspaint` 进程会 fail-closed 为 ENV（Paint 11 单进程多标签，无法证明 seed 没合进用户窗口）；t12 从 `WidescreenPresentation.potx` 裁剪出白底单页 16:9 seed 并直接打开最终输出文件；t15 题面把重命名放在移动之前，并提供命令栏“重命名”回退。
- 手势边界：click/double/right 的 `modifier` 已真机验证（Ctrl+click 可用）；drag 的 `modifier` 在 driver 0.23.2 上目标端收不到，题面与插件都不使用；drag 的 `from_zoom`/`steps` 已接线。组合键（Ctrl+C/V/S 等）由插件自动前台；普通按键仍可后台。
- 输入真实性：`background_delivery_failed` 是驱动的升级建议，不是硬失败；Excel 网格等无 Document 的聚焦输入在未验证时保留快照，避免每格 observe。t14/t17 题面已按此改写。

### 退役（2026-09-09，git 历史可恢复）

| id | 退役理由 |
|---|---|
| t02 find-replace | 与 t01 同表面（记事本+保存），查找替换价值中低 |
| t08 run-dialog | 启动通道 oracle 不可判定，且与 t01 重复 |
| wa1 archive-docx | 与 t03 同表面（资源管理器文件操作），多文件操作非独立能力 |
| wa3 canvas-resize | 与 t09 重复（画布尺寸并入 t09） |
| wa4 paint-save | 与 t09 重复（仅存在性判定，信息量最低） |
| wa5 png-list | 与 t03/wa2 同表面（explorer 列举 + 写文件） |
| wa6 calc-days | 与 t04 同表面（计算器），日期模式导航属噪声 |

WAA 组由 6 条缩至 1 条（wa2）：基线显示两组同构失败（瓶颈在执行面而非任务措辞），
保留 wa2 作 WAA 溯源代表并转入冒烟组。原 6 条的共同问题是“表面与自编组重复 + 需深层路径导航”。

## 目录约定

```
evals/
  README.md            本文件（约定 + 溯源总表 + 弃选留档）
  run.mjs              legacy Web UI runner（默认拒绝；dsh 0.1.5 时代）
  headless-run.mjs     headless 直跑器（dsh 0.2.2 当前基线；复用 setup/oracle/cleanup）
  headless-patch.yml   headless 探针叠加层（启用 credentials + 插入本插件）
  verify-oracles.mjs   oracle 独立验证（AC2）：setup→oracle 必须 fail；simulate→oracle 必须 pass
  lib/
    common.ps1         PS 共享前置：沙箱根、JSON 输出、路径约定（所有 PS1 dot-source）；含 Wait-TestPdfPageReady、Get-S4Sha256Shared
    tabstate.ps1       Notepad TabState backup/restore（隔离用户会话，防任务间标签串味）
    cdp.mjs            零依赖 CDP 客户端（Node 22 原生 WebSocket，驱动 headless Chrome）
  tasks/<id>.md        任务定义：prompt 原文 + 元数据（WAA 组含溯源头）
  setup/<id>.ps1       预置状态（幂等，先自清理）
  oracle/<id>.ps1      判定：exit 0=pass / 1=fail / 2=环境错误；stdout 一行 JSON
  cleanup/<id>.ps1     清理沙箱
  simulate/<id>.ps1    AC2 专用：不经 GUI 直造"任务成功态"，验证 oracle 会 pass
```

- `<id>`：自编组 `t01`…`t10`，WAA 本地化组 `wa1`…`wa6`（文件名主干即 id）。
- **运行前置**：Notepad 任务（t01/t05/t06/t07/t10/x1）要求所有 Notepad 窗口（含无窗口进程）关闭；dirty 组（t11-t17）不要求，且跳过 TabState。Notepad 任务会先调用 `lib/tabstate.ps1 backup` 把用户 TabState 移到 `~/.dsh/s4-evals/_tabstate-backup/`，每个 setup 前清掉上一个任务的 eval bin，跑完 restore。手动跑 setup 时可用 `powershell -File evals/lib/tabstate.ps1 backup|restore|status`。若进程被杀导致未 restore，先关测试窗口再执行 restore。
- **PS1 一律 ASCII-only**（PowerShell 5.1 把无 BOM 脚本按 ANSI 解析，中文注释会炸解析器）——中文只进 .md。
- 沙箱根：`%USERPROFILE%\.dsh\s4-evals\<id>\`。任务涉及"Documents/Desktop/Pictures"的一律本地化为沙箱内对应子目录（防动用户真实文件），改动点记入任务 md 溯源说明。
- 判定原则（不可妥协）：oracle 绝不用模型自评，全部 PS/Win32 确定性读；setup/oracle 与被测动作解耦（runner 直调）。

## 环境知识（2026-09-08/09 实测，写脚本前先读）

- **PowerShell `Add-Type` 临时文件坑（2026-11-12 实测）**：本机 `TEMP` 指向 `C:\Windows\TEMP` 时，`Add-Type -TypeDefinition` 编译会报“未能找到源文件 C:\Windows\TEMP\*.cs”，导致所有 setup/oracle 失败（不是任务逻辑）。把 `TEMP`/`TMP` 设为 `%LOCALAPPDATA%\Temp` 后 `verify-oracles` **10/10**。
- **Win11 记事本会恢复上一会话**：`%LOCALAPPDATA%\Packages\Microsoft.WindowsNotepad_*\LocalState\TabState\*.bin` 让未保存标签在下次启动时复活——基线里“幽灵 notepad 窗口”与 t07 级联失败的真机制。`hygiene.ps1 -ClearNotepadTabState` 可清（**会丢未保存文档，含用户自己的，故须显式开启**）；默认只报告窗口，不关闭。
- **WinUI3 应用 `MainWindowHandle` 恒为 0**（计算器实证）：就绪判定用 UIA（`Test-CalculatorVisible`/`Start-Calculator`），别用 MainWindowHandle。
- **剪贴板可能被占用**：set 后立即 get 可能为空 → set+verify 重试（t06 setup 已实现）。
- **打包应用重启竞态**：杀进程后要等它真正消失再启动，并带重试（`Start-Calculator`）。
- **驱动提权窗口清理不掉**：cua-driver（疑似提权）spawn 的窗口，非提权侧 taskkill/Stop-Process/PostMessage 全失效（UIPI）；`Close-TaskWindows` 只能处理脚本自己启的窗口。这是当前最大的环境噪声源，修复项见 PLAN §10.5。
- notepad 标签页控件类型是 **TabItem**（不是 ListItem）；窗口标题只显示活动标签。
- **Win11 记事本上驱动的三条输入通道都可能不可达**（2026-09-16 受控窗口实测 + 2026-11-14 t01）：`hotkey` 走 UIA 加速器扫描 → 4s 超时，或 `could not find a UIA AcceleratorKey`（保存/全选等命令在关闭菜单里）；`press_key`（PostMessage）不报错但 `effect:unverifiable`、目标无反应；`invoke_menu` 返回 `menu_path_unavailable`（XAML 菜单驱动走不到），且 `["文件"]` 可能只回 `unverifiable` 而菜单没开。→ 依赖 Ctrl+S 保存的任务（t01/t05/t06/t10）在该目标上要走“点菜单栏项 → 观察弹出菜单 → 点菜单项”。插件已把两类 hotkey 失败翻译成可执行指引；`xamlKeyFallback: auto`（默认 off）可实验性自动完成“开菜单→点项”，歧义/缺失即停；`computer_menu` 的 `unverifiable` 不再报成功。
- **记事本进程会被复用**：`notepad.exe` 单进程多标签，自己起的实例可能被用户后续打开的文件占用 → 清理测试窗口要按**标题**匹配，不要按进程名杀（2026-09-16 实测：我的测试进程被用户文档复用）。
- **2026-11-15 Notepad 标签级安全化**：`Open-TestNotepad`/`Close-TestNotepad` 不再只看“新 HWND”或活动标题 `*`。Win11 会把 `TabState/*.bin` 恢复进新窗口——2026-11-14 的 t01 窗口实际有 8 个标签（2 个用户已修改文档 + 6 个测试文件）。现在必须用 UIA `TabItem` 校验精确 ExpectedTabs、无额外/已修改/未知后缀；任何不符 setup fail closed，cleanup 留窗并写 `~/.dsh/s4-evals/_leftovers/`。`Close-TaskWindows` 删除默认 Notepad/无标题/记事本 needles，调用必须带显式模式；`tests/eval-safety.mjs` + `tests/notepad-tabs.test.mjs` 守门。
- **2026-11-15 轨迹驱动第二轮（模态对话框 + dirty）**：`Close-TestNotepad` 在标签校验通过后，用 `Get-ModalTestWindows` 关闭已证明归属的测试模态窗（直接 owner、owner 链、或主窗 disabled + `GetLastActivePopup`），再对主窗 `WM_CLOSE`；同 pid 但未证明归属的窗口一律留窗。`headless-run.mjs` 消费 cleanup JSON 的 `dirty`：`rec.dirty=true`，pass 改记 `dirty`，汇总打印 `dirty=N`，退出码非 0——环境不干净不再算干净通过。
- **t01 预置（2026-11-15 起）**：setup 直接预开空 `target\note.txt`（task-owned 新窗口），prompt 改为输入后“文件→保存”原地保存；不再走 Save As（Win11 文件名框/覆盖确认在驱动 UIA 路径下不可靠）。Save As 覆盖保留在 t05；t05 于 2026-11-15/16 连续 **3/3 pass**（26/28/19 步，cleanup clean，TabState restored）。
- **驱动提权链（2026-09-16 实测，上游 #3607 已附证据）**：`cua-driver.exe` 的二进制清单是 `requireAdministrator` → daemon 恒为 High IL → **`app_launch` 启动的应用继承 High IL**（对照：同一 shell 直接 `Start-Process notepad` 为 Medium IL）→ 非提权客户端 `taskkill`/`Stop-Process`/`WM_CLOSE` 全被拒（UIPI），残骸窗口累积并干扰后续任务观察（基线 t07 级联失败的元凶之一）。驱动**确实能**操作自己启动的 High IL 窗口（提权记事本上 `computer_type` 成功且 `effect:confirmed`），所以"管理员窗口不可操作"的旧说法不成立——真实边界是"客户端清不掉"。且 WinUI 目标上连驱动侧关闭通道也断（`alt+f4` 撞 #3908 的 UIA 超时、`invoke_menu` 报 menu_path_unavailable）→ 只能人工收尾。**评测实践：优先操作已在运行的普通应用；用 `app_launch` 的任务要接受人工收尾成本。**
- **dsh 0.1.5 UI 变化（2026-09-16 实证）**：`document.execCommand('insertText')` 在 composer 上失效（长度恒 0，会发出空消息）→ 必须走 CDP `Input.insertText`；轮次页脚由 `N 轮 · M 步` 变为 `N 轮 M 步`（无分隔点）；新建会话后页面可能被其他会话视图覆盖 → 发送前必须**二次校验当前会话仍是 0 轮**，回合结束再校验 prompt 标记在活动会话文本里。
- **「新建会话」点击可能不生效**（视图被钉在历史会话上；2026-09-16 实测：无弹层、无导航、harness 日志无报错，普通点击与 trusted CDP 点击都一样，而同一页面其它按钮点击正常）。**可靠恢复 = 重载客户端**——新加载会直接给出空会话（这也解释了为什么"重启/新开客户端"总能正常跑）。runner 已内置：点击无效 → 重载客户端 → 重试，最多 3 轮，并在日志打印 `session view pinned → reloading client`。

## 模型通道配置（opencode go 6649，2026-09-16）

ZCode 侧的廉价同源通道（同一 deepseek-v4.1-flash，走 opencode zen/go 代理）搬进 dsh 的三处改动，全部在 `~/.dsh/settings.yaml`（备份 `settings.yaml.bak-pre-opencode-go-*`）：

1. `agent-default-model` 改指 `opencode-go / deepseek-v4.1-flash / high`（新会话默认用它；旧值 deepseek-official/deepseek-flash）。
2. 补全 `llm-pi-ai.providers.opencode-go`（原本只有 apiKeyEnv 的半成品）：`api: openai-completions`、`baseURL: https://opencode.ai/zen/go/v1`、模型规格（1M 上下文 / 128K 输出 / 文+图）。
3. **必需请求头** `x-opencode-session: <uuid>`——该路由按会话做路由亲和，缺头会被 400 `MissingSessionID` 拒掉（"Request is missing x-opencode-session"）。dsh 的 provider 配置支持 `headers:` 字段（`dsh-llm-pi-ai` 会把 `profile.headers` 并入请求）。密钥无需搬运：`.credentials.yaml` 里已有 `OPENCODE_GO_API_KEY`。

诊断顺序（复现用）：探针号 `probe-model`（读选择器标签）→ `probe-menu2`（列出模型/推理档条目）→ `probe-compat`（最小回合：0 轮新会话 → 输入 → 发送 → 轮询回合是否出内容）。
runner 侧用 `--pin-model "DeepSeek V4.1 Flash (OpenCode)" --pin-effort High` 钉定，避免依赖会话记忆。

### 首次运行结果（2026-09-16，冒烟组，8 分钟 / 40 步上限）

| 任务 | 结果 | 步数/时长 |
|---|---|---|
| t07 窗口最大化 | **pass** | 7 步 / 104s（旧配置 18 步 / 301s） |
| t01 记事本输入保存 | timeout | 36 步 / 494s |
| t04 计算器 | timeout（撞步数上限） | 40 步 / 439s |
| wa2 设隐藏 | timeout | 32 步 / 494s |

步速约 11-15 秒/步；能收敛的任务很快（t07 一条动作 104 秒收工），不收敛的仍在多窗口/对话框上耗满预算——与旧配置同构，说明瓶颈在任务执行面而非模型档位。

> `x1` 最后一次报告（2026-09-16，plugin 0.5.3 / dsh 0.1.5）：17 步 / 951s，timeout。该报告只覆盖 x1，且是旧插件/旧宿主，不能代表当前 `0.5.7-dev`。

### 2026-11-12 headless 直跑（当前插件）

| 轮次 | 上限 | 结果 | 备注 |
|---|---:|---|---|
| Round 1（一次性 runner） | 8min | **3/4** | `t01/t04/t07` pass；`wa2` fail |
| Round 2（`headless-run.mjs`） | 10min | **4/4** | `wa2` 到点但 oracle pass |

两轮合计 **7/8（87.5%）**；`wa2` 对时间预算敏感（8min fail → 10min pass，72 次工具调用）。

> 2026-11-15：t01 真机复跑暴露了“新窗口恢复用户标签”的安全漏洞；标签白名单/污染 fail-closed/leftover 已修复。随后执行 `--tasks t01 --repeats 3`，三次全部在 setup 阶段 error（steps=0）：seed 都落进仍含 2 个用户已修改标签的现有窗口，`owned=False`，fail-closed 正确阻止了 dsh。**GUI 复跑仍需先保存/关闭用户标签并清掉测试标签**。
>
> 2026-11-15 后续：`tabstate.ps1` 备份/恢复 + `Close-OrphanTestNotepads` + UIA 关闭完成后，t01 改为**原地保存**（预开空 `target\note.txt`，输入后“文件→保存”）。`--tasks t01 --repeats 3` **3/3 pass**：37/18/19 步，273.4/121.7/104.2s，每次 1 次 `move_cursor`，无 timeout/dirty，tabstate restored。旧 Save As 语义仍受 Win11 文件名框（`type`/`set_value` 返回 confirmed/unverifiable 但值不变）与对话框叠层影响，Save As 覆盖保留在 t05。
>
> 2026-11-15 P2 轮：t10 的确定性 orphan 误关（`evalOwned` 绕过 seed）用 `-ProtectHwnd` + 唯一 seed 要求 + 失败前写 state/首窗消失重绑修复；t04 Calculator 改为扫描所有 UIA 顶层窗口的 `CalculatorResults`，t06 clipboard 改为 8 次 round-trip 并在失败时返回 ENV；t03/wa2/t09 改为状态化 `Open/Close-TestExplorer|Paint`，不再宽 `Close-TaskWindows` 或按 `mspaint` 进程名杀。`verify-oracles` 2026-11-15 18:40 复跑 **10/10 PASS**（tabstate restored，无 dirty）；此前 14-39 run 曾因 t03 Explorer 慢关闭 9/10，已加 Close-TestExplorer 重试。
>
> 2026-11-15/16 观察真值轮：t01 ×3 修复前 **2/3**（r2 11 fail，`computer_type` 无 element + delivery_failed 后模型按 33 字符保存），加入输入回读/保存门禁后 **3/3 pass**（99/9/10 步）；t05 **3/3 pass**（26/28/19 步，dirty=false、tabstate restored）。三次 t01 均无 overlay 被 observe、无 screen_zoom missing pid、无 snapshot_missing；r1 实际使用 1 次 `from_zoom`。
>
> 2026-11-16 WinUI 键鼠成测试：`node evals/probe-winui-keys.mjs`（Ctrl+A/Alt+F/Alt+Tab × hotkey/press_key/菜单回退）。结果见 `docs/WINDOWS.md §4.1`：Ctrl+A 可靠回退是“编辑→全选”或 press_key foreground；Alt+F 仅 press_key foreground；Alt+Tab 仅 press_key foreground（会真实切前台）。`press_key` + 修饰键 background 会插入裸键，不能用于组合键。
>
> 同一轮加入了 CU 轨迹监控：`headless-run.mjs` 自动写 `<task>-r<n>.trajectory.jsonl`。首个干净 t01 样本 443 events / 589.5s，34 observe / 39 action，53 次 `move_cursor` / 7257px，自动标出 3 次重复 click、连续 observe、另存为窗口 native+ax 重复观察。第二轮修正了 `computer_do` 外壳重复计数，并增加 `unverified`、`observeStubs`、`toolAvgMs`、`deliveryModes`、`movesPerClick`；分析命令：`node evals/analyze-trajectory.mjs <file>`。
> 2026-11-16：分析器增加 `typeCalls/retypeSame/retypeDiff/native/force/query/zoom/clipboard/drag/menu/snapshotMismatch/repeatSuppressed/strategy`，用于解释同任务步数方差；`evals/ab-summary.mjs` 汇总 report+trajectory 的 median/p90/IQR、strategy 分布与 paired delta。测量产物仍只写 `evals/headless-runs/`（gitignored）。
> 2026-11-16 t01 新题面（星号证据修正 + 单次输入约束）×5：**5/5 pass**，steps 17/32/8/19/11（median 17）；中间题面版本 4/5（r5 打开编辑菜单后点“全选”结束、未保存）。两版都未再出现 52/66 步的强制置脏循环，但 32 步 exploratory 仍在，说明策略方差需要统计分布而非单轮步数。

## 运行期语义（试跑定案 2026-09-07）

- **prompt 统一前置约束**：仅图形界面完成 + 不向用户提问（runner 单点注入）。首次实跑发现：agent 会走文件写入工具直写沙箱（workspace-write 拒绝后**请求 danger-full-access 提权**，卡审批 15 分钟）——沙箱目录故意放在会话 workspace 之外，配合 runner 审批**自动拒绝**（>4 次拒绝记 error）把 agent 推回 GUI。
- **回合结束判定**：页脚"N 轮 · M 步"计数 + 消息流静默 12s + 无停止按钮。发送按钮 disabled≠回合信号（它只是"输入框为空"）。
- **超时**：默认 15 分钟/任务；打满预算判 timeout 且跳过 oracle（不进通过率分母）。
- **发前安全闸**：新会话必须 0 轮，否则拒绝注入（HARDOFF §4-7）。
- **回合在服务端继续**：runner 放弃后 agent 仍在跑——`maintain.mjs` 负责停"进行中"回合/拒绝审批；残留窗口由各 cleanup 的 `Close-TaskWindows` 收拾。
- **计时**：轮次=页脚"N 轮"（1 轮会话也显示；"跳转到第 N 轮"按钮只在多轮会话出现，取 max）；步数="M 步"=工具调用数。

## 运行

```
node evals/run.mjs --allow-legacy-web --tasks t01      # legacy Web UI 调试（dsh 0.2.2 结果无效）
node evals/run.mjs --dry-setup --tasks t01            # 只跑 setup/oracle 链（不需要 UI）
node evals/headless-run.mjs --tier smoke              # headless 直跑（0.2.2 基线）
node evals/headless-run.mjs --tasks t01,t04 --repeats 3 --timeout-min 12
node evals/headless-run.mjs --tasks t15 --repeats 5 --timeout-min 20   # Ctrl+click 批量测量
node evals/headless-run.mjs --tasks t11 --repeats 3 --timeout-min 20   # activate/焦点纪律
node evals/headless-run.mjs --tasks t12 --repeats 2 --timeout-min 40   # Office 单独宽预算
node evals/verify-oracles.mjs                         # AC2：全部 oracle 双向独立验证
node evals/probe-modifier.mjs                         # click modifier 真机门禁 + drag modifier 缺口
node evals/probe-combo-foreground.mjs                 # 组合键自动前台（Ctrl+V 到 WinForms TextBox）
node evals/probe-private-drag.mjs                     # 私有 SendInput 拖拽：Ctrl+Shift 到 down/move/up，drop 后无卡键
node evals/probe-native-freshness.mjs                 # driver/plugin native 截图 freshness
node evals/stop-stale.mjs "<url>" 18                  # 止损：停 >18min 的残留进行中回合
node evals/maintain.mjs "<url>"                       # 停残留 + 拒绝待审批
```

- `headless-run.mjs`：不依赖浏览器；复用 setup/oracle/cleanup，逐条保存 `evals/headless-runs/<stamp>/<task>-r<n>.jsonl`，统计任务级 pass/fail、工具错误、未验证、超时。前置：headless profile 可解析 `dsh-win-computer-use`；`DSH_BIN` 可覆盖 dsh 的 `lib/bin.js`；`TEMP/TMP` 自动指到用户临时目录。
- `--dsh-url` 缺省调 `~/.dsh/restart-dsh-capture.ps1`（token 每次重启轮换，stdout 捕获至 `~/.dsh/web-latest.log`）。
- 浏览器：本机 Chrome headless（`--remote-debugging-port`，零 npm 依赖）。
- 报告：headless runner 写 `evals/report-last-headless.json`（已 gitignore；真值产物不入库，AC5）；`run.mjs` 的 `report-last.json` 仅 legacy 调试使用。仓库只进 runner/任务/oracle。
- **运行建议**：dsh 0.2.2 基线统一用 `node evals/headless-run.mjs --tier smoke --timeout-min 10`；`run.mjs` 仅旧 UI 调试。

## 报告 schema

```json
{ "date", "model", "dshVersion", "pluginVersion",
  "tasks": [{ "id", "group": "authored|waa", "tier": "smoke|core", "waaId?", "sessionId",
               "verdict": "pass|fail|timeout|error", "steps", "wallMs", "oracleDetail" }],
  "passRate": { "authored", "waa", "all" } }
```

## WAA 本地化组溯源（source: microsoft/WindowsAgentArena, MIT）

选集原则：本机已有内置应用、判定可 PS 确定性化、无网络依赖、不改动用户真实系统配置。
判定只取原任务**意图**，实现一律重写为本仓库 PS oracle（原评测栈为 Python/pyautogui + 云端金标文件）。
2026-09-09 起本组仅保留 wa2（见上方退役表）。

| id | waaId | 原域 | 原 instruction 摘录 | 本地化改动 | 判定 |
|---|---|---|---|---|---|
| wa2 | e27984c7-968c-48d7-b2c3-6e45cdcc5249-WOS | file_explorer | Set the file "secret.txt" in the Documents folder as hidden. | Documents→沙箱目录；文件由 setup 本地生成；资源管理器预置停在目标并选中文件 | is_file_hidden 同义 PS 重写 |

（其余 5 条 2026-09-09 退役，原定义见 git 历史；退役理由表在上方“退役”节。）

### 弃选留档（R6）

- **chrome/msedge 全部（30 条）**：网络与登录态依赖，判定不可本地确定性化。
- **clock（4）**：定时器/世界时钟无 PS 可读的持久判定面。
- **settings（5）**：判定可行（注册表）但任务本身**改动用户真实系统配置**（时区/通知/夜间模式/壁纸），违反沙箱原则。
- **vlc（21）/ vs_code（24）/ libreoffice（43）**：本机未装或版本不可控，setup 无法零网络预置。
- **file_explorer 其余**：zip 加密（b0c9dac6 依赖 7-zip）、共享权限（b12921b2 改真实 ACL）、回收站还原（f934d80d 状态不可预置）等，判定或预置不可确定性化。
- **notepad 两条**：366de66e 与自编 t01 语义重合（镜像退化，R6）；a7d4b6c5 依赖下载 largefile.txt，本地化后与 t02 重合。

## 许可

WAA 任务语义（instruction/判定意图）来自 microsoft/WindowsAgentArena（MIT License，见 Public/waa-upstream/LICENSE）；本地化条目按 MIT 附源链接与原 ID 溯源，不复制其代码与资产文件。
