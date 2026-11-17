# VERIFICATION — 验证报告

> 目的：把“声称支持”变成可复现的证据。本文按**当前矩阵 → 历史证据 → 代表性缺陷 → 未验证项 → 复现方式**组织。
> 代码快照：`main` @ 2026-11-17（`0.5.7-dev`）。最近完整运行环境：Windows 11 x64 · DPI 150% · cua-driver 0.23.2 · dsh 0.2.2-rc.1/rc.2。2026-11-12 追加 dsh headless 真机加载证据（§2.1）；2026-11-14 追加 t01 坐标/菜单复盘；2026-11-15 追加 runtime/pipeline、投递语义与 Notepad 标签级安全复盘；2026-11-16 追加 WinUI 键鼠通道、opt-in press 回退与菜单/文档反馈；2026-11-17 追加 click modifier/drag from_zoom+steps 真机探针、t11/t12/t15 脏桌面复跑、t14/t17 输入真实性/前台语义修复与复跑，以及私有 SendInput 拖拽（modifier/button/dwell_ms）3/3 真机探针。
> 测试方法见 [docs/TESTING.md](docs/TESTING.md)；Windows 专项见 [docs/WINDOWS.md](docs/WINDOWS.md)；dsh 0.2.2 契约审计见 [docs/COMPATIBILITY-0.2.2.md](docs/COMPATIBILITY-0.2.2.md)。

## 1. 当前验证矩阵

| 验证面 | 结果 | 平台 | 证据 |
|---|---|---|---|
| 离线测试 | **22 套 / 555 ✅ / 0 ❌** | Windows（跨平台 Node 可跑） | `npm test; echo $?` |
| 语法/安装脚本 | **22/22 JS + 2 个 bash -n** | Windows | `npm run check` |
| 真驱动运行时 | **17/17** | Windows 11 / cua-driver 0.23.2 | `node verify-runtime.mjs` |
| 真桌面动作闭环 | **23/23**（2026-09-17 重设计后） | Windows 11 | `node tests/live-action.e2e.mjs 3` |
| S4 oracle 双向验证 | **2026-11-17：t11/t15 PASS、t12/t14/t17 SKIP**（`ac2:none`，setup/empty-fail/cleanup 通过；t17 setup 现含 PDF page-3 readiness） | Windows 11 | `node evals/verify-oracles.mjs --tasks t11,t12,t15,t14,t17` |
| S4 真机任务 | **t01 新题面 5/5 pass**（17/32/8/19/11 步，median 17；1 次 exploratory 32 步）；**t05 3/3 pass**（26/28/19 步，dirty=false） | Windows 11 / dsh 0.2.2-rc.1 | `evals/headless-run.mjs`；TabState restored |
| query 只读视图 | **✅** query 后 `snapshotId=null`、动作 `[snapshot_missing]`、不污染差分/降噪 | Windows（离线） | `tests/observe.truth` T21-T25 + `schema.conformance` |
| dirty 脏桌面套件 | t15/t16 `verify-oracles` **PASS**（AC2 full）；t12/t13/t14/t17 **SKIP**（setup/oracle-empty/cleanup 通过，无 simulate）；首轮真机 t13 **pass 19 步**（NeurIPS PDF SHA-256，removed=1）、t15 **pass 112 步**、t16 **pass 17 步**、t11 **fail 107 步**、t12 **fail 126 步**（均未保存输出）。2026-11-16 修复轮：t11 显式题面 **84/77 步 pass**；t15 **3/3 pass**（177/146/89 步）；t12 25 min/190 步仅 title/subtitle、红/蓝柱、Q1。2026-11-17 手势轮：t11 **3/3 pass（70/88/48 步）**；t15 **3/3 pass（77/72/59 步，各 5 次 Ctrl+click，无 Notepad/Photos 误开）**；t12 白底 seed + 直接输入 **2/2 pass（140/169 步）**（hash/1 页/16:9/Q1-Q3/三色柱全 true）；t14 旧题面 **2/2 pass（141/71 步）**（24 格/barChart/标题/Sales/Month categories 全 true）；t17 旧题面 **2/2 pass（89/63 步）**（A1 exact；PDF 句子三击复制；测试 Firefox 标签按选中态 Ctrl+W 单独关闭，用户其余标签保留）。2026-11-17 第七轮：t14 新题面 **3/3 pass（59/41/57 步）**，`typeCalls=1/1/2`、`clipboard=1`、seed unchanged、oracle 全 true；t17 新题面 **3/3 pass（37/53/48 步）**，`typeCalls=0`、`clipboard=1`、A1 exact、seed unchanged，用户 Firefox 无测试标签；t11 forced drag 前置单次回归 **58 步 pass**，全部指针前置单次后 **94 步 pass**（两轮三色 ROI/coverage/precision 全绿，无鼠标键/设置离题；方差仍大）；t15 **85/67 步 pass**（8 文件/内容/旧路径全 true；第二轮 5 次 Ctrl+click 批量）；t12 **152 步 pass**（1 页/16:9/Q1-Q3/三色柱全 true）；forced pointer（click/scroll/drag）全部前置单次后复跑 t14 **42 步**、t17 **42 步**，均 pass | Windows 11 / dsh 0.2.2-rc.1 | `evals/verify-oracles.mjs --tasks ...`；`evals/headless-run.mjs` |
| CU 调研/轨迹复盘 | Codex/Claude Code/ZCode/Trae + 社区 CU 的复杂任务模型；t11/t12/t14/t15/t17 逐轮时间线、工具计数、失败模式；ZCode CU 的 Ctrl+click、画布拖拽、PPT 形状元素探针 | Windows 11 / ZCode CU 0.6.5 | [docs/CU-RESEARCH.md](docs/CU-RESEARCH.md)、[docs/TRAJECTORY-ANALYSIS.md](docs/TRAJECTORY-ANALYSIS.md) |
| 手势探针 | click element/坐标的 Ctrl 真机到达；driver drag 的 `modifier` 在 0.23.2 上目标端仍是 `None`（driver 缺口，已由私有 helper 绕过）；drag `from_zoom`/`steps` 已接线 | Windows 11 / cua-driver 0.23.2 | `node evals/probe-modifier.mjs` |
| 组合键前台探针 | blocker 在前台时，真实插件 `key()` 自动前台目标并把 `Ctrl+V` 送进 WinForms TextBox，文本 `S4-COMBO` 完整到达；回执含“组合键需前台注入” | Windows 11 / cua-driver 0.23.2 | `node evals/probe-combo-foreground.mjs` |
| 私有拖拽探针 | **3/3**：真实插件 `computer_drag(modifier=["ctrl","shift"], dwell_ms)` → 持久 helper；WinForms down/move/up 均读到 `Shift, Control`，`sent=30`、`foregroundRestored=true`、无卡键 | Windows 11 / PowerShell 5.1 / cua-driver 0.23.2 | `node evals/probe-private-drag.mjs` |
| native freshness | WinForms 文本变化窗口的 driver 截图 hash 与插件 native 字节数都随文本变化，未复现“AX 已变而 PNG 不变” | Windows 11 / cua-driver 0.23.2 | `node evals/probe-native-freshness.mjs` |
| headless S4 smoke | **7/8（两轮；Round 2 4/4）** | Windows 11 / dsh 0.2.2-rc.1 | 见 §2.1.2 |
| dsh 0.2.2 兼容升级 | **✅ P0/P1/P2**（subagents/vision/native limits/PTC） | Windows 11 / dsh 0.2.2-rc.1 | 见 §2.1.3 |
| 打包面 | **42 文件**（新增 lib/privateDrag.js、tools/private-drag.ps1；含 docs/RUNTIME-PIPELINE.md、lib/keyFallback.js、lib/loopGuard.js、lib/trajectory.js、lib/windowMap.js 等） | — | `npm pack --dry-run` |
| 真机 headless 加载 | **✅ 2026-11-12**（5 步；2 可见/20 隐藏（当时）；真实 `screen_observe`；dispatcher 路由 `computer_wait`） | Windows / dsh 0.2.2-rc.1 | 见 §2.1 |
| npm / 部署 | **未发布 / web profile 仍旧版** | — | 见 [PUBLISH.md](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) |

### 1.1 安全承诺矩阵

| 承诺 | Windows | macOS | Linux | 验证载体 |
|---|---|---|---|---|
| 凭据硬保护（密码框拒自动输入） | ✅ 结构位（UIA sidecar `IsPassword` ∨ `ES_PASSWORD`）+ 启发式降级 | ✅ AX 结构化角色（0.1–0.2 时期） | 未验证 | `posture.smoke` G/H 系列 + A6 探针 |
| 极危注记（不阻断） | ✅ | ✅ | ✅ 离线 | `posture.smoke` |
| `allowedApps` 白名单 | ✅ | ✅ 离线 | ✅ 离线 | `posture.smoke` / `config.plumbing` |
| 快照 TTL / 无快照拒绝 | ✅ | ✅ 离线 | ✅ 离线 | `posture.smoke` / `action-bounds` |
| 三级投递链 + 恢复原前台 | ✅ 真机 | 仅离线覆盖 | 仅离线覆盖 | `delivery-chain.smoke`（真实 `cuaDeliver`） |
| 强杀锁存（stop/resume） | ✅ 离线 | ✅ 离线 | ✅ 离线 | `tools.smoke` / `dispatcher.test` |
| `unknown ≠ 成功` | ✅ | ✅ 离线 | ✅ 离线 | `tools.smoke` / `schema.conformance` |
| 结构密码扫描 | ✅ 真机 9/9 | 不适用 | 不适用 | A6 探针 + `posture.smoke` |
| WinUI3 输入通道 | ✅ 已定性（hotkey 无 AcceleratorKey/4s 超时，改点控件；可实验性自动回退） | 不适用 | 不适用 | 受控窗口实验 + t01 2026-11-14 + #3908 |
| 观察坐标一致性 | ✅ 文本 `@(x,y)` == 结构化 `elements` == 点击空间 | — | — | `observe.coords` + `verify-runtime` #17 |
| 菜单未确认 | ✅ `effect:unverifiable` 不再报成功 | — | — | `menu.receipt` + t01 复盘 |
| 像素点击落点 | ⚠️ best-effort（A7） | 未标定 | 未标定 | 六轮实验，见 ROADMAP A7 |

### 1.2 提示缓存 A/B（真实渠道）

2026-11-09，opencode / deepseek-v4.1-flash，重复请求同一前缀：

| 工具面 | 结果 |
|---|---|
| `dispatcher` 稳定 tools | 重复 **99.5%**；首次 tool_call 后 **92.1%**；第二次后 **85.4%** |
| 旧 `dynamic` / lazy search 工具层变化 | 首击 **0%–18%**（+1 工具 0%，+4 工具 17.7%） |

结论：**tools 列表必须稳定**。这是 `dispatcher` 成为默认、`dynamic` 被删除的直接依据。测试脚本在仓库外，key 只从本地配置读取、未打印。

### 1.3 模型可发现性（同渠道）

在不执行真实桌面动作的前提下，验证模型能否正确生成 dispatcher 调用：

- `computer_click` / `computer_type`（带观察上下文）、`computer_key`、`computer_verify`（带 `expect` 示例）、`computer_clipboard`、`computer_task`、`catalog`：均能生成 `computer_do({action:'call',...})`。
- 无上下文时倾向先 `screen_observe`；`scroll` 与“无示例的 verify”需要多一轮或更大 `max_tokens`。
- 结论：复杂参数建议先 `catalog`，必要时在 system prompt 给一个示例。

## 2. 历史证据

### 2.1 2026-11-12 — dsh 0.2.2-rc.1 headless 真机加载

隔离 patch 启用 `credentials` + 本插件，模型走 dsh 默认 `deepseek-official/deepseek-flash`，只做只读调用：

```bash
dsh --profile headless --patch "<工作区>/_probe-win-cu-deepseek.yml" \
  --permission-mode read-only --approval-policy never \
  "只做只读验证：status / screen_observe / catalog / 隐藏 computer_wait"
```

| 检查 | 结果 |
|---|---|
| 会话 | `session-e1d8a603-9225-4755-b1ad-78f766dbf42e`，1 轮 5 步，`turn_end: completed` |
| 插件加载 | `computer_do(action="status")` → “当前：dispatcher 模式（直接可见：computer_do, screen_observe；隐藏 20 个）” |
| 真实观察 | `screen_observe()` → `Arknights.exe · 明日方舟`，pid 47912 / window 14354214，4 个元素，快照 `s0000001f` |
| catalog | 20 个隐藏工具签名；`screen_zoom`、`computer_click`、`double_click`、`right_click` 等 |
| 隐藏路由 | `computer_do({action:"call",tool:"computer_wait",args:{ms:50}})` → `[computer_wait] 已等待 50ms。` |
| prompt cache | 每步 `cacheReadTokens`：6528 → 6656 → 6912 → 7296；tools 列表全程稳定 |
| 安全边界 | 只读 observe + 纯等待；未调用 bash/文件工具，未点击/输入 |

环境说明：

- headless profile **默认禁用 `credentials`**（`id: credentials disabled: true`）；探针 patch 显式启用后，才能解析 `~/.dsh/.credentials.yaml` 的 provider key。默认 headless 配置下 `MISSING_CREDENTIAL` 不是插件加载错误。
- 本机 `OPENCODE_GO_API_KEY` 已过期（401 `api_key_expired`），因此本次使用默认 DeepSeek 通道；这不影响插件证据。
- 探针 patch 在仓库外（`_probe-win-cu-deepseek.yml`），未入库。

### 2.1.1 2026-11-12 — S4 oracle 双向验证（10/10）

```bash
TEMP='C:\Users\66494\AppData\Local\Temp' TMP='C:\Users\66494\AppData\Local\Temp' \
  node evals/verify-oracles.mjs
```

| 检查 | 结果 |
|---|---|
| 任务 | `t01` `t03` `t04` `t05` `t06` `t07` `t09` `t10` `wa2` `x1` — **10/10 PASS** |
| 每条判据 | setup ok → oracle 空跑 fail → simulate pass ×2 → cleanup ok |
| 首次失败 | `0/10`，原因不是题目逻辑：本机 `TEMP=C:\Windows\TEMP`，PowerShell `Add-Type` 编译临时 `.cs` 报“未能找到源文件” |
| 修正 | 把 `TEMP`/`TMP` 指到 `%LOCALAPPDATA%\Temp` 后 10/10（最小 `Add-Type` 探针也已验证） |
| 说明 | 这是题目/判据验证，不调用模型、不执行 S4 任务；模型级任务仍需 web profile + 当前插件部署 |

### 2.1.2 2026-11-12 — headless S4 smoke（4 条，两轮）

`setup → dsh --profile headless（当前插件）→ oracle → cleanup`，默认 DeepSeek 通道。

**Round 1（仓库外一次性 runner，8 分钟上限）**

| 任务 | 结果 | 工具调用 | 备注 |
|---|---|---|---|
| `t01` 记事本保存 | **pass** | 49 | 8 分钟到点被终止，但 oracle 文件内容逐字匹配；turn 未正常收尾 |
| `t04` 计算器乘法 | **pass** | 19 | 显示 7,006,652；正常 final |
| `t07` 窗口最大化 | **pass** | 11 | `showCmd=3`；正常 final |
| `wa2` 设置隐藏 | **fail** | 57 | 8 分钟超时，属性仍为 `Archive`；未完成 |

**Round 2（`evals/headless-run.mjs`，10 分钟上限）**

| 任务 | 结果 | 工具调用 | 工具错误 | 未验证 | 备注 |
|---|---|---:|---:|---:|---|
| `t01` | **pass** | 41 | 7 | 13 | oracle 逐字匹配 |
| `t04` | **pass** | 23 | 0 | 10 | 7,006,652 |
| `t07` | **pass** | 5 | 0 | 2 | `showCmd=3` |
| `wa2` | **pass** | 72 | 12 | 16 | 10 分钟到点，但 oracle 属性已含 `Hidden` |

**汇总**

- 两轮合计 **7/8 pass（87.5%）**，1 条 fail（12.5%），0 条 setup/环境错误；Round 2 单轮 **4/4**。
- `wa2` 对时间预算敏感：8 分钟 fail，10 分钟 pass（72 次工具调用）——更像步速/路径效率问题，不是能力完全缺失；已列入 ROADMAP C10。
- Round 2 工具级：**141 次调用，19 次错误（13.5%），41 次 unverifiable（29.1%）**。错误计数包含探索性失败/重试，不等同于插件缺陷；但 `wa2` 的 12 次错误值得轨迹分析（含 `snapshot_mismatch`、Explorer 窗口前台确认失败、`computer_menu` 收到非 JSON path）。
- 这是 headless 直跑的插件/模型结果，不是 Web runner 的 `0/4`。
- **Web runner 已退役**：`evals/run.mjs` 以 dsh 0.1.5 UI 选择器编写；在 dsh 0.2.2 上创建空会话并误读步数，`0/4` 无效。现在默认拒绝运行并指向 `headless-run.mjs`（`--allow-legacy-web` 仅旧 UI 调试）。
- Round 2 的逐任务 JSONL 在 `evals/headless-runs/<stamp>/`（gitignore）；Web runner 退役见 ROADMAP C9。

### 2.1.3 2026-11-12 — dsh 0.2.2 兼容性升级（P0/P1/P2）

| 检查 | 结果 |
|---|---|
| `computer_task` 0.2.2 `startActivation` | ✅ headless 真机拉起子 agent；结构化结果 `OK`；回执注明“子 agent 拥有与父会话同级的能力” |
| `computer_task` API 形状 | ✅ 运行时扁平 spec（类型声明的嵌套 `request` 不可用）；rc.2 无 `list()`，provider 用 `getProvider` 探测 |
| `computer_task` 契约测试 | ✅ `tests/task.tool` T1–T9：请求构造/结果映射/预算/无服务/outputSchema 降级/失败/无 API |
| vision 默认 | ✅ `deepseek-flash`；真机观察者返回“视觉理解”段 |
| native 附件限额 | ✅ `maxImageDimension`/`maxImagePixels` 纳入判定；驱动 0.23.2 不能整窗 zoom，compact 明确失败；`tests/posture` N1 |
| G1/G5 | ✅ scroll/drag 校验 `snapshot_id`（`action-bounds` G1）；zoom `coordinateSpace=zoom-image-px` + `fromZoom` |
| PTC `run_code` | ✅ `tools.computer_do({action:'status'})` → dispatcher / 20 hidden |
| PTC native 图片 | ✅ `tools.screen_observe({mode:'native'})` 图片作为 deferred context 被主模型看到 |
| PTC + `computer_task` | ✅ `tools.computer_do({action:'call',tool:'computer_task',...})` 拉起子 agent；直接 `tools.computer_task` 为 undefined（SDK 只绑定可见工具） |
| 离线 | **22 套 / 458** 断言全绿；`npm run check` 20/20；`npm pack` 37 文件 |
| 兼容基线 | `dsh.compatibility.dsh` = `>=0.2.2-rc.1 <0.3.0` |

详细契约矩阵与剩余风险见 [docs/COMPATIBILITY-0.2.2.md](docs/COMPATIBILITY-0.2.2.md)。

### 2.2 2026-11-09/10 — P0/P1 安全边界、dispatcher、更名（0.5.7-dev）

| 项 | 结果 |
|---|---|
| 离线 | 10 套 **231** 断言（当时）；新增 `action-bounds`、`dispatcher.test`、`package-manifest`；`delivery-chain` 改为直接执行真实 `cuaDeliver` |
| 语法 | 16/16 JS + `bash -n` |
| 运行时 | `verify-runtime` **16/16**（dispatcher 2 可见 / catalog 20 / 隐藏 click 无快照拒绝 / native 图片落盘 / zoom 图片透传 / 坐标字段） |
| 打包 | 31 文件（当时）；更名后包名 `dsh-win-computer-use` |
| P0 修复 | `type`/`key` 不再盲发 desktop；`scroll`/`drag` 透传 `window_id`；`suspected_noop` 终态失败；指定窗口未匹配 fail-closed；观察降噪完整指纹 |
| 工具面 | `dispatcher` 默认（2 可见/20 隐藏）；`hybrid` 可选（7/15）；`dynamic` 删除 |
| 缓存 | 见 §1.2 |

### 2.3 2026-09-17 — 结构治理与发布前复跑（0.5.4/0.5.6）

| 项 | 结果 |
|---|---|
| 离线 | 7 套 **148** 断言；schema 20 个工具 / 42 个场景；config.plumbing 25 |
| 真桌面 | `live-action.e2e` **23/23**（重设计：唯一命名临时文件 + 标题匹配，不杀进程） |
| parity | observe/zoom 29 场景 `{value,render}` 逐字节一致；20 工具工具面 JSON 逐字节一致 |
| S4 oracle | `verify-oracles` **10/10**（首次 t04 因遗留计算器窗口失败，清理后通过——环境态问题，非退归） |
| 发现并修复 | `scroll`/`drag` 把结构化拒绝当成功；`runAction`/`dedupInvalidate`/`taskCallCount` 死代码；schema 覆盖 13/20 → 20/20 |
| 发布 | v0.5.6 注解 tag；`main` 单分支 |

### 2.4 2026-09-16 — dsh 0.1.5 适配、坐标契约、上下文预算

| 项 | 结果 |
|---|---|
| 离线 | 4 套 **74** 断言；19 个工具 / 22 个场景 |
| 真桌面 | `live-action.e2e` 3 轮 **30/30**（旧版设计） |
| 坐标标定 | 可控探针逐点最小二乘 **残差 ≤0.55px**：`computer_click(x,y)` = 窗口矩形相对物理像素；observe 元素坐标已换算到同一空间；截图 == `list_windows.bounds` 1:1 |
| 输入通道 | 经典 Win32（regedit `ctrl+f`）**3/3**；WinUI3（记事本）`hotkey` **5/5 失败**（UIA 加速器 4s 超时，上游 #3908） |
| 驱动完整性 | `cua-driver.exe` 清单 `requireAdministrator` → daemon 与 `app_launch` 子进程 High IL；非提权客户端清不掉（#3607） |
| S4 | 9 任务 + AC2 双向验证 **9/9**（连跑 3 次一致）；冒烟 t07 pass |
| 客户端适配 | 严格输出校验、composer `Input.insertText`、页脚格式、新会话视图钉住 |

### 2.5 2026-09-06/07 — A6/A7、快照新鲜度、原生视觉

| 项 | 结果 |
|---|---|
| A6 密码窗口 | **9/9**：结构标记注记 / guard 硬拒 / 普通框零误拒 / sidecar 时延 1.4–1.6s / zoom crop 元数据；发现并修复标记坐标系错误 |
| 快照新鲜度 | **4/4**：快照 id / 首写 confirmed+readback / 同快照二写一致性注记 / 密码框硬拒 |
| A7 坐标语义 | 六轮实验：驱动 0.23.2 文档契约与实测矛盾，三种语义假设均有反例 → 插件层定性 best-effort；element 路径可靠 |
| dsv4fv 通道 | ax ✓；native ✓（attachments 端到端，首 token 0.9s / 116 tok/s / 缓存 74%）；vision 观察者半通（只出思考），GLM 无 key 优雅降级 |
| 上游反馈 | #3576（密码投影）、#3586（树版本/条件请求）、#3587（干预信号）已提 |

### 2.6 2026-08-25 — 原生视觉接入

`verify-runtime` **12/12**：12 工具注册（新增 `screen_zoom`）；`screen_observe(ax)` 真实树；native text-only 拒绝；native image route PNG（1.06MB）attachments 落盘 + `{type:"image"}` 内容块；zoom 区域 JPEG；vision 降级链；坐标语义；安全回归；结构化拒绝透传。

### 2.7 2026-08-15 — macOS 初始验证

cua-driver headless / MCP 链路 / dsh-mcp-client 桥接；11 工具注册；备忘录“打开→点击→输入”闭环；TTL/白名单/危险词/密码保护；home 级 patch 安装与 HMR 热生效。此阶段的安全姿态（危险词审批）已在 0.4.0 删除，相关结论仅作历史。

### 2.3 2026-11-15 — runtime/pipeline 复盘（0.5.7-dev）

| 项 | 结果 |
|---|---|
| 真机 t01 证据 | 50 次调用（10 click / 14 key / 7 zoom / 1 set_value / 15 observe），约 6 分钟；8 次执行点击 × 5 段滑行 ≈ 40 次小段指针移动；另存为文件名框出现 `count:3` 三连击 + 8 次 BackSpace（均 `delivery_failed`/unverifiable） |
| Notepad 污染证据 | 同一窗口 8 个标签：`EF-C1...`、`EF_End...`（均“已修改”用户文档）+ t01/t05/t06/t07/t10 测试文件；窗口标题无 `*`，旧 cleanup 会尝试 WM_CLOSE |
| 元素点击修复 | `cacheSnapshot` 存点击空间；`resolveClickTarget` 检查 TTL；滑行目标不再偏移 `screenOrigin`；`tests/human.click` 11 项 |
| 投递失败修复 | `deliveryFailure` + `settleAction` 统一 `ok:false`；L3 retry 失败不再写“完成”；`tests/delivery.failures` 25 项 |
| 观察失败修复 | notFound/桌面降级/native 失败清快照；suspect 去重强制全量；`tests/observe.failure` 5 项 |
| Notepad 安全修复 | `Get-NotepadTabs`/`Test-NotepadTabSet`；Open/Close 精确 ExpectedTabs + pid/start time；dirty/leftover；`tests/notepad-tabs` 10 项 |
| 真机 t01 ×3 | **0/3 执行，3/3 setup error（steps=0）**：seed 落进现有 Notepad 窗口（`owned=False`，窗口仍含 2 个用户已修改标签 + 测试标签）；fail-closed 生效，未运行 dsh | 保存/关闭用户标签并清掉测试标签后重跑；当前窗口不要自动关闭 |
| CU 轨迹监控 | **✅ 首个真机样本**：443 events / 589.5s；34 observe / 39 action；53 `move_cursor` / 7257px；自动标记 repeat_action、observe_burst、repeat_observe | `tests/trajectory` + `evals/analyze-trajectory.mjs` |
| 监控下的 t01 | fail：76 steps / 8 errors / 15 unverified / timeout；轨迹显示 3 次重复 click、3 次连续 observe、另存为窗口重复 native+ax 观察 | 桌面干净后按轨迹的 loop 点继续修 |
| 轨迹驱动第二轮（离线） | **22 套 / 419 断言全绿**；`observe.truth` 16（输入值/差分/密码隐藏/同标题警告）、`action.echo` 13（目标回显/重复抑制）、`delivery.foreground` 13（force L3，含驱动抛异常；非 foreground 异常保持抛出）、`human.click` 11（auto 1 次/human 5 段/off 0 次/同目标跳过）、`key.xaml` 23（对话框 press_key）、`trajectory` 14（外壳透明/未验证/stub/suppressed/移动数）、`eval-safety` 37（UIA 关闭/owned 对话框/测试标签丢弃） | 真机 t01 单跑 + 三次复跑见下 |
| 真机 t01（修复后第 1 次） | **pass**：58 steps / 4 err / 15 unverified / 354.2s；26 observe / 30 action；2 `move_cursor` / 248px；无 timeout、无 dirty | 对比修复前：76 steps / 589.5s / 53 moves / 7257px |
| 真机 t01（修复后第 2 次） | **pass**：42 steps / 4 err / 12 unverified / 233.9s；19 observe / 22 action；0 `move_cursor`；Ctrl+A 三连循环消失 | 剩余局部 loop：type:77（stale→foreground 失败→background 成功）、click:6（mismatch→suppressed→成功） |
| 真机 t01（原地保存，单跑） | **pass**：31 steps / 1 err / 8 unverified / 184.5s；12 observe / 8 click / 5 zoom；1 `move_cursor` / 0px；tabstate restored | 2026-11-15 16:42；Save As 语义改由 t05 覆盖 |
| 真机 t01（原地保存 ×3） | **3/3 pass**：steps 37/18/19，err 1/0/1，unverified 12/4/4，duration 273.4/121.7/104.2s；每次 1 `move_cursor` / 0px；无 timeout、无 dirty；tabstate restored | 2026-11-15 16:46；轨迹无 repeat_action，只有 repeat_observe（同一窗口连续观察） |
| verify-oracles（2026-11-15 P2 复跑） | **10/10 PASS**：t01/t03/t04/t05/t06/t07/t09/t10/wa2/x1；tabstate restored，各任务 cleanup 无 dirty | t10 ProtectHwnd/state 重绑、t04 全窗口扫描、t06 clipboard round-trip、Explorer/Paint 状态化全部生效 |
| 真机 t01（P2 后 3x） | **2/3 pass**：r1 9 steps / r2 13 steps pass；r3 66 steps fail（内容不匹配，模型在菜单/剪贴板间抖动） | 原地保存语义未变；保存证据已加入 prompt；另一次提示词变体因模型工具抖动被人工停止，未计分 |
| 真机 t05（旧 Save As 失败样本） | fail：50 steps / 2 err / 17 unverified / dirty；oracle 文件不存在 | Win11 Save As 文件名框在驱动 UIA/type 路径下仍不可靠；保留 t05 作为失败样本，t01 用原地保存 |
| 真机 t01（观察真值轮 ×3，修复后） | **3/3 pass**：r1 99 steps pass；r2 9 steps pass；r3 10 steps pass；oracle 均 exact match | 三次均无 overlay 被 observe、无 screen_zoom missing pid、无 snapshot_missing；r1 实际使用 1 次 `from_zoom` |
| 真机 t05（观察真值轮 ×3） | **3/3 pass**：26/28/19 steps，err 1/2/0，unverified 11/10/9；oracle 3/3；cleanup `dirty=false`；tabstate restored | 2026-11-15 18:59；Save As 连续通过，输入回读/保存门禁未误拦 |
| 输入回读/保存门禁（离线） | **458 断言全绿**；action.echo 覆盖一致/不一致/无法回读、保存门禁、修正解除、set_value 回读、Document 不泄露 | `npm test`；from_zoom 真机探针另见下 |
| from_zoom 真机探针 | **pass**：请求 crop 160×100 → 返回 224×140；图中心 (112,70) 点击按钮成功写 marker | `node evals/probe-from-zoom.mjs`；证明驱动 padding/缩放映射可用 |
| WinUI 键鼠通道探针 | **Ctrl+A**：hotkey 两模式失败；press_key bg 未选中且插入裸 `a`；press_key fg / 编辑→全选均选中全文。**Alt+F**：仅 press_key fg 打开文件菜单。**Alt+Tab**：仅 press_key fg 切换前台 | `node evals/probe-winui-keys.mjs`；矩阵见 docs/WINDOWS.md §4.1 |
| 第二轮离线（2026-11-16） | **22 套 / 477 断言全绿**；`key.xaml` 33（alt+f 默认/opt-in、ctrl+a 菜单优先/press-only、press 失败不误导、菜单已开拒绝）、`action.echo` 30（菜单专用注记/复核菜单态、文档不置脏、set_value 语义）、`observe.truth` 20（文档不置脏提示） | `npm test`；语法 21/21；pack 38 文件 |
| 第三轮离线 + t01 新基线（2026-11-16） | **22 套 / 483 断言全绿**；`observe.truth` 25（新增 query 只读/无快照/动作拒绝/不污染差分）、`schema.conformance` 45。t01 新题面 ×5：**5/5 pass**，steps 17/32/8/19/11（median 17）、wall 98.0/278.5/69.2/129.8/81.0s；中间题面版本（未加“一次输入两行”）曾 **4/5**，r5 模型打开编辑菜单后点“全选”结束、未保存（oracle len=0）；两版都未再出现 52/66 步的星号强制置脏循环 | `npm test`；`evals/headless-run.mjs`；轨迹在 `evals/headless-runs/`（gitignored） |
| query 只读回归（2026-11-16） | **✅** query 后 `snapshotId=null`、header/footer 明确只读、click/type/key 返回 `[snapshot_missing]`、差分/降噪不被污染；全量观察后动作恢复 | `tests/observe.truth` T21-T25；`schema.conformance` observe/query-readonly |
| verifyAfterAction A/B（2026-11-16） | **10/10 pass**：t01 off 9/19/52 步、61.6/117.1/377.3s；auto 66/15/8 步、533.2/98.1/60.9s；t05 off 24/34 步；auto 22/26 步。中位数 auto 略好（t01 15 步/98.1s vs 19 步/117.1s；t05 24 步/177.4s vs 29 步/181.8s），但区间重叠、auto 有 533s 尾部且每轮多 2-12 次 click 复核；默认保持 `off` | 原始 report/trajectory 在 `evals/headless-runs/ab/`（gitignored），不入库 |
| verify-oracles（2026-11-15 18:40 复跑） | **10/10 PASS**：10 项全部 setup/emptyFail/simPass/repeat/cleanup；tabstate restored | t03 Explorer 慢关闭重试生效；此前 14-39 run 曾 9/10，15-02 run 在 t10 setup 被人工暂停 |
| P2 运行时修复 | L3 恢复带 pid（windowMap）；bring_to_front refused 判失败；app_launch/menu/clipboard/hover 不再假成功；stale token 清快照；computer_do data；窗口别名；监控 loop 语义修正 | `npm test` 22 套 / 419 断言（当时）；verify-runtime 17/17 |

## 3. 代表性缺陷与守门测试

| # | 缺陷 | 根因 | 守门 |
|---|---|---|---|
| 1 | 插件整棵树加载失败 | P1-7 重构丢了 `defineTool()` 返回值；原始字面量被 `assertSupportedJsonSchema` 拒 | 真机 headless 探针（离线假注册表无校验） |
| 2 | 所有工具调用报 `reading 'kind'` | 订阅了 `tools/post-execute` waterfall 却不调 `next()` | 真机探针 + 约定：只订阅 `tools/result` |
| 3 | 观测降级整次 `invalid output` | 降级回执字段未在 output schema 声明（dsh 严格校验） | `schema.conformance` 降级场景 |
| 4 | 结构化拒绝被当成功 | `{refusal:{code}}` / `effect:refused` 分散判断，menu/scroll/drag 各漏一次 | `lib/receipt.js` 单一出口 + schema 拒绝场景 |
| 5 | 坐标点击整体偏移 | 元素 frame 是屏幕 px，点击是窗口截图 px，差一个窗口原点 | 坐标标定 + observe 输出换算 |
| 6 | Windows 密码框保护静默失效 | guard 只匹配 macOS `AXSecureTextField`；Windows UIA 角色不同且无密码位 | `roles.js` 跨平台三态 + sidecar 结构位 |
| 7 | 结构密码标记标错相邻元素 | 旧假设“元素中心=窗口本地+原点换算”，实际 frame/sidecar 都是屏幕 px | A6 端到端 + 屏幕坐标直配 |
| 8 | `type`/`key` 盲发到当前前台 | 无 element/无快照时退回 `scope:'desktop'` | `action-bounds` P0-1/2 |
| 9 | `suspected_noop` 报成功 | `engineRefusal` 未识别该 effect | `action-bounds` P0-4 + `receipt` |
| 10 | 指定窗口未匹配却观察最前窗口 | 静默回退 | `action-bounds` P0-5 |
| 11 | 观察降噪误判“未变” | 旧哈希只看 label（label 非空时 value 不参与） | `observe.dedup` 值/enabled/selected/actions 变化 |
| 12 | 投递链测试测的是复刻 | 测试替换了整个 `lib/cua.js` | `delivery-chain` 直接执行真实函数 + `opts.call` |
| 13 | 文本元素坐标与点击空间不一致（t01 反复定位的根因） | `renderLine()` 用 driver 原始 frame，`mapElementsForModel()` 已减窗口原点，头部却声称同空间 | `observe.coords` + `verify-runtime` #17 |
| 14 | `computer_menu` 把 `effect:unverifiable` 报成功 | 只判 `refusal`，未判未确认 | `menu.receipt` + t01 2026-11-14 |
| 15 | eval setup/cleanup 危及用户 Notepad | setup 杀所有 Notepad；cleanup 按标题过滤后杀进程；`Close-TaskWindows` 默认匹配所有 Notepad | `eval-safety` 静态检查 + `Open/Close-TestNotepad` |
| 16 | 元素点击绕过 TTL + 滑行偏移 | 快照条目存屏幕坐标；`resolveClickTarget` 不查 `isFresh`；`glideCursor` 目标却是 window-local | `human.click` + `observe.coords` |
| 17 | 投递失败被当成功 | `engineRefusal` 不认 background/foreground_unavailable/delivery_failed；`settleAction` 全走成功分支 | `delivery.failures` + `delivery-chain` I |
| 18 | 新 Notepad 窗口恢复用户标签 | 只比较 HWND 新旧；cleanup 只看活动标题 `*` | `notepad-tabs` + `eval-safety` S8-S10 |
| 19 | 元素点击滑行跨屏大弧线 | `get_cursor_position` 是屏幕坐标，`move_cursor` target 是窗口截图坐标；起点未减窗口原点 | `human.click` + trajectory 首个样本 |
| 20 | 另存为文件名盲区导致保存循环 | observe 用 `label || value`，输入框只显示“文件名:”，隐藏框内旧文件名；模型点保存触发覆盖确认后把“否(N)”当“是” | `observe.truth` + `action.echo` + t01 轨迹 |
| 21 | 强制前台失败后无路可走 | `cuaDeliver` 在 force 时直接返回，不尝试 `bring_to_front`；token 点击不带 `window_id` | `delivery.foreground` + `delivery-chain` |
| 22 | 连续点击同一目标 | 回执 unverifiable + 无重复抑制，模型反复点同一按钮/菜单 | `action.echo` + `lib/loopGuard.js` |
| 23 | 5 段滑行 15–18s/点击 | 驱动单次 `move_cursor` 2–3s；旧 `auto` 前台仍保留 5 段 | `human.click` + `cursorMotion:auto/human/off` |
| 24 | 轨迹工具计数翻倍 | `computer_do` 外壳与内层工具都记 `tool_end`/toolSeq | `trajectory.test` T9-T11 |

## 4. 未验证 / 未完成

| 项 | 状态 | 原因/影响 | 下一步 |
|---|---|---|---|
| 2026-11-15 t01 ×3 | setup error ×3 | 当前 Notepad 窗口仍有 2 个用户已修改标签 + 6 个测试标签；三次 seed 都落进该窗口（`owned=False`），setup fail closed，steps=0，未调用 dsh | 用户保存/关闭用户标签并清掉测试标签后，重跑 `verify-oracles` 10/10 + t01 三次（auto）+ 一次默认 off |
| 部署 | 旧版 | web profile 仍是旧名 `dsh-computer-use` v0.5.3 | 按 [PUBLISH.md](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) 重新安装并重启 |
| npm 发布 | 未做 | 包名 `dsh-win-computer-use` 可用，账号已登录 | `npm publish --access public`（需用户明确授权） |
| macOS 近期回归 | 未做 | 近期测试都在 Windows；macOS 证据多为 0.1–0.2 时期 | 有 macOS 环境时跑离线 + verify-runtime |
| Linux | 未验证 | 桌面环境/accessibility 栈差异大 | 不在当前承诺范围 |
| 像素点击 A7 | best-effort | 驱动 0.23.2 混合 DPI 落点缺陷；插件层不可判定 | 等上游；element 路径优先 |
| WinUI3 hotkey/menu | 部分可达 | 4s 超时 + `could not find a UIA AcceleratorKey`（#3908）；`invoke_menu` 可能不可用 | 默认给控件指引；`xamlKeyFallback: auto` 实验性自动“开菜单→点项”；上游跟踪 |
| `app_launch` 清理 | 需人工 | 子进程 High IL，非提权侧 UIPI 拒绝关闭 | 任务产出接受人工收尾 |
| 委派工具约束 | 宿主相关 | 0.2.2 `startActivation` 没有 `toolFilter`；工具集由 Agent Preset/宿主决定 | 插件如实说明；严格限制用宿主 Agent Preset |
| `computer_task` 工具面 | 真实但有限 | 默认超时 5 分钟、每会话 3 次；子 agent 可能拥有父级能力 | 见 README“委派的能力边界” |

## 5. 复现方式

```bash
npm install
npm run check; echo "check=$?"
npm test; echo "test=$?"
node verify-runtime.mjs
node tests/live-action.e2e.mjs 3
node evals/verify-oracles.mjs
npm pack --dry-run

# dsh 0.2.2-rc.1 真机加载（隔离 patch 需启用 credentials；headless 默认关闭）
dsh --profile headless --patch "<工作区>/_probe-win-cu-deepseek.yml" \
  --permission-mode read-only --approval-policy never \
  "调用 computer_do(action='status')，把返回原文贴出来"
```

判据：

- `npm test` 退出码 0，且最后每套都打印“全部通过”；
- `verify-runtime` 的 `结果：17/17 通过`；
- `live-action` 的 `23/23`（会打开临时记事本窗口；不杀进程，残留标签人工关闭）；
- `verify-oracles` 的 `10/10`；
- `npm pack --dry-run` 的 total files = 36；
- headless 探针的 `status` 返回 `dispatcher` / 2 可见 / 21 隐藏（本次实测见 §2.1；§2.1 为 2026-11-12 的 20 隐藏历史记录）。
- 若 `verify-oracles` 的 PowerShell 报 `Add-Type` 找不到 `C:\Windows\TEMP\*.cs`，先设 `TEMP`/`TMP` 到 `%LOCALAPPDATA%\Temp`。

## 6. 证据约定

- **真值/实验产物不进仓库**：`evals/report-last.json`、`dsv4fv-exp/`、工作区 `_*.mjs` 探针均不入库；仓库只进可复现脚本与文档。
- **测量驱动**：被数据否决的方案要记录（SoM、双原点、坐标三假设、动态工具面）；不要凭直觉复活。
- **平台分列**：安全承诺按平台实测；`unverified` 不写成 `supported`。
- **失败也记录**：超时、环境态失败、驱动缺陷都写进报告；修复后保留根因与守门测试。
