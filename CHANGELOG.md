# Changelog

> **版本状态（2026-11-18）**：最新发布 tag 为 `v0.5.6`；`main` 为 `0.5.7-dev`（未发布），dsh 兼容基线为 **0.2.2-rc.1**。`package.json` 版本仍在 0.5.6，发布时统一 bump。npm 未发布；web profile 仍部署旧名 `dsh-computer-use` v0.5.3。

## 0.5.7 (未发布)

**2026-11-09/12：安全边界与可复现性修复（P0/P1）+ 工具面收敛 + Windows-first 更名 + 文档体系重写 + dsh 0.2.2 兼容升级**

**2026-11-14：t01 复盘——坐标一致性、菜单未确认、XAML 组合键回退、eval 清理安全化**

**2026-11-15：观察真值与 t05 模态隔离——overlay 过滤、快照连续性、zoom from_zoom、compact 明确失败、同 pid 对话框清理**

**2026-11-16：输入回读与保存门禁——阻止部分输入/错字后误保存；Codex overlay、菜单提示、app_launch 语义**

**2026-11-16（第二轮）：WinUI opt-in 前台 press 回退、菜单状态反馈、文档“不置脏”提示**

**2026-11-16（第三轮）：query 只读过滤视图、t01 星号证据修正、探索指标**

**2026-11-16（第五轮）：dirty 轨迹修复——computer_activate、t11 颜色入口/题面、t12 16:9 seed、t15 重命名优先**

**2026-11-17（第六轮）：手势原语接线——click modifier、drag from_zoom/steps、t11 焦点纪律、t12 白底 seed、t15 批量测量**

**2026-11-17（第七轮）：输入真实性与前台语义——background_delivery_failed 分类、组合键自动前台、强制指针 L3、t14/t17 轨迹修复与评测硬化**

**2026-11-17（第八轮）：私有 SendInput 拖拽——modifier/button/dwell_ms、持久 PowerShell helper、社区调研**

**2026-11-18（第九轮）：cua-driver 兼容层——0.52/0.53 形态适配、session 快照、像素截图预取、原生 modifier drag**

### 2026-11-18 Added（第九轮）

- **内部驱动 SDK**：新增 `lib/driver/transport.js`（唯一 spawn、超时/退出码/JSON/contract/session/结构化拒绝分类）、`capabilities.js`（版本、能力标志、请求映射、响应/错误自适应）、`normalize.js`（0.23.2/0.52/0.53 响应 → 内部规范形态）、`info.js`（进程级驱动信息缓存）。`lib/cua.js` 保留原导出作为 facade，45 个调用点无需改动。
- **0.52+ 形态适配**：`get_window_state` 总是显式 `tree_format:"elements"`（0.52 默认 markdown，无 `elements`）；注入统一 `session`（element_token/zoom 快照按 session 归属）；`window_bounds/window_title` 合成内部 `window`；`frame`/`screenshot_frame` 校准并统一屏幕坐标；`zoom` MIME、`clipboard plain_text`、`verify satisfied`、`list_windows is_minimized`、`check_permissions postmessage`、MCP `content[]` 全部归一。
- **像素截图上下文**：0.52+ 的像素 click/drag/scroll 与 `zoom` 前必须有截图读取；快照无 capture 时自动补 `get_window_state(include_screenshot:true)`，并把旧 element_token 标为失效（坐标动作继续，编号动作要求重新观察）。`screen_zoom` 同样补 capture，`from_zoom` 不受影响。
- **原生 modifier drag**：0.39+ 且探测可用时走驱动原生 modifier（foreground 持有到 release）；0.23.2/未知版本/`dragEngine:private` 走私有 SendInput helper；`dwell_ms` 始终私有；原生失败不自动重拖。
- **真实性修复**：非零退出 + JSON 结构化拒绝当回执值，继续走前台升级链；`contract mismatch` 明确要求 CLI 与 daemon 一起升级；组合键回执遇到 `foreground_restored:false` 不再声称已恢复原前台；`move_cursor` 在 0.52+ 的 window scope 改为屏幕坐标，`glideCursor`/`hover` 用快照原点换算并去掉旧驱动才接受的 `origin` 字段。
- **配置/诊断**：新增 `driverProfile: auto|legacy|latest`、`dragEngine: auto|private`；`computer_do(action="status")` 显示驱动版本/能力/警告；`verify-runtime` 与探针可区分驱动形态。
- **测试**：新增 `driver.normalize` / `driver.capabilities` / `driver.transport` / `driver.compat` 四套与 fixtures；现有 22 套零改动通过。离线 **26 套 / 629 项检查**，语法 **26/26**。
- **轨迹驱动真实性修复**：t17 pre-fix 轨迹发现“native observe 后像素 click 返回 `screenshot_context_missing`，但 `engineRefusal` 不认识裸 code，回执写成‘点击完成’”。新增 `pointerCaptureReady` 与 `FAILURE_CODES`；`action.echo` E31/E32、`action-bounds` D12 锁住。随后发现 0.52 的 `include_accessibility_tree:false` capture-only 读会保留 snapshot/token，`ensurePointerCapture`/`screenZoom` 切换到该路径；t17 从 post-fix 86 步降到 **29 步**，t14 76 pass / 64 fail（fail 是 Paste 目标问题）。参数误用增加通用 `PARAM_HINTS` + `computer_do` 常用参数速查；默认 cursorTheme 改为 `cua.default`，自定义主题失败回退。
- **0.52.13 canary 真机**：`verify-runtime` 17/17；`live-action.e2e` 33/33；`probe-driver-shape` 确认默认 markdown/显式 elements、session 归属、capture-only；`probe-modifier` `ok=true / dragModifierSupported=true`；combo/private/from_zoom/native-freshness 全通过；t14 在 deepseek 上 **2/3 pass**（53/51 步全绿；r2 64 步仅 `Sales series values=false`），opencode capture-only **76 pass / 64 fail**（fail 轮 Paste 未落、单元格全 false；非兼容错误）；t17 capture-only **29 步 pass**（从 post-fix 86 步降下来；A1 exact、0 假成功）；t11 **77 步 / capture-only 76 步**、t12 **112 步 / capture-only 98 步** pass；t15 **55 步 pass / 52 步 fail**（capture-only 复跑未用 Ctrl+click，文件未移动；非兼容错误）；t14 capture-only **76 pass / 64 fail**（fail 轮 Paste 未落）。0.53 的 `screenshot_frame` 已预留，待真机验证。
- **capture-only 回归（t11/t12）**：opencode-go/deepseek-v4.1-flash、0.52.13、脏桌面复跑，均 pass。t11 **76 步**（73 inner、3 tool errors、24 unverified、1224s；38 observe/16 click/6 drag/5 activate/3 zoom/1 type；oracle 22/22 全 true；另有 2 次 `screen_observe` 窗口标识失败）；t12 **98 步**（96 inner、6 tool errors、44 unverified、1378s；41 observe/24 click/11 key/7 type/5 right-click/3 activate/3 double-click/1 set_value；oracle 13/13 全 true）。两条轨迹均无 `screenshot_context_missing`/`stale_element_token`；错误为 snapshot_missing/mismatch/expired、前台锁、`window_target_not_found`，模型 1–2 步内恢复；t11 仍有 `screen_observe(window="17306228"/"s4-t11-canvas")` 参数误用，按拒绝文本改走窗口列表后恢复。

### 2026-11-17 Added（第六轮）

- **click 家族 `modifier`**：`computer_click`/`double_click`/`right_click` 新增 `modifier: string[]`，支持 ctrl/shift/alt/win，`control→ctrl`、`option→alt` 规范化去重；Windows 上非空 modifier 自动 `forceForeground`（SendInput 前台注入）并在回执说明。driver 0.23.2 的 element 与坐标两条路径均已在 WinForms 探针中确认 Ctrl 到达目标。
- **drag 手势**：`computer_drag` 新增 `from_zoom`（起终点都按 zoom 图坐标）与 `steps`（1–200，默认 20）；`duration_ms=0` 不再被 truthiness 丢弃；四坐标改为有限数字校验。**不暴露 drag `modifier`**：driver schema 接受，但真机探针的 MouseDown/Move/Up 全部读到 `Control.ModifierKeys=None`，属于 driver 0.23.2 缺口。
- **防误抑制/轨迹**：`loopGuard` 签名加入排序后的 modifier，Ctrl+click 不会与普通 click 被当成同一重复动作；`trajectory` 的 action 签名加入 modifier/from_zoom/drag 参数，driver 参数白名单加入 from/to/steps/duration/from_zoom，便于复盘。
- **t11 题面/setup**：先 `computer_activate` Paint，再在画布起点单击聚焦；第一次 drag 若 unverified 且无痕迹，重激活/聚焦后用 `foreground=true` 重试一次；黑线用 `steps=30`，不使用 drag modifier。UIA 实测画布为 `(879,600) 800x600`（1:1），setup 现在用 AX `大小` 菜单把 `矩形/椭圆/直线` 都固定为 `8 像素`，题面给出精确窗口坐标并禁止模型再碰 `大小`。修正后 **3/3 pass，70/88/48 步**（三色 ROI/coverage/precision 全绿；activate + 首次 drag 前焦点 click；app_launch=0）。
- **t12 seed/题面**：`New-S4WidescreenPptxSeed` 改为白底（`p:bg`）并裁掉模板装饰，只保留 title/subtitle 占位符 + 三条灰色 `S4 Bar Q1/Q2/Q3`；setup 用 `TitleNeedle='replica'` 确认加载的是演示窗口；AC2 setup 无修复对话框。题面改为按形状名选择、标准色/主题色精确路径、双击柱直接输入 Q1/Q2/Q3、每柱后保存；预算 40 分钟。**2/2 pass，140/169 steps**，oracle 的 hash/1 页/16:9/三文本/三色柱全 true（此前 25 分钟/190 步仅 red/blue + Q1）。
- **t14 Excel 题面/oracle**：题面改为先输表、点 A1 + `Ctrl+Shift+End` 选 A1:D6、`Alt+F1` 插原生柱状图、标题 `S4 Sales`、最后 Save As；25 分钟预算。`Read-XlsxManifest` 同时读取图表分类公式和缓存标签，oracle 接受 `catFormula` 含 A2 或缓存里的 Jan..May。结果 **2/2 pass，141/71 步**（24 格/barChart/标题/Sales/Month categories 全 true）。
- **t17 PDF 题面**：三击句子（`computer_click(count=3)`）+ Ctrl+C，禁止 Ctrl+A；Excel 先 Save As `out\excerpt.xlsx`，再 Ctrl+V、Ctrl+S。结果 **2/2 pass，89/63 步**，A1 两次精确匹配。模型把测试 PDF 开进了用户 Firefox 的新标签；跑完只在测试标签被选中时 Ctrl+W 关闭单个标签，保留用户其余标签，未关 Firefox 窗口/进程。
- **t15 题面/边界**：补充 `computer_click(element=..., modifier=["ctrl"])` 的多选用法，提醒不要 Ctrl+click 已选中项；文件单选必须 `foreground=true`——t15 首轮实测 background 点击在 Explorer 文件项上走 UIA Invoke，直接打开 Notepad/Photos/PDF，导致该轮作废；F2 后先 Ctrl+A 全选含扩展名，避免 `report-final.txt.txt`。修正后 **3/3 pass，77/72/59 步（各 5 次 Ctrl+click，无 Notepad/Photos 误开）**。
- **click 描述**：同步写明 Explorer 文件项单选用 `foreground=true`，后台点击可能直接打开文件。
- **度量**：`analyze-trajectory` 新增 `modifierCalls/modifierByTool/ctrlClickCalls/shiftDragCalls/fromZoomDragCalls/dragStepsCalls/waitCalls/activateBeforeFirstDrag/clickBeforeFirstDrag/focusClickAtDragStart`；`ab-summary` 输出对应列。
- **探针**：新增 `evals/probe-modifier.mjs`（click modifier 门禁 + drag modifier 缺口记录）与 `evals/probe-native-freshness.mjs`（driver/plugin 两层截图 freshness）；均不加入 npm test。

### 2026-11-17 验证（第六轮）

- 离线：`npm test` 22 套 / **533 项检查**全绿；`npm run check` 21/21；`verify-runtime` 17/17；`node tests/eval-safety.mjs` 全绿。
- AC2：`verify-oracles --tasks t11,t12,t15` => t11/t15 PASS（AC2 full），t12 SKIP（`ac2:none`，setup/oracle-empty/cleanup 通过）。
- 手势：`probe-modifier` 证明 click element/坐标的 Ctrl 到达目标；drag modifier 在 driver 0.23.2 上不进入目标（不开放）；`probe-native-freshness` 未复现陈旧截图。
- t15：**3/3 pass，77/72/59 步**（各 5 次 Ctrl+click；无 Notepad/Photos 误开；dirty=false）。
- t11：**3/3 pass，70/88/48 步**（三色 ROI/coverage/precision 全绿；activate + 首次 drag 前焦点 click；app_launch=0）。
- t12：**2/2 pass，140/169 步**（hash/1 页/16:9/title/subtitle/Q1-Q3/三色柱全 true；40 分钟预算）。
- t14：**2/2 pass，141/71 步**（24 格/barChart/标题/Sales/Month categories 全 true；25 分钟预算）。
- t17：**2/2 pass，89/63 步**（A1 exact；三击 PDF 句子复制；测试 Firefox 标签按选中态 Ctrl+W 单独关闭）。
- 所有运行 `dirty=false`；测试窗口按 state HWND/标题清理；用户 Notepad 未触碰；未提交任何 report/trajectory/measurement 产物。

### 2026-11-17 验证（第七轮）

- 离线：`npm test` 22 套 / **551 项检查**全绿；`npm run check` 21/21；`verify-runtime` 17/17；`eval-safety` 全绿。
- t14：新题面 **3/3 pass，59/41/57 步**（404/253/314s）；`typeCalls=1/1/2`（只剩图表标题）、`clipboard=1`、`activate=2/2/5`、`wait=2/2/0`；24 格/barChart/标题/Sales/Month 全 true，`seed unchanged=true`。旧题面 141/71。
- t17：新题面 **3/3 pass，37/53/48 步**（257/323/294s）；`typeCalls=0`、`clipboard=1`、`activate=5/2/7`、`wait=1/1/7`；A1 exact、`seed unchanged=true`；用户 Firefox 仍 8 个标签、无 `s4-t17` 测试标签。旧题面 89/63。
- forced pointer 前置单次后复跑：t14 **42 步**、t17 **42 步**，均 pass（oracle/seed 全 true；t14 typeCalls=2、t17 typeCalls=0）。
- 组合键探针：`probe-combo-foreground` 在 blocker 前台时，插件 `key()` 自动前台目标并把 `Ctrl+V` 送进 WinForms TextBox，文本 `S4-COMBO` 完整到达。
- 回归 t11：drag 前置单次后 **1/1 pass，58 步**；全部指针前置单次后 **1/1 pass，94 步**（两轮画布/白底/三色 ROI/coverage/precision 全 true，无鼠标键/设置离题；方差仍大）。
- 回归 t15：**2/2 pass，85/67 步**（8 文件/内容/旧路径全 true；第二轮用 5 次 Ctrl+click 批量，明显快于逐文件剪切）。
- 回归 t12：白底 PPT **1/1 pass，152 步**（1 页/16:9/title/subtitle/Q1-Q3/红蓝绿三柱全 true，1069s）。
- AC2：`verify-oracles --tasks t14,t17` => SKIP（`ac2:none`）；setup/empty-fail/cleanup 通过，t17 setup 的 `PDF page 3 ready=true`。
- 回归：t11/t15/t12 见下方本轮补充；所有运行 `dirty=false`，测试窗口按 state HWND/标题清理，未提交 report/trajectory/measurement 产物。

### 2026-11-17 验证（第八轮）

- 离线：`npm test` 22 套 / **555 项检查**全绿；`npm run check` **22/22**；`verify-runtime` 17/17；`eval-safety` 全绿。
- 私有拖拽探针：**3/3 pass**；`probe-private-drag` 经真实插件 `computer_drag(modifier=["ctrl","shift"], dwell_ms=120)` 调用持久 helper；WinForms 目标在 down/move/up 三个点均读到 `Shift, Control`，`sent=30`，`foregroundRestored=true`，`stuckButton=false`，`stuckModifiers=""`。
- 单测：D7（modifier 私有路由+屏幕坐标映射）、D7b（dwell 无 modifier 也走私有）、D8（modifier+from_zoom 明确拒绝）、D9（缺 screenOrigin 明确拒绝）；action-bounds 30→34，总断言 551→555。
- 无 modifier 的 drag 路径未改，既有 t11/t12/t14/t15/t17 结果仍适用；Explorer Ctrl+drag 复制、Excel 工作表标签 Ctrl+drag、PPT Shift 约束尚未纳入自动回归，作为下一轮真机项。

### 2026-11-17 Added（第八轮）

- **私有拖拽 helper**：新增 `tools/private-drag.ps1`（持久 PowerShell + Add-Type C# P/Invoke）与 `lib/privateDrag.js`。一次手势内完成 PMv2 DPI、前台校验、modifier keydown、mouse down、6px 阈值、16ms 插值、可选 dwell、mouse up、modifier 反向 keyup、恢复原前台；失败路径 `finally` 释放按钮/修饰键。
- **`computer_drag` 新参数**：`modifier`（ctrl/shift/alt/win）、`button`（left/right/middle）、`dwell_ms`（0-2000）。`modifier` 或 `dwell_ms` 非空时走私有路径；无 modifier 仍走 driver（保留 from_zoom/background）。私有路径不支持 `from_zoom`，明确报 `[private_drag_zoom_unsupported]`；缺 frame 报 `[private_drag_no_frame]`。
- **坐标映射**：私有路径用快照 `screenOrigin + screenshotWidth/Height + bounds` 把窗口截图坐标映射到屏幕物理像素；`hwnd` 用 `window_id`，helper 在 virtual desktop 上归一化。
- **社区调研**：确认 cua-driver 0.23.2 的 drag `modifier` 不读取，上游 PR #5667/0.39.0 已修；OpenAI CUA/Anthropic/ZCode CU/UI-TARS/Agent-S 的 drag 语义对比、SendInput/PostMessage/UIA 边界、DPI/多显示器、drag 阈值/时序、modifier 生命周期与不重试原则已整理进 `docs/CU-RESEARCH.md` / `docs/WINDOWS.md`。
- **探针**：新增 `evals/probe-private-drag.mjs`（真实插件 → helper → WinForms down/move/up 修饰键验证）；不加入 npm test。

### 2026-11-17 Added（第七轮）

- **投递分类修正**：`deliveryFailure` 的 `delivery_failed` 改为词边界匹配。驱动返回 `escalation.reason='background_delivery_failed'` 时结构化 `effect` 仍是 `unverifiable`，不能再被整段 JSON 子串误判成硬失败。t14 r1 的 28 次 type 中 26 次“输入未送达”但 24 格全部写对，根因即此；现在回执为“输入完成（未验证）”，不拦保存。
- **type 快照 churn**：`postInputVerify` 对没有 Document/TextArea 的聚焦输入（Excel 网格、PowerPoint 画布）不再调用 `refreshSnapshotState`；非硬失败时保留窗口快照，连续 Tab/Enter 不再 `[snapshot_missing]`。有 Document 的输入仍逐字回读。
- **组合键自动前台**：`computer_key` 带修饰键时一律前台注入并恢复原前台（即使 `deliveryMode:background`），回执注明“组合键需前台注入”；避免后台 synthetic 路径把 `Ctrl+V` 只落成 `v`。普通按键仍可后台 PostMessage。
- **强制前台指针前置单次**：`foreground:true` 的 click/scroll/drag 改为先 `bring_to_front` → 只执行一次 → 恢复原前台，不做失败后重试；`deliveryMode=auto` 的非强制路径仍保留 `unverifiable + 指针 → L3`。t11 实测 L3 重试让单次 drag 约 9s、同一形状画两遍，模型随后误入“鼠标键/设置”；t15 16 次 foreground click 全部重试、单次约 9s。改为前置单次后 t11 回归 **58/94 步**（均 pass）、t15 **85/67 步**（均 pass）；t11 方差仍在，t15 第二轮明显变快。
- **观察提示**：`screen_observe` 在目标 z 序落后时提示先 `computer_activate(pid,window_id)`，不要 Alt+Tab/任务栏；坐标行带源图 `W×H` 并明确预览可能缩放，网格/画布用 `screen_zoom` + `from_zoom=true`。
- **t14 题面**：先 activate + wait；表格用一次剪贴板 TSV + Home 功能区 Paste（不逐格 type，Ctrl+V 失败时重写剪贴板再点 Paste）；粘贴后只核对一次；A1 坐标不确定时用 zoom/from_zoom；F12 无对话框走 File > Save As > Browse，文件名用 `computer_set_value`。
- **t17 题面**：只允许 setup 打开的 `s4-t17-doc` 浏览器窗口，禁止在 Firefox/其它浏览器打开或导航测试 PDF；activate + wait 2000-4000ms，空白时 force observe + reload；Excel 先 Save As，文件名用 `computer_set_value`，A1 用 zoom/from_zoom，Paste 后 Ctrl+S 并核对公式栏。
- **评测硬化**：t17 setup 新增 `Wait-TestPdfPageReady`（UIA Text/Document 轮询 `S4-T17:`，20s），空白 PDF 不再通过 setup；t14/t17 setup 记录 `seedHash`，oracle 用共享读流校验 seed 未被覆盖（Excel 持锁时 `Get-FileHash` 会失败）；t17 A1 去掉 `Trim()`，严格比较并输出长度。
- **测试/探针**：新增 `background_delivery_failed` 分类、forced unverified 指针 L3、forced drag 前置单次、组合键前台、无 Document type 保留快照、observe 前台/坐标提示等 18 项断言（533→551）；新增 `evals/probe-combo-foreground.mjs` 真机验证插件 `key()` 自动前台后 Ctrl+V 到达 WinForms TextBox。

### 2026-11-16 Added（第五轮）

- **`computer_activate(window_id, pid?)`**：显式把已存在窗口前置（driver `bring_to_front`），不启动/关闭应用，也不恢复原前台；默认 dispatcher 下隐藏，经 `computer_do` 路由。`catalogOf` 上限 20→24，隐藏工具 20→21，工具总数 22→23。
- **t11 修复**：canvas/ref 移到 `{task_dir}` 根；setup 先开 Paint 再开参考浏览器，并最大化 Paint；Paint 11 的 `矩形/椭圆/直线` 与 `红色/靛蓝色/黑色` 调色板项在 AX 树中，题面给出显式点击/拖拽顺序；oracle 改为三色 ROI + 全局 precision；`Probe` 确认调色板名称。
- **t12 seed**：从本机 `WidescreenPresentation.potx` 裁剪出单页 16:9 `out\replica.pptx`（改 content type、删其余 slide/notes/rels），预填 title/subtitle 并注入 3 个目标几何的灰色占位柱；setup 直接打开最终路径并记录 `seedHash`；oracle 要求 hash 变化。题面改为“给占位柱改色/加标签”，去掉 footer/字体要求。
- **t15 题面**：仍保留 8 文件；重命名放在移动之前，明确单击、禁止双击文件、F2 失败时用命令栏“重命名”，并要求最后统一验证一次。
- **helper 修复**：`Open-TestAppWindow` 的 Office splash 二次选择重新校验 `TitleNeedle`；`Open-TestPaintDoc` 对已有 `mspaint` fail-closed；`Dismiss-TestSavePrompt` 支持 Paint 11 主窗口内的“是否要保存?” ContentDialog。
- **trajectory**：新增 `appLaunchCalls` / `activateCalls`（含 dispatcher 路由），`ab-summary` 输出对应列。
- **文档沉淀**：新增 `docs/CU-RESEARCH.md`（Codex/Claude Code/ZCode/Trae + UI-TARS/Agent-S/Cua 的复杂任务处理模型与证据等级）和 `docs/TRAJECTORY-ANALYSIS.md`（t11/t12/t15 逐轮时间线、工具计数、失败模式、ZCode CU 的 Ctrl+click/画布拖拽/PPT 形状探针）；README/MAINTAINING/TESTING/WINDOWS/ARCHITECTURE/VERIFICATION/evals 建立入口。ARCHITECTURE §13 新增 A8-A12（drag modifier/from_zoom/steps、click modifier、native freshness、selectText/key hold、前台手势）。

### 2026-11-16 验证（第五轮）

- 离线 `npm test`：22 套 / **510 断言**全绿；`npm run check` 21/21；`verify-runtime` 17/17；`verify-oracles --tasks t11,t12,t15` => t11/t15 PASS（AC2 full），t12 SKIP（AC2 none）。
- **t11**：旧题面 107/71 步 fail；显式题面 **84/77 步 pass**（oracle 全绿；app_launch=0，computer_activate 使用，12 次 drag）。一次变体因强制大小滑块被中止；无效 PNG 输出现在按 fail 而不是 ENV。
- **t15**：新题面 **3/3 pass**，steps 177/146/89（8 文件终态正确），中位仍高于旧题面 112；冗余主要来自 F2/右键重命名与逐步验证，单靠题面未压下来，后续考虑拆 rename 或固定 Explorer 视图。
- **t12**：16:9 seed + 预填 title/subtitle + 灰色占位柱可直接打开、可保存；25 min/190 步运行中 title/subtitle、红/蓝柱、Q1 通过，Q2/Q3 与绿柱未完成。t12 仍列高风险，不作为 smoke 承诺；后续需拆分“改色/加标签”或进一步减少柱数/延长预算。
- 未提交任何 report/trajectory/measurement 产物。

### 2026-11-16 Added（第三轮）

- **`screen_observe(query)` 改为只读过滤视图**：query 调用后跳过 `cacheSnapshot`/`diffObserve`/`dedupEvaluate`，并 `clearSnapshot()`（driver 的 `get_window_state` 已让旧 token 失效）；输出 `snapshotId=null`，header/footer 明确“编号不能用于动作/from_zoom，需要动作请重新全量观察”。这样 query 的子集不会削弱保存门禁、菜单栏判断、`nearestEntry` 或动作后复核。
- **t01 题面星号证据修正**：`evals/tasks/t01-notepad-save.md` 不再要求“标题 `*note.txt` → `note.txt`”，改为以 oracle 文件内容为准，并禁止为制造星号使用空格/退格/重复输入/查找替换。
- **`DOCUMENT_INPUT_NOTE` 强化**：明确“星号不出现/标签页未修改都属正常；不要用 SPACE/BACKSPACE/重复输入强制置脏”；观察头部与 `computer_type` 描述同步。
- **`evals/analyze-trajectory.mjs` 探索指标**：`typeCalls/retypeSame/retypeDiff/nativeObserves/forceObserves/queryObserves/zoomCalls/clipboardCalls/dragCalls/menuCalls/snapshotMismatch/repeatSuppressed/innerSteps/strategy`；解析抽成可导出 `analyzeTrajectory(file)`。
- **`evals/ab-summary.mjs`**：汇总 report+trajectory 的 median/p90/IQR、strategy 分布、paired delta；n<8 标 `p90Unstable`。
- **`evals/headless-run.mjs`**：report 增加 `patchPath/patchSha256`，每 run 增加 `wallMs/innerSteps`；TabState restore 放入 `finally`；两份 eval patch 固定 `agent-default-model`（dsh 0.2.2 不支持 seed/top_p）。

### 2026-11-16 Fixed（第三轮）

- **query 过滤树覆盖主快照**：`query="文本编辑器"` 只返回 1 个元素时，`computer_key` 会误判“没有菜单栏，更像对话框”，模型转向 zoom/拖拽/剪贴板。现在 query 不建立动作快照，动作前必须全量 observe。
- **t01 慢跑的强制置脏循环**：旧题面的星号证据在 UIA 不置脏下不可满足；模型用 SPACE/BACKSPACE 制造又消除星号。题面与插件注记同时修正。
- **t01 单次输入约束**：真机 r5 模型把两行拆成两次 `computer_type` 并在中间按 Enter（delivery_failed 但实际插入换行），随后在编辑菜单里点“全选”结束、未保存。题面明确“在一次 computer_type 中包含换行输入两行，不要分两次/行间按回车”，减少该策略分支。
- **验证（第三轮）**：离线 **22 套 / 483 断言**，语法 21/21；t01 新题面 ×5 **5/5 pass**，steps 17/32/8/19/11（median 17）；中间题面版本曾 4/5（r5 点“全选”结束未保存）。两版都未再出现 52/66 步的星号强制置脏循环。query 只读由 `observe.truth` T21-T25 + `schema.conformance` 守门。

**2026-11-16（第四轮）：真实脏桌面套件 t11-t17、dirty isolation、ENV 语义与安全 helper**

### 2026-11-16 Added（第四轮）

- **dirty 任务隔离**：t11-t17 md 标记 '- **isolation: dirty**'；headless/verify 只在选中 Notepad 任务时备份/恢复 TabState，dirty 组不要求关闭用户 Notepad。setup ENV（应用/网络/浏览器不可用）在 headless 记 verdict=env，不计入 pass/fail；verify-oracles 对 app/network 依赖的 ac2:none 任务显示 SKIP，不伪造 PASS。
- **新任务**：t11 Paint 鼠绘复刻（PNG mask 容差）、t12 PPT 布局复刻（PPTX XML）、t13 论文下载（用户浏览器 + 新增 PDF SHA-256）、t14 Excel 数据+柱状图、t15 Explorer 多文件整理、t16 本地浏览器表单、t17 PDF 定位+摘录（高风险）。
- **新 helper**：`evals/lib/image.ps1`（C# LockBits mask/bbox/覆盖率、参考图生成）、`office.ps1`（PPTX/XLSX ZIP+XML 读取，无 COM）、`form-server.mjs`（127.0.0.1 表单）、`common.ps1` 的 `Open/Close-TestAppWindow`/`Open-TestPaintDoc`/`Open-TestBrowserWindow`/`Wait-S4DownloadMatch` 等；全部记录 hwnd/pid/processStart/title，关闭只认 state，证明不了就 leftover+dirty。
- **eval-safety**：新增 S25-S31（禁止按 Paint/PowerPoint/Excel/Chrome/Edge 进程名杀、禁止宽 Close-TaskWindows、新任务 state helper/Dirty、Downloads 只按 hash 清理、dirty md 标记），离线断言 41→65。

### 2026-11-16 验证（第四轮）

- 离线 `npm test`：22 套 / **507 断言**全绿；`verify-oracles --tasks t11` PASS、t15/t16 PASS（AC2 full）、t12/t13/t14/t17 为 SKIP（setup/oracle-empty/cleanup 通过，无 simulate）；t13 论文源改为可访问的 NeurIPS PDF。
- 真机 t11 r1：**fail 107 步**（file exists=false；模型在 Paint 工具栏/窗口间探索，未保存输出）；t12 r1：**fail 126 步**（file exists=false；PowerPoint 探索未保存）；t13 论文下载 **pass 19 步**（NeurIPS PDF SHA-256 匹配，cleanup removed=1）；t15 **pass 112 步**；t16 **pass 17 步**；cleanup 干净、TabState skipped、无用户窗口被关。t11/t12/t17 暂列高风险，不作为 smoke 承诺。
- 未提交任何 report/trajectory/measurement 产物。

### 2026-11-16 Added（第二轮）

- **`xamlPressFallback`（实验性，默认 `off`）**：UIA 加速器不可用时，对 `ctrl+a` / `alt+f` 允许一次前台 `press_key`（带 pid/window_id，forceForeground）。两者都开时 `ctrl+a` 仍菜单优先，仅菜单栏/菜单项不可用或打开点击失败时 press；`xamlKeyFallback=off` 可强制 press 优先。`alt+f` 成功后清空快照；快照已显示弹出菜单时拒绝发送，避免关菜单。不含 Alt+Tab（foreground 会真实切走前台）。
- **`lib/menu.js`**：共享 `isMenuRole` / `isTopMenuBarLabel` / `isAppMenuBarLabel` / `menuStateOf`（同窗口三态：`true/false/null`，阈值仍为非顶层菜单项 >=3），观察头部、XAML 回退、点击复核共用，避免正则漂移。
- **菜单专用反馈**：顶层菜单栏点击 `unverifiable` 时用 `MENU_CLICK_NOTE` 替换通用未验证注记；`verifyAfterAction=auto` 时同一次 `get_window_state` 顺带报告“检测到弹出菜单项/未检测到（可能已关闭或独立窗口）”，不额外扫描 popup 窗口。
- **`DOCUMENT_INPUT_NOTE`**：`computer_type` 目标为 Document/TextArea（或无 element 但快照有文档）时提示“UIA 注入可能不置‘未保存’标记；不要据此判断失败，保存仍会写入”，阻止 t01 r1 类“用查找替换强制置脏”的绕路；观察头部同步补该语义。`SET_VALUE_NOTE` 也改为“不要据此判断失败，保存前用回读/观察核对正文”。
- **`evals/analyze-trajectory.mjs`**：新增 `snapshotReadsByTool`，按 `driver.parent` 归属统计 `get_window_state`，用于 A/B 区分 verifyAfterAction 复核与普通观察。
- **测试**：`key.xaml` 33（alt+f 默认/opt-in、ctrl+a 菜单优先与 press-only、press 失败不误导、菜单已开拒绝、非 XAML 不吞）；`action.echo` 30（菜单专用注记/复核菜单态、文档不置脏、set_value 语义）；`observe.truth` 20。离线 **22 套 / 477 断言**，语法 **21/21**。
- **verifyAfterAction 首轮 A/B**：t01 ×3 + t05 ×2 每臂，**10/10 pass**。t01 off 9/19/52 步（61.6/117.1/377.3s），auto 66/15/8 步（533.2/98.1/60.9s）；t05 off 24/34 步（146.1/217.5s），auto 22/26 步（145.3/209.5s）。auto 中位略优，但区间重叠、有 533s 尾部且每轮多 2-12 次 click 复核；**默认保持 off**。原始 report/trajectory 在 gitignored 的 `evals/headless-runs/ab/`，不入库。

### 2026-11-16 Fixed（第二轮）

- **`alt+f` 没有任何回退**：此前 `TARGETS` 早退直接给通用指引；现在 `xamlPressFallback=auto` 可前台 `press_key` 打开文件菜单，默认 off 时给“点文件菜单栏项”的具体路径。
- **对话框 `press_key` 失败后仍建议 `foreground=true`**：该路径本就是 forced foreground；现在明确返回“前台 press_key 也未能发送”，改给 computer_type/控件路径。
- **`verifyAfterAction` 文档与实现不一致**：文档称覆盖 type/set_value，实际只覆盖 click/double/right/key（含坐标）；文档已校正，并注明输入回读独立于该开关、复核会刷新 token/TTL。

### 2026-11-16 Added

- **输入回读**：`computer_type`/`computer_set_value` 在投递失败、unverified、suspected_noop 或已有未确认输入时，抓一次无截图窗口状态，用 Document/AXTextArea/Edit 的 value 逐字比较（CRLF 归一；set_value 精确、type 允许已有正文下的 contains）。回执只报“一致/不一致/无法回读”和长度，不打印正文。
- **`inputUnconfirmed` 保存门禁**：状态独立于 snapshot，跨刷新存活；`guard` 只拦保存意图（Ctrl+S/Ctrl+Shift+S、保存/另存为元素或 24px 近邻、保存菜单路径），允许 type/set_value、Ctrl+A/C/V/X/Z 和非保存点击。回读一致、同窗口 native observe 或 screen_zoom 清除。
- **`tests/action.echo.mjs` E15-E20**：输入回读一致/不一致/无法回读、保存门禁、修正解除、set_value 回读、Document 正文不泄露。`observe.truth` T17-T19：Document 正文隐藏、顶层菜单栏不误报、真正弹出菜单才提示。`observe.coords` C14：Codex overlay 拒绝。`tools.smoke` G2d/G2e：menu 路径分隔/顶层编号指引。
- **`evals/probe-winui-keys.mjs`**：WinUI3 键鼠通道矩阵——Ctrl+A/Alt+F/Alt+Tab 的 hotkey、press_key(background/foreground)、菜单回退；用 UIA TextPattern selection、弹出菜单项、GetForegroundWindow 判定真实效果。结果见 docs/WINDOWS.md §4.1。

### 2026-11-16 Fixed

- **`computer_type` 部分输入后被按字符数误判成功**：t01 r2 无 element type → synthetic_events → delivery_failed，界面出现 33 字符但内容损坏；现在回读不一致会设置 inputUnconfirmed，保存被阻止，模型必须修正或 native/zoom 核对。
- **Codex overlay 仍被默认观察**：`isAgentOverlayWindow` 增加 `codex-computer-use`、`Codex Computer Use Cursor Overlay`、包含 `cursor overlay` 的标题。
- **顶层菜单栏误报“菜单已打开”**：只统计非顶层菜单栏的 MenuItem；真正的弹出菜单才提示。
- **Document 正文可经 label 回退泄露**：Document/AXTextArea 不再用 value 充当 label。
- **`app_launch` 启动成功但前置失败被当成启动失败**：`ok` 只看启动；前置失败写“启动成功，但前置未确认”，并输出 `window_id`（可见主窗）。Windows `creates_new_instance` 描述为 no-op。
- **`set_value` 回执暗示已持久化**：增加 ValuePattern 可能不置脏的说明；不再给无效的 foreground=true 建议，改提示用 computer_type 重试。
- **轨迹监控把观察提示当动作失败**：`screen_observe` 头部的“delivery_failed/丢字”提示被 `resultSummary` 误计为观察本身的 delivery/unverified（r1 显示 33 delivery/72 unverified，实际动作仅 2 delivery/41 unverified）。现在只对动作工具解析错误标记，观察工具只记 ok/stub/changed。
- **menu 字符串路径**：接受 `"文件/保存"`；`menu_path_unavailable` 时给出快照里顶层菜单栏项编号。
- **验证**：离线 22 套 / 458 断言全绿（第二轮后 477）；`verify-oracles` 10/10；t01 ×3 **3/3 pass**（99/9/10 步）、t05 ×3 **3/3 pass**（26/28/19 步，dirty=false、TabState restored）；`from_zoom` 真机探针 crop 160×100 → 图 224×140，图中心点击成功写 marker。

### 2026-11-15 Added

- **`from_zoom`**（click/double/right）：`screen_zoom` 后可直接把图内坐标交给 `computer_click(x,y,from_zoom=true)`，由驱动按 padding/缩放映射回窗口坐标；插件按 pid 记录最近 zoom，要求同 pid/window 且晚于当前观察。`computer_type` 不提供该参数。
- **`Get-ModalTestWindows`**（eval）：在直接 `GW_OWNER` 之外，用 owner 链或“主窗 disabled + `GetLastActivePopup`”证明同 pid 顶层对话框归属；`Close-TestNotepad`/`Dismiss-TestSavePrompt` 只处理已证明的测试模态窗，标题只用于报告。
- **`tests/posture.smoke.mjs` F3/F4**：只传 `window_id` 时 zoom 仍带 resolved pid；>500px 宽在插件侧快速失败。**`human.click` H9-H11**：from_zoom 映射/零滑行/缺失与跨窗口拒绝。**`observe.coords` C12/C13**：overlay 不入选/显式拒绝。

### 2026-11-15 Fixed

- **agent 光标覆盖层污染观察目标**：`pickObserveTarget` 过滤 `Cua.AgentCursorOverlay*`，候选列表同样不列；显式指定给专门错误。t01 r3 曾连续 4 次观察它并清掉有效快照。
- **失败观察清空有效快照**：`picked.notFound` 与不同窗口的桌面降级/`mode.fail` 保留旧快照并提示仍有效；只有同 pid/window 失败才清空。
- **`screen_zoom` 丢 resolved pid**：只传 `window_id` 时首次 zoom 不再报 `Missing required integer field pid`；目标不存在或 pid/window 不匹配 fail closed。
- **zoom 坐标映射偏移**：驱动 0.23.2 会加约 20% padding 并在超 500px 时缩放；插件不再用请求 crop 手算 `scale`，正常 zoom 输出 `fromZoom=true/coordinateSpace=zoom-image-px`，`crop` 仅表示请求区域。
- **native/compact 整窗 zoom 不可实现**：驱动请求区域宽上限 500px；`nativeImage=auto/compact` 超限时明确失败并提示 ax/vision 或 `screen_zoom`，不再假装 compact 成功。
- **t05 同 pid 另存为对话框残留**：cleanup 现在能识别并关闭已证明归属的 WinUI 文件对话框，避免 `dirty=true` 与 TabState restore 被残留 Notepad 阻塞。
- **投递/边界加固**：keyFallback token 点击补 `window_id`；app_launch 前置选 `launched.windows` 的可见主窗；`engineRefusal` 识别 `ok:false/success:false/supported:false/error_code`；clipboard `supported:false` 不再假成功；restoreForeground 用全量 `list_windows` 查 pid；`refreshSnapshotState` 使用快照 `maxElements` 并把同编号 role 变化视为结构性变化。

### 2026-11-14 Added

- **`xamlKeyFallback`（实验性，默认 `off`）**：XAML/WinUI 组合键失败后，`auto` 可对白名单组合（ctrl+s/ctrl+shift+s/ctrl+a/c/v/x/z/f/n/o）自动“点唯一菜单栏项 → 轮询弹出菜单 → 点唯一 enabled 菜单项”；全部 token 点击、后台投递，歧义/缺失即停，不自动处理另存为/覆盖对话框。默认 off 时只返回可执行控件指引。
- **`lib/keyFallback.js`**：组合键规范化、白名单、菜单项唯一匹配、弹窗轮询、失败回执。
- **`tests/observe.coords.mjs`（11）**：文本 `@(x,y)` == 结构化 `elements.x/y` == 减窗口原点；`window_id` 精确匹配；同 pid 多窗口 z 序；缺 bounds 显式降级。
- **`tests/key.xaml.mjs`（19）**：两类 XAML 失败、回退开关、歧义/缺失/非白名单、投递层误报成功、suspected_noop。
- **`tests/menu.receipt.mjs`（7）**：`effect:unverifiable` 不再报成功；数组 path 可用。
- **`tests/eval-safety.mjs`（11）**：禁止按 Notepad 进程名杀、`Close-TaskWindows` 无显式模式、t01/t05/t06/t10 走 `Open/Close-TestNotepad`。
- **`evals/headless-patch-xamlfallback.yml`**：仅用于验证自动回退的实验 patch。
- **`evals/lib/common.ps1`**：`Open-TestNotepad`/`Close-TestNotepad`（HWND/ownership 作用域、未修改才 WM_CLOSE、失败留窗报告）；`Find-WindowsByTitle -VisibleOnly`；`Close-TaskWindows` 删除默认 Notepad/无标题/记事本宽匹配，必须显式 patterns。

### 2026-11-14 Fixed

- **观察文本坐标与点击空间不一致（t01 反复定位根因）**：`renderLine()` 用 driver 原始 frame（屏幕 px），结构化 `elements` 已减窗口原点，头部却声称同空间。文本行改用 `mapElementsForModel()` 的结果；无 bounds 时明确标注 `screen-physical-px` 且不要直接点击；`screen_zoom` 文案改为“换算到窗口截图坐标后直接点击，不要再加 screenOrigin”。
- **同 pid 多窗口选错辅助窗口**：`pickObserveTarget()` 对 pid 匹配按 on-screen、z_index、标题具体度排序；`screen_observe` 新增 `window_id` 精确匹配；未匹配候选带 window_id。
- **`computer_menu` 把 `effect:unverifiable` 当成功**：现在返回 `ok:false`，要求先 `screen_observe`，不要重复调用；只有 `confirmed` 才算成功；`path` 支持 JSON 字符串或数组。
- **XAML 无 AcceleratorKey 未翻译**：新增 `uiaAcceleratorUnavailable()`，与 4s 超时一起走控件指引；不再透传驱动的 `get_window_state` 建议。
- **`computer_key` 投递层误报成功**：`foreground_unavailable` / `background_unavailable` 返回 `ok:false`；`suspected_noop` 附“先观察”注记并标 suspect；通用路径复用 `settleAction`。
- **eval setup/cleanup 危及用户 Notepad**：删除 `setup/t01/t05/t06` 的 `Stop-Process` 全量杀；t01 改用唯一空 seed `s4-t01-seed.txt`，t05 用 `draft.txt`，t06 用唯一 seed；t01/t05/t06/t10 cleanup 改为 HWND 作用域关闭；t10 双文件分别记录；`hygiene.ps1` 只报告不关闭；x1 不再无参数 `Close-TaskWindows`。
- **t01 prompt 歧义**：明确“临时文件 seed / 另存为完整路径 / 第二行后不要回车”。

**2026-11-15：runtime/pipeline 复盘——元素点击 TTL/滑行坐标、投递失败语义、Notepad 标签级安全、CU 轨迹监控**

### 2026-11-15 Added

- **`lib/trajectory.js` + `trajectoryFile`（默认关闭）**：按工具/驱动调用写 JSONL；文本只记 len+hash，`get_window_state` 只记元素数/快照 id，不落 AX 树/截图；AsyncLocalStorage 归属驱动调用；自动标记 repeat_action/repeat_observe/observe_burst/relocate_ratio/pointer_burst。
- **`evals/analyze-trajectory.mjs`**：统计观察/动作比、驱动调用、指针位移、错误/拒绝/未送达、重复动作与 loop；`npm run trajectory:analyze`。
- **`tests/trajectory.test.mjs`（8）**：文本脱敏、驱动归属、结果摘要、重复动作 loop、session_end。
- **headless eval 集成**：每次 dsh 运行写 `<task>-r<n>.trajectory.jsonl`，报告记录路径。

- **`docs/RUNTIME-PIPELINE.md`**：宿主启动/工具面/观察/动作/投递/快捷键/Notepad/session 日志的完整链路与失败语义。
- **`tests/human.click.mjs`（8）**：元素点击 TTL、background 不滑行、foreground 滑行目标=窗口截图坐标、近距离单次移动、tokenless 回退。
- **`tests/delivery.failures.mjs`（25）**：background/foreground/delivery_failed 对 click/type/scroll/drag/set_value 全部 ok:false；纯 unverifiable 仍 ok:true。
- **`tests/observe.failure.mjs`（5）**：未找到窗口/桌面降级清旧快照；suspect 后去重强制全量。
- **`tests/notepad-tabs.test.mjs`（6）**：纯标签分类器：精确/额外用户标签/已修改/未知后缀/双标签/数量不符。
- **`cursorMotion` 配置（默认 `auto`）**：background 不滑行，前台保留轨迹；近距离只做一次终点移动。

### 2026-11-15 Fixed

- **元素点击绕过 TTL + 滑行坐标错误**：`cacheSnapshot` 存点击空间 x/y（减 `screenOrigin`）；`resolveClickTarget` 检查 `isFresh`；`glideCursor` 目标改为点击空间；tokenless 回退也使用正确坐标。
- **投递失败仍报成功**：新增 `deliveryFailure()`；`settleAction` 对 `background_unavailable`/`foreground_unavailable`/`delivery_failed` 返回 `ok:false`、不消费快照；纯 `unverifiable` 保持“已送达但未验证”。
- **L3 假“重试完成”**：`escalateViaBringToFront` 检查 retry 值；仍失败时写“重试仍未送达”。
- **scroll/drag gate 顺序**：`freshnessGate` 移到投递之前，避免动作已落地却报 `[snapshot_consumed]`。
- **XAML fallback 对话框误导**：无菜单栏时不再说“去点编辑菜单”，改为 foreground 重试按键/点击输入框后 foreground type。
- **观察失败保留旧快照**：notFound/桌面降级/native 失败清空旧快照；suspect 去重强制全量。
- **Notepad 新窗口恢复用户标签**：2026-11-14 t01 的窗口实际有 8 个标签（2 个用户已修改文档 + 6 个测试文件）。`Open/Close-TestNotepad` 改为 UIA TabItem 精确 ExpectedTabs 校验；额外/已修改/未知后缀 setup fail closed，cleanup 留窗并写 `_leftovers/`；cleanup JSON 带 `dirty`。
- **`analyze-sessions.mjs` 支持 v4**：多 zstd frame 解码；从 `computer_do.arguments.tool` 归因隐藏工具。

**2026-11-15（轨迹驱动第二轮）：观察值/状态差分、目标回显、重复点击抑制、强制前台 L3、指针降噪、监控准确性**

### Added

- **`tests/observe.truth.mjs`（16）**：输入框当前值外显、密码隐藏、标题/值/字符数差分、降噪 stub 关键控件、同标题多窗口警告、Notepad/记事本别名。
- **`tests/action.echo.mjs`（13）**：坐标/元素回显、重复点击抑制、观察变化放行、`actionGuard=off`、double_click 不拦、app_launch 前置 refused、stale 清快照、verifyAfterAction 差分。
- **`tests/delivery.foreground.mjs`（13）**：真实 `cuaDeliver` 在 force + `foreground_unavailable`（含驱动抛异常）时用 `pid+window_id` 走 L3；重试失败如实报未送达；hotkey 同样升级；非 foreground 异常保持抛出。
- **`lib/loopGuard.js` + `actionGuard`（默认 `on`）**：同窗口/目标/投递模式 5s 内重复且观察未变化 → `[repeat_suppressed]`，不消耗快照；观察变化清除计数。
- **`cursorMotion: human`**：保留 5 段弧线；`auto` 改为前景单次移动；同目标 16px/2s 内跳过滑行。
- **观察 `changedSinceLast` / `changes`**：`自上次观察` 一行差分；输入类 `elements.value`；schema 同步声明。
- **轨迹监控新统计**：`computer_do` 外壳透明、`unverified`/`observeStubs`、`toolAvgMs`、`deliveryModes`、`movesPerClick`。

### Fixed

- **另存为文件名盲区（t01 循环主因）**：`mapElementsForModel`/`renderLine` 旧实现用 `label || value`，输入框只显示“文件名:”，隐藏了框内 `s4-t01-seed.txt`；模型点保存触发“确认另存为”，又把 `(465,171)`（否(N)）当“是”。现在值单列输出（密码/文档正文除外），动作回执回显目标。
- **unverifiable 无状态证据**：每次观察附标题/输入值/状态栏字符数/元素增删差分；模型不必因“不确定”反复重输、重观察。
- **强制前台绕过 L3**：`cuaDeliver` 在 force 时遇到 `foreground_unavailable` 直接返回；现在只要 payload 有 `pid+window_id`，同样 `bring_to_front` → 前台重试 → 恢复原前台；token 点击也带 `window_id`。
- **对话框已前台仍建议 foreground**：`tryXamlKeyFallback`/`xamlKeyGuidance` 增加 foreground/hasMenuBar 判断；无菜单栏对话框改为“点输入框 → computer_type”；`auto` 对编辑类组合额外尝试前台 `press_key`。
- **指针 5 段滑行 15–18s/点击**：驱动单次 `move_cursor` 2–3s，旧实现 5 段；`auto` 改为单次，`human` 显式保留轨迹。
- **轨迹计数翻倍**：`computer_do` 与内层工具重复记录，58 次调用显示 115；外壳透明，摘要改为真实调用数。
- **每次观察重复 check_permissions**：30s 缓存，减少固定 2s/次。
- **同标题多窗口静默取最前**：头部/stub 明确“匹配 N 个，改用 window_id”。
- **残留另存为对话框**：`Close-TestNotepad` 在标签校验通过后先关 owned 模态对话框；`headless-run` 消费 `cleanup.dirty`，pass 改记 `dirty` 并非 0 退出。
- **t01 Save As 语义不稳定**：Win11 Save As 文件名框在驱动 UIA/type 路径下会返回 confirmed/unverifiable 但值不变，Ctrl+A 前台被锁，旧另存为/覆盖确认对话框叠层。t01 改为 setup 预开空 `target\note.txt`、输入后“文件→保存”原地保存；`--repeats 3` **3/3 pass**（37/18/19 步，273/122/104s，每次 1 次 move_cursor）。Save As 覆盖保留在 t05。
- **Notepad TabState 跨任务污染**：新增 `evals/lib/tabstate.ps1 backup|restore`，runner 在任何 setup 前备份用户 TabState、每个任务前清 eval bin、跑完恢复；`Open-TestNotepad` 增加“已有 Notepad 窗口则 fail closed，不把测试标签加进用户窗口”的 preflight；`Close-OrphanTestNotepads` 只关全局测试白名单 + 唯一 seed（或 eval 期间创建）的窗口；关闭优先 UIA `WindowPattern.Close`（WM_CLOSE 被 Win11 Notepad 忽略），cleanup 可丢弃测试标签的修改。
- **L3 恢复原前台缺 pid**：`bring_to_front` 恢复只传 `{session,window_id}`，15/15 次被驱动 `missing pid` 拒绝仍写“已恢复”。新增 `lib/windowMap.js`，恢复时查 `previous_fg_hwnd→pid`（未知补 `list_windows`）；失败如实写“原前台恢复未确认/未恢复”。
- **`ok:true + effect:"refused"` 当成功**：`bring_to_front`/`app_launch`/`computer_menu` 统一按 `engineRefusal`/effect 判定；`app_launch` 只有 confirmed 才写“已前置”，否则 `ok:false`；menu effect 缺失不再落到成功；clipboard/hover 检查 refusal/error_code；stop/resume 驱动失败如实注记/保持锁存。
- **stale_element_token 后继续用旧编号**：`settleAction` 识别 stale 后 `clearSnapshot()`，回执要求重新 observe；`keyFallback` 点菜单栏前重新抓唯一菜单栏 token，避免回退自身把 token 用旧。
- **`computer_do` 丢结构化字段**：新增 `data` 输出（crop/screenOrigin/apps/status/results/text/pid/structured 等），screen_zoom/verify/app_list/task/clipboard 路由不再丢 metadata。
- **窗口中文别名**：`记事本/Notepad`、`计算器/Calculator`、`画图/Paint`、`文件资源管理器/Explorer`；matchCount 按 title+app 并集警告。
- **轨迹监控误报**：`repeat_observe` 只统计连续、同一 windowId、`changedSinceLast!==true` 的观察；`repeat_action` 排除 refusal/deliveryFailure/snapshotMismatch/suppressed；签名含 text hash/投递模式；`topRepeats` 保留峰值。
- **t10 orphan 误关**：`Close-OrphanTestNotepads -ProtectHwnd` + 当前 setup 已开 HWND 保护；orphan 不再仅凭 `evalOwned` 关通用文件名；`Wait-NotepadTabSet`/失败前写 state/首窗消失重绑 b 窗。
- **cleanup 假 dirty**：无 state 文件 = 无窗口可清，不再写 `_leftovers`；`verify-oracles` 消费 `dirty/ok`，cleanup 放 `finally`，env error/timeout 也清理；`headless-run` 消费初始/最终 cleanup，timeout 不跑 oracle。
- **t04/t06 环境阻塞**：Calculator 扫描所有 UIA 顶层窗口的 `CalculatorResults`，可见则不杀；t06 clipboard round-trip 8 次，失败在开 Notepad 前返回 EnvError。
- **Explorer/Paint 安全**：新增 `Open/Close-TestExplorer`、`Open/Close-TestPaint` 状态化 HWND/PID；t03/wa2 不再宽 `Close-TaskWindows`，t09 不再按 mspaint 进程名杀；Paint 已有用户进程时 fail closed。
- **`verifyAfterAction`（实验性，默认 off）**：element 动作 unverifiable 后抓一次无截图状态，回执附差分；结构性变化清快照，值变化保留 logical snapshot_id 换新 token；等 A/B 后再考虑默认。
- **驱动调用超时**：`rawCall` 30s 超时（`CUA_CALL_TIMEOUT_MS` 可覆盖），避免挂死 step；runner timeout 等 `taskkill /T /F` 完成。

### Added

- **更名（2026-11-10）**：包名/仓库名 `dsh-computer-use` → **`dsh-win-computer-use`**，定位为 Windows-first Computer Use；`package.json`、`cordis.patch.yml`、install/uninstall、README/文档与 GitHub 仓库同步更名。旧 GitHub URL 自动 redirect；npm 尚未发布，无历史包名负担。
- **`surfaceMode`（2026-11-10：dispatcher 默认；dynamic 已废弃移除）**：`dispatcher` 只暴露 `computer_do + screen_observe`，`hybrid` 再暴露 click/type/key/scroll/verify 5 个高频原生工具；其余工具经 `computer_do({action:'call', tool, args})` 路由到隐藏实现，`action:'catalog'` 返回紧凑签名。隐藏工具不注册、不可直接调用，但仍走原 guard/快照/stop 锁存/参数校验/回执；`screen_zoom` 图片经 dispatcher 透传。旧 `lib/surface.js`、enter/exit、自动回落和 `tests/surface.mjs` 已删除。
- **`lib/dispatcher.js`**：模式常量（`SURFACE_MODES`、`HOT_TOOLS`）、可见/隐藏工具清单、catalog 签名生成。
- **`tests/dispatcher.test.mjs`**（32 断言）：A/B 注册面、catalog、隐藏工具不可直接调用、guard/stop/resume、参数校验、未知工具、图片透传、工具面稳定、宿主 schema 断言；默认 dispatcher 回归。
- **`computer_set_value`（第 22 个工具）**：驱动 `set_value`（UIA `ValuePattern`）直连，适用于可设置控件（文本框/滑块/下拉）；Web/自绘控件可能忽略，回执明确提示改用 `computer_type` 或点击后输入。加入 `OPERATION_TOOLS`（密码框硬拒）与 dispatcher catalog。
- **`tests/action-bounds.mjs`**：P0-1/2/3/4/5 与 P1-A 的行为边界测试（无快照拒绝、type/key/scroll/drag 的窗口绑定、suspected_noop、窗口未匹配 fail-closed、set_value payload）。
- **`tests/package-manifest.test.mjs`**：锁定 peerDependencies / devDependencies / dsh 兼容下限 / 发布文件清单 / 权限声明，防清单回归。
- **`tests/delivery-chain.smoke.mjs` 重写**：直接导入真实 `lib/cua.js`，通过 `opts.call` 注入假驱动；不再用复刻的 `cuaDeliver` 测复刻（P0-0）。
- **`evals/headless-run.mjs`**：dsh 0.2.2 可用的 S4 headless 直跑器（复用 setup/oracle/cleanup，保存逐任务 JSONL，统计工具错误/未验证/超时）；配套 `evals/headless-patch.yml` 与 `npm run eval:headless`。Web runner 的 dsh 0.2.2 UI 兼容另列 ROADMAP C9。

### Fixed

- **`computer_type` 无 element 时盲发 `scope:'desktop'`（P0-1）**：改为必须绑定新鲜快照窗口（`pid + window_id`），输入到该窗口当前焦点；无快照直接拒绝。密码保护仍只在指定 element 时可预判焦点控件，回执如实注记。
- **`computer_key` 无快照时退回 `scope:'desktop'`（P0-2）**：改为必须 `resolveWindow`，按键绑定快照窗口；无快照直接拒绝，不再盲发当前前台。
- **`computer_scroll` / `computer_drag` 丢弃 `window_id`（P0-3）**：`resolveWindow` 返回的 `windowId` 现在透传到 payload；多窗口应用不再由驱动“自动选第一个可见窗口”。
- **`suspected_noop` 被当成功上报（P0-4）**：`engineRefusal` 新增识别；`settleAction` 返回 `ok:false`、附“先观察再决定是否重试”注记并 `markSuspect`（不 `markConsumed`，避免复用旧快照）。`unverifiable` 的“成功但未验证”语义保持不变。
- **`screen_observe(window=...)` 未匹配时静默回退最前窗口（P0-5）**：改为 fail-closed，返回候选窗口列表且不建立快照；未指定 window 时才取 z 序最前，提示文案不再把“指定了但没找到”误写成“未指定”。
- **观察降噪哈希漏字段（P1-B）**：旧哈希只看映射后的 `label`（`label || value` 截断 48 字符）；当 Edit 的 label 非空时 value 完全不参与，长文本/`enabled`/`selected`/`actions` 变化会被误判“状态未变”。改为基于驱动原始元素的 SHA-1 指纹（完整 label/value/enabled/selected/actions/is_password/parent/depth/frame），时间/行列噪声仍归一化。
- **宿主依赖清单与测试环境错位（P0-6）**：`dependencies` 固定 `dsh-tools 0.1.1-rc.2`，而宿主已是 `0.2.2-rc.1`，干净 checkout 跑 `npm test` 直接 `ERR_MODULE_NOT_FOUND`。改为 `peerDependencies`（`dsh-tools >=0.2.2-rc.1 <0.3.0`、`schemastery >=3.19.0 <4`）+ `devDependencies` 固定实测 `0.2.2-rc.1 / 3.19.0`；lockfile 同步。
- **`install.sh` 生成的默认值过期**：仍写 `ttlMs: 15000 / maxElements: 500`，与当前默认 `60000/120` 不一致（新装用户会得到过短 TTL）。改为 `surfaceMode: dispatcher / ttlMs: 60000 / maxElements: 120`。
- **`computer_task` 的超时描述与实现不一致**：参数说明写“默认 10”，实际取 `taskTimeoutMin`（默认 5）。描述改为“默认取 taskTimeoutMin，默认 5”。
- **委派白名单漏 `computer_set_value`**：`GUI_ONLY_TOOLS` 仍是 19 项，新增的设值工具不在白名单。补为 20 项（仍排除 `computer_task` 防递归）。**0.2.2 基线后整个 `toolFilter`/白名单已删除**，见下。
- **权限元数据与可选网络不一致**：`package.json` 的 `externalServices: "none"` 与 GLM 兜底的外呼事实冲突；改为条件性说明，并补全 `CUA_SESSION/GLM_API_BASE/GLM_VISION_MODEL` 环境变量。
- **S4 runner 的 CRLF prompt 解析**：Windows checkout 的 `evals/tasks/*.md` 是 CRLF，而 `<<<PROMPT\n` 正则只认 LF，`discoverTasks` 直接报 “no <<<PROMPT block”；读入后统一归一化为 LF。
- **`computer_task` 迁移到 dsh 0.2.2 subagents（P0）**：只使用 `startActivation(spec)` 的**扁平 spec**（`provider/label/prompt/parent/signal/delivery:'caller'/maxDepth/outputSchema/agentOptions`）；0.2.2-rc.2 类型声明写嵌套 `request`，以运行时为准。删除旧 `start(provider, request)` 兼容层、`toolFilter`/`GUI_ONLY_TOOLS` 与 `list()` 硬依赖（provider 用 `getProvider` 探测），不再对旧宿主做适配。真机成功拉起子 agent 并返回结构化结果。
- **0.2.2 默认视觉模型失效（P1）**：`deepseek-v4-flash-vision-exp` 不在 0.2.2 DeepSeek 目录；默认改为 `deepseek-flash`，删除 legacy 模型兼容分支。真机 `mode="vision"` 返回观察者描述。
- **native 附件限额只检查字节数（P1）**：0.2.2 新增 `maxImageDimension`/`maxImagePixels`；`nativeImage:auto` 超限时自动走 compact zoom，而不是被 `saveImage` 拒绝。
- **`toolFilter` 文案与工具描述过度承诺（P2）**：0.2.2 的 `startActivation` 没有 `toolFilter`；README/ARCHITECTURE/MAINTAINING/工具描述统一改为“工具集限制取决于宿主”，回执明确写同级能力。
- **G1：`scroll`/`drag` 忽略 `snapshot_id`**：两个动作现在先 `validateSnapshotId`，不匹配直接 `[snapshot_mismatch]`，不会在错误证据基线上执行；`action-bounds` G1 覆盖。
- **G5：`screen_zoom` 的坐标字段误导**：`coordinateSpace` 从 `screen-physical-px` 改为 `window-screenshot-px`（点击输入空间）；`screenOrigin` 继续作为屏幕绝对坐标的换算基准。

### Changed

- **dsh 兼容基线提升到 `>=0.2.2-rc.1 <0.3.0`**：以 0.2.2-rc.1 为唯一支持基线；peer 依赖同步提升（dsh-tools `>=0.2.2-rc.1`、schemastery `>=3.19.0`），不再维护 0.1.5 兼容层。
- **文档体系重写（2026-11-10）**：README 重排为“产品入口 + 工具参考 + 边界”；新增 `docs/WINDOWS.md`（Windows 工程与冒烟矩阵）、`docs/TESTING.md`（测试分层）；重写 `docs/ARCHITECTURE.md`（模块/流水线/不变量/扩展/已知缺口）、`VERIFICATION.md`（当前矩阵 + 历史证据）、`PERMISSIONS.md`（条件性网络与全部环境变量）、`ROADMAP.md`、`PUBLISH.md`、`docs/store-evidence.md`；`HANDOFF-2026-09-16.md` 并入 `MAINTAINING.md` 后移除。修正 macOS/Linux 过度声明、危险词审批旧验收、像素点击“零标定命中”等与实现不一致的表述。
- **dsh 0.2.2 兼容性升级（2026-11-12）**：`docs/COMPATIBILITY-0.2.2.md` 记录契约矩阵与真机证据；P0/P1/P2 已实施（subagents `startActivation`、vision 默认 `deepseek-flash`、附件 dimension/pixels、PTC `run_code` + native/`computer_task` 验证、toolFilter 文案移除、兼容基线 `>=0.2.2-rc.1 <0.3.0`）。核心观察/动作/native/dispatcher 已真机兼容（7/8 smoke、16/16 runtime）。
- **S4 Web runner 退役（2026-11-14）**：`evals/run.mjs` 的 UI 选择器基于 dsh 0.1.5，0.2.2 下会创建空会话并误读步数。现在默认拒绝运行并指向 `headless-run.mjs`；`--allow-legacy-web` 仅旧 UI 调试，`--dry-setup` 保留。
- **`wa2` 归因收敛（2026-11-14）**：8min fail / 10min pass（72 次工具调用），属时间预算/步速敏感；错误集中在旧 `snapshot_id`、Explorer 前台确认、`computer_menu` 非 JSON path。`computer_menu` 描述补充 path 必须为 JSON 字符串的示例；10min 作为 S4 基线。

### Measured

- **dsh 0.2.2-rc.1 headless 真机加载（2026-11-12）**：隔离 patch 启用 `credentials` + 本插件，默认 DeepSeek 通道，1 轮 5 步完成 `computer_do(status)` / `screen_observe()` / `computer_do(catalog)` / 隐藏 `computer_wait` 路由；`status` 返回 2 可见/20 隐藏，`screen_observe` 读到真实窗口 4 个元素；每步 `cacheReadTokens` 6528→7296。证据见 `VERIFICATION.md` §2.1。
- **S4 oracle 双向验证（2026-11-12）**：10 条任务（含 `x1` 委派通道）全部 PASS（setup ok → 空跑 fail → simulate pass ×2 → cleanup ok）。首次 0/10 是 `TEMP=C:\Windows\TEMP` 导致 PowerShell `Add-Type` 找不到临时 `.cs`；设置 `TEMP/TMP=%LOCALAPPDATA%\Temp` 后 10/10。证据见 `VERIFICATION.md` §2.1.1。
- **headless S4 smoke（2026-11-12，两轮）**：Round 1（8min）`3/4`（`t01/t04/t07` pass、`wa2` fail）；Round 2（10min，`evals/headless-run.mjs`）**4/4**；两轮合计 **7/8（87.5%）**。`wa2` 对时间预算敏感（8min fail → 10min pass，72 次工具调用）。Round 2 工具级 141 次调用 / 19 次错误（13.5%）/ 41 次 unverified（29.1%）。Web runner 的 `0/4` 是 dsh 0.2.2 UI 兼容问题（空会话/步数误读），不是插件错误率。证据见 `VERIFICATION.md` §2.1.2。
- **真实渠道 cache A/B（2026-11-09，opencode / deepseek-v4.1-flash）**：`dispatcher` 稳定 tools 重复命中 99.5%，首次 tool_call 后 92.1%，第二次后 85.4%；`lazy search` 首次新增工具 0–17.7%（+1 为 0%，+4 为 17.7%），每次新增工具集合都重新 full miss；旧 `dynamic` 的 tools 变化同理。结论：要保 cache，tools 列表必须稳定；dispatcher 已成为默认。

## 0.5.6 (2026-09-17)

### Fixed

- **委派的能力降级阶梯（0.5.5 引入的安全相关回归）**：`toolFilter` 在宿主内部是 scoped `tools.restrict()`，其名字校验**只认全局层**；0.5.5 的动态工具面把 19 个工具注册进会话作用域后，`toolFilter` 必然被拒（`tools.restrict() names unknown global tools`）→ 子 agent 不受限（实测它跑了 bash）。旧实现一次丢掉 toolFilter+outputSchema 并只说"已降级"，既不安全也误导（结构化结果其实还能用）。改为**三级阶梯**：全量 → 只丢 toolFilter（保住结构化输出与深度限制）→ 再丢 outputSchema → 全失败则明确报错；每级把**拒绝原因与权限后果**写进回执（"子 agent 拥有与父会话同级的能力"）。README 新增"委派的能力边界"一节，去掉"只能用桌面工具"这一在本机部署上不成立的声明。

## 0.5.5 (2026-09-17)

**动态工具面**（PLAN-meta-tool，拍板 2026-09-17）：诉求不是省 token，而是**避免 20 个工具的 schema 常驻造成的注意力负担**。

### Added

- **两态工具面**：折叠态（默认）只暴露 `computer_do` + 精简版 `screen_observe`；`computer_do({action:'enter'})` 后把另外 19 个工具**注册进该会话自己的 agent 作用域**，`exit` 或"连续 2 次非桌面工具调用"自动收起。工具面重量 **18846 → 3532 字符（−81%）**；展开态的 19 个工具与 v0.5.4 完全一致（细粒度 schema、宿主严格输出校验、未知参数拒发、工具级 guard 全部保留）。机制依据与真机取证见 PLAN-meta-tool §6.2：注册表**按请求**投影，所以展开/回落都在下一请求生效（探针逐步实测：折叠→不可调用、enter→下一请求可调用、exit→unknown tool）。
- `lib/surface.js`（两态状态机 + 作用域注册/dispose + 幂等 + 清单常量）、`tests/surface.mjs`（23 断言：折叠/展开/回落/幂等/作用域隔离/能力兜底/自动回落/清单一致性/注意力预算/锁存/事件接线）。
- `screen_observe` 描述精简化（534→322 字符，参数说明 510→405）：折叠态常驻工具必须轻；**输出 schema 不动**（宿主严格校验要求实现返回的字段都已声明，砍 schema 就得砍返回值）。

### Fixed

- **注册时丢失 schema 投影（加载失败级回归）**：P1-7 结构重构把 `defineTool()` 的返回值丢了，注册的是未投影的原始字面量 → dsh 0.1.5-rc.2 的 `assertSupportedJsonSchema` 拒绝（属性级 `required:true` 不在强制子集里）→ **整棵插件树加载失败**。离线假注册表不做该校验，171 断言全绿也漏掉了；真机探针一次命中。已修，并记入 HANDOFF 硬知识。
- **误订阅 waterfall 事件导致所有工具调用失败**：非桌面活动兜底最初挂 `tools/post-execute`（cordis waterfall，末位参数是 `next`），监听器不调 `next` 返回 undefined → 注册表读 `decision.kind` 崩溃 → 每次调用都报 `Cannot read properties of undefined (reading 'kind')`（探针 6/6 步同一报错）。改用仅观测事件 `tools/result`，并在测试里禁止再订阅 waterfall 事件。

## 0.5.4 (2026-09-17)

**主题**：dsh 0.1.5 大版本适配、点击坐标契约根治（所见即所点）、观察降噪与上下文预算 A–F、S4 评测回归系统、测试与代码结构治理。

### Added

- **observe 降噪**（工作区 PLAN-observe-noise，拍板 2026-09-16）：同一窗口 + 同一模式，且**上次观察后无任何动作**（快照未被消费）时，重复观察回极简回执——`observeDedup: summary`（默认，含"编号:角色"摘要）/ `brief`（单行）/ `off`（每次全量）；新增 `screen_observe(force=true)` 强制全量。判定用严格哈希并忽略时间/行列类噪声（实测：真实 35 元素记事本树 1586→250 字符，**降幅 84%**；brief 单行 95%）。注意本项省的是**上下文 token**，不减少工具调用步数（步速另由提示层"同一快照内无需重复观察"引导）。`maxElements` 默认 500→120（实测常见任务 30-70 个元素）。新增专项测试 `tests/observe.dedup.mjs`（13 断言：AC1 降幅 / AC2 变化必全量 / AC3 force / AC4 动作后必全量 / AC5 off 与 brief / D2 时间噪声）。

- **上下文预算 A–F**（工作区 PLAN-context-budget，拍板 2026-09-16）：A 观察/缩放描述写入成本阶梯（ax < zoom ~200 tok < native ~3K tok）与用途对应；B schema 瘦身 **10176→9486 字符**；C 新增紧凑动作回执 + `verboseReceipts`（正常路径 click 299→~90 字符，不可验证路径仍附明细）；D 树标签 100→48 字符 + 多行折首行；E `app_list` 紧凑化 491→418 字符；F **新增第 20 个工具 `computer_task`**——把一段桌面操作委派给一次性子 agent（`ctx.subagents` + `toolFilter` 限定 19 个桌面工具 + `outputSchema` 强制 {ok,summary,evidence} + `maxDepth=1` + 超时），主上下文只吃一条 ≤400 字符回执，宿主无该能力时回委派配方。新增 `tests/task.tool.mjs`（14 断言）并入 npm test（全库 101 断言）

- **坐标换算基准元数据**：observe/zoom 输出 `screenOrigin`（= `list_windows` 的 bounds；实测截图与该 bounds 逐像素相同）+ `coordinateSpace`，使"图内像素 × crop.scale + crop 原点 + screenOrigin = 屏幕物理像素"可算（zoom 实测为恒定 1.2× 上采样，裁剪宽 ≤500px）。
- **未知参数拒发**：宿主参数表编译后不含 additionalProperties，参数名写错会被静默忽略并可能回退"z 序最前窗口"（实测踩坑：给 screen_observe 传 `app=` 观察到了别的应用）→ `wrap()` 单点拒绝并列明可接受参数；observe 未指定 window 时结果显式注明"已取最前窗口"。
- **测试面**：`tests/schema.conformance.mjs`（把实现可能返回的每种形态——正常/守卫拒绝/观测降级/驱动错误——对着声明 schema 严格校验；本版收尾时覆盖 20 个工具 / 42 个场景）、`tests/live-action.e2e.mjs`（真桌面动作闭环 + 稳定性循环）、`tests/syntax.check.mjs`（修 `npm run check` 的 Windows glob 失效）。
- **S4 评测回归系统**（仓库 `evals/`）：9 条任务（冒烟 4 + 核心 5）、PS oracle 四件套（setup/oracle/cleanup/simulate）、AC2 双向独立验证、零依赖 CDP runner（`--tier/--max-steps/--pin-model/--pin-effort`）、maintain/stop-stale/hygiene 运维脚本；坐标标定与键盘通道诊断脚本一并入库。

### Fixed

- **结构化拒绝被当成功上报（同类缺陷第三、四处）**：`scroll`/`drag` 此前未识别驱动的 `{refusal:{code}}` 回执，把拒绝当成功上报——与 menu 同一坑。新增 `lib/receipt.js` 把"判拒绝 → 标快照消费 → 出回执"收成唯一出口，新增工具只要走它就不会再漏（`tests/schema.conformance.mjs` 的拒绝形态场景矩阵即是该类的回归网）。
- **坐标契约不一致导致点击整体偏移（根因修复）**：可控探针逐点标定（最小二乘残差 ≤0.55px）测出 `computer_click(x,y)` 的空间是**窗口矩形相对物理像素**（= 窗口截图空间），而 `screen_observe` 元素坐标是**屏幕物理像素**——两者差一个窗口原点向量（本机可达 1906×1166），模型"看到坐标直接点"必然打偏。观察输出已换算到点击空间（截图/元素/点击三者统一），文案与 `coordinateSpace` 同步更正；密码扫描/标记仍用原始屏幕坐标。
- **dsh 0.1.5 严格输出校验下观察工具整次失败**：观测降级回执（`window/elementCount/mode/elements/visualOnly/driverAccess`）未在 output schema 声明 → `screen_zoom`/`screen_observe` 的降级路径报 invalid output（工具等于不可用）。抽出 `DESKTOP_FALLBACK_FIELDS` 供两者共用。
- **驱动结构化拒绝被当成功上报**：`{"refusal":{code,message}}` 回执此前未识别 → `computer_menu` 对 `menu_path_unavailable` 仍回"已调用菜单路径"，模型据此继续下一步。抽出 `lib/engine.js` 统一识别四种拒绝形态（refusal/effect/error/code）。
- **zoom 的脆弱点与比例错误**：zoom 曾为取窗口尺寸做带 UIA 扫描的 `get_window_state`（WinUI 应用 4s 超时会把整次 zoom 拖进桌面降级）→ 改用 `list_windows` 的 bounds（实测其与截图逐像素相同）；scale 曾用 attachments 归一化后的尺寸（会算出错误比例）→ 改用驱动返回的图尺寸，并输出非等比缩放提示。
- **hotkey 的 UIA 加速器超时**不再抛原始引擎错误，改为可执行指引（改用控件点击/稍后重试）——上游 [trycua/cua#3908](https://github.com/trycua/cua/issues/3908)。
- verify-runtime 三处测试脆弱点：Windows 动态 import 需 `file://` URL、驱动自身窗口排除用了不存在的进程名（实际是 `cua-driver.exe`）、工具数断言写死 12-13（现改为下限 + 关键工具在册）。

### Changed（结构治理 P0/P1，2026-09-17）

代码屎山审计后的落地，全部以机械证据收口（parity 逐字节比对或测试断言），不含行为猜测。

- **测试脚手架去重（P0-1）**：新增 `tests/lib/harness.mjs`（临时工作副本 / 可编程驱动桩 / 假 ctx·exec / 与 dsh 严格语义对齐的 schema 校验器 / 断言记录器），`schema.conformance`、`observe.dedup`、`task.tool` 三套测试改为引用，删掉各自复制的 ~90 行脚手架。
- **schema 覆盖 13/20 → 20/20 工具（P0-3）**：22 → 42 场景，补齐 `computer_double_click`/`right_click`/`wait_for`/`hover`/`stop`/`resume`/`computer_task`（后者含结构化成功 / 无结构化 / 宿主无服务三形态），并按驱动真实形态补全"结构化拒绝"（`{refusal:{code}}`）场景矩阵——该矩阵直接暴露并修掉了 Fixed 节里那条 scroll/drag 缺陷。
- **配置接线测试（P0-2）**：新增 `tests/config.plumbing.mjs`——schema 键 ↔ `apply()` 组装的 cfg ↔ 实际读取点三向比对（含 `extremePatterns→extremeRes` 重命名白名单），外加 11 组行为哨兵（maxElements/observeDedup/verboseReceipts/supersession/ttlMs/deliveryMode/allowedApps/extremePatterns/cursorTheme/maxTaskCalls/visionProvider+nativeImage）；观测成本过高的 `passwordScan`/`taskTimeoutMin` 显式登记为静态兜底，不假装测过。
- **删死代码（P0-4）**：`dedupInvalidate`（降噪失效已由"快照消费"闸门覆盖）、`taskCallCount`、`runAction`（被 humanAction 取代后无人调用）。
- **拆超大函数（P1-5）**：`screenObserve`（194 行）→ 目标选择 / 抓树（含补抓与桌面降级短路）/ 结构性密码标记 / 元素映射 / 文本渲染 / 结果封装六个阶段函数；`screenZoom`（106 行）→ 目标解析 / 裁剪钳制 / 整窗回退。单函数 ≤66 行。**29 场景受控桩 parity 逐字节一致**。
- **回执统一（P1-6）**：新增 `lib/receipt.js`（`receipt` / `refusalReceipt` / `settleAction`），点击/双击/右键/输入/按键/滚动/拖拽/菜单全部走同一出口——`scroll`/`drag` 从 JSON 内联改为紧凑回执（与 click 同形），"引擎拒绝"判断从 6 处收敛到 1 处（该类缺陷已在 menu/scroll/drag 三处实际发生过）。
- **注册结构数据化（P1-7）**：四组工具改为返回定义数组的纯数据函数，注册与参数名登记收敛到 `apply()` 单处循环。**20 个工具的工具面 JSON 快照（描述/参数表/输出 schema/render/execute arity）逐字节一致**。如实说明：工具描述与 schema 是内容而非样板，`index.js` 体积基本未变（726→738 行），本项收益是"新增工具 = 加一项数据" + 工具面可机械校验。
- **测试量**：`npm test` 148 断言（原 103）；真桌面闭环 `tests/live-action.e2e.mjs` 3 轮 30/30。


## 0.5.3 (2026-09-06)

**结构性密码检测（Windows）**——PLAN-credential-guard 第二期：凭据硬保护从启发式升级为读取系统真实属性（结构位），补齐"无标签 + 空值"密码框盲区。探针实证关键前提：经典 Win32 `ES_PASSWORD` 样式位在两种 UIA 客户端均映射 `IsPassword=false`，样式位才是系统真值（已作为 follow-up 反馈上游 [#3576](https://github.com/trycua/cua/issues/3576#issuecomment-5554919425)）。

### Added

- **快照新鲜度语义**（PLAN-snapshot-freshness Phase A；REVERSE 逆向三点合流）：失效原因三分类 `[snapshot_expired]`（带快照 id）/`[snapshot_mismatch]`/`[snapshot_consumed]`；`supersession` 配置 off/note/enforce（默认 note：同快照连击附一致性注记不阻断）；动作工具新增可选 `snapshot_id` 显式证据基线参数（7 个 mutate 工具 + observe 输出 schema 增 snapshotId）；unverifiable 动作触发状态可疑注记（干预 P0 降级版，只注记不阻断）。上游需求已提：trycua/cua #3586（树版本+条件请求）、#3587（干预信号）。
- **S3a 视觉断言协议**（PLAN-s3-model-verifier）：A5 实证（可读 PNG 证据上 dsv4fv 数字转述噪声≈0、zoom JPEG 对小字号不可读、模型证据不足时 2/2 诚实拒答、同会话历史回声风险）落为工具描述协议——数字断言逐字双向校验不做编辑距离放宽、文字模糊子串+同义对照、只认本轮新鲜证据、不可读=unknown 不得编造；注入 `screen_observe`/`screen_zoom`/`computer_verify` 描述。零新工具零新权限；S3b（screen_assert 工具/独立观察者裁决）待观察者条件成熟。
- **UIA sidecar**（`tools/uia-password-scan.ps1` + `lib/passwordScan.js`）：`screen_observe` 时遍历目标窗口元素，密码 = `IsPassword`（现代框架 provider）∨ `ES_PASSWORD` 样式位（经典 Win32，`NativeWindowHandle` + `GetWindowLongW` 实测）→ 标记快照 entry → guard **结构位优先**硬拒。失败/超时（3s）自动降级启发式并在结果注记；误差方向安全（坐标错配只会漏标不会误标）。
- `tools/password-probe.ps1` 自包含探针（A6）：WinForms 密码框 + UIA 自扫 + Win32 样式真值三重交叉验证；出货版 sidecar 已对活体探针窗口端到端命中（无标签空值密码框，count=1）。

### Changed

- Config 新增 `passwordScan: 'auto' | 'off'`（默认 auto；off = 零 spawn，凭据保护退回启发式）。权限面新增 powershell 固定 argv spawn（随包脚本、只读、无网络），PERMISSIONS/summary/命令清单如实更新；承诺矩阵 Windows 凭据行升级为「结构位」。

### Fixed

- **结构密码标记坐标系错误**（A6 运行时端到端发现，2026-09-06）：`markElementsFromScan` 按"元素中心=窗口本地 + 原点换算"旧假设设计，而 cua-driver 0.23.2 的 frame 与 sidecar rect 同为**屏幕锚定物理像素**（同一密码框两套独立系统读数逐像素相等，探针 E2E 实证）——原点换算使标记整体偏移一个窗口原点向量，实测**标错相邻元素**（真密码框漏标 → guard 放行；上方普通框误标 → 误拒）。改为屏幕坐标直配，废弃双原点候选。sidecar 由 node 派生继承 DPI 感知返回物理 px（bash 直跑探针得逻辑 px，仅影响独立实验，部署路径一致）。E2E 9/9：注记/guard 硬拒/零误拒/sidecar 时延 1.4-1.6s/crop 元数据全通过。

## 0.5.2 (2026-09-06)

**Windows 凭据硬保护静默失效根治**（规格 PLAN-credential-guard；发现于 dsv4fv 定位实验真值交叉检查）。

### Fixed

- **凭据硬保护在 Windows 上静默失效**：cua-driver 元素投影按平台原生命名 role（Windows = UIA 原生 `Edit/Button/…`，无 AX 前缀）且无密码标志位，guard 匹配 macOS AX 命名（`AXSecureTextField`）在 Windows 上永假——密码框检测整体失效且无任何注记。
- 新增 `lib/roles.js` 跨平台角色语义层（单一出口）：密码**三态判定** `isPasswordCandidate`（结构化 AX 角色 ∪ Windows 启发式：文本输入类角色 × 密码词/掩码值，'显示密码'按钮等非输入类仅注记不硬拒）、`isActionableRole` 跨平台集合（**Windows 纯图标无标签按钮恢复编号**；AXSecureTextField 原遗漏补齐）。

### Changed

- 快照 entry 增加 `value` 字段（掩码判定数据源；`label` 不再合并 value）；`ROLE_SHORT` 补 Windows UIA 中文映射（Button→按钮 等）。

### Security

- PERMISSIONS.md 新增**「承诺验证矩阵」**（承诺 × 平台 × 验证载体 × 状态）——安全承诺自此按平台实测，杜绝"代码看起来对"式声明。
- 上游契约缺口已提回：[trycua/cua#3576](https://github.com/trycua/cua/issues/3576)（请求元素投影增加 `is_password`）；补齐前 Windows 保护以启发式运行，误报面与语义见 PLAN-credential-guard §5/§6。

## 0.5.1 (2026-09-06)

结构与复杂度优化（纯结构重构，**零行为变化**——19 工具注册面经 parity 脚本逐字段验证一致）。

### Changed

- **index.js `apply()` 384 → 44 行**：19 个工具注册拆为模块级三组工厂 `registerObserveTools` / `registerActionTools` / `registerOpsTools`（apply 只剩配置装配 + 会话初始化 + wrap + 三次调用）。
- **observe.js `screenObserve` 188 → 117 行**：抽出 `missingTreeFallback`（补抓判定）、`cacheSnapshot`（快照缓存）、`resolveObserveMode`（native/vision/ax 模式决策与降级链）三个纯函数。
- **图片持久化收敛**：新增 `lib/attach.js saveImageAttachment` 统一出口，5 处 `attachments.saveImage` + 输出块装配调用点归一（尺寸回退语义逐点保留）。

### Security

- **权限面修正**：`vision.js loadKey` 移除家目录密钥文件扫描（`~/.zhipu-key` 等，上游继承的死代码），仅保留 `ZHIPU_API_KEY` / `GLM_API_KEY` 环境变量；PERMISSIONS.md / package.json / docs/store-evidence.md 如实声明（凭据信号从"未命中"改为"轻微命中（可选）"）。

## 0.5.0 (2026-09-06)

工具改进包（规格 PLAN-tools-v0.5，拍板：D1 独立工具 / D2 锁存+resume / D3 hover 入包）。12 → **19 工具**。

### Added

- **`computer_verify`**：确定性验证——driver `verify_state` 包装，1-8 条结构化谓词（element: role/label_contains × exists/enabled/selected/value_equals；window: exists/bounds±tolerance）AND 求值；satisfied / unsatisfied / **unknown**（unknown 永不视为成功，fail-closed）；可选截图证据。
- **`computer_wait_for`**：谓词轮询等待，满足即返回（含等待时长/次数），超时结构化失败（不伪装成功）——替代盲等。
- **`computer_clipboard`**：剪贴板读写；`write` + `ctrl+v` 组成可靠"粘贴流"。
- **`computer_menu`**：菜单路径直调（driver `invoke_menu`，fail-closed，绝不回退像素）。
- **`computer_hover`**（实验性）：移动虚拟光标；`real=true` 移动真实 OS 指针（scope=desktop）。真实 hover 效果取决于应用，未验证。
- **`computer_stop` / `computer_resume`**：强杀开关——stop 结束驱动会话 + 清观察快照 + **锁存全部桌面操作**（观察/动作/应用一律拒绝）；resume 唯一解锁路径并预热会话。S3 的确定性半边就此补齐。

### Security

- 锁存闸门位于守卫之前（锁存优先级最高）；stop/resume 均带审计注记；凭据硬保护与极危注记不受影响。

## 0.4.1 (2026-09-05)

依据 dsv4fv 像素定位实验（SURVEY 附录A：整窗裸定位 median>300px、先验驱动的布局重建、目标主导小裁剪 13-80px）落地 S2 修订。

### Added

- **`screen_zoom` 定位原语**：结果新增结构化 `crop` 元数据（原点 x/y、尺寸 w/h、换算比例 scale），结果文本给出换算公式（图内坐标 × scale + crop.x/y = 整窗截图像素）——支撑树空/像素目标的"裁剪 → 语义确认 → 换算 → 点击"定位环。

### Changed

- `screen_zoom` 工具描述改写为双用法（放大细看 / 定位环），并写明"整窗裸定位不可依赖、裁剪务必让目标占画面主导"的实验结论。

## 0.4.0 (2026-09-05)

**安全立场切换：无感自治**——不追求极致安全；在"后台优先 + 升级链 + 恢复原前台 + 审计注记"底座上做到"易用无感、自动提权、极危敏感警告、仅作基本兜底"（规格见 PLAN-usability-first）。

### Removed

- **危险词审批网关**：`computer_*` 动作不再向用户征询（零打断）；`guard()` 不再依赖 approval 服务，插件 `inject` 移除 `approval`。密码框 `click` 由"审批"改为"放行 + 凭据注记"。
- **`permissionMode` 配置**（三档坍缩）：观测降级链（桌面级采集兜底 / `visualOnly` 标注 / `driverAccess` 权限面探测）**常开**，不再受模式开关控制。

### Changed

- **默认值翻转**：`deliveryMode` 默认 `auto`（原 `background`——后台不可用自动升级并恢复原前台）；快照 `ttlMs` 默认 `60000`（原 `30000`）。
- 极危注记层扩展位落为配置 `extremePatterns`（正则源数组，默认空 = 零差异），命中元素标签时在结果附加警告注记、不阻断。

### Security

- 凭据硬保护不变且为唯一硬拒绝：密码框（AXSecureTextField 等）`computer_type` 依旧直接拒绝自动输入。
- 兜底护栏不变：`allowedApps` 区域白名单、快照 TTL、无快照拒绝、engineRefusal 拦截、三级链恢复原前台、全量投递注记（归因审计）。

## 0.3.0 (2026-09-05)

基于上游 `07477f4` 的维护分支（Windows 深度实测）。

### Fixed

- `get_window_state`：AX 模式非降级路径返回 `image: null` 时触发宿主 schema 校验失败（`"value.image" must be an object`）——`image` 字段现仅在 native 模式输出。
- `resolveBin`：新增 cua-driver 官方安装器默认位置 `~/.cua-driver/packages/current/` 探测（此前无 PATH 环境直接 ENOENT）。
- `computer_type` / `computer_key`：引擎拒绝结构不再伪装成功（`ok: false` + 拒绝原因）。
- `diff`/观测类示例脚本：`New-Object System.Drawing.Bitmap($var)` 在 `-File` 模式下产生 String 伪装（假阳性断言）的根因说明与类型断言范例。

### Added

- **组合键 hotkey 通道**：`computer_key` 组合键改走 driver `hotkey`（目标感知派发）——XAML/WinUI/UWP 目标自动匹配 UIA `AcceleratorKey`（无焦点窃取、无需系统输入队列）；无修饰键维持 `press_key`（PostMessage 后台）。
- **`permissionMode`**（默认 `standard`）：`full-access` 观测失败自动降级桌面级采集（视觉仅读）+ AX 空树 `visualOnly` 标注 + `driverAccess` 驱动权限面探测；`unrestricted` 额外放行危险词审批（密码框保护与白名单不受影响）。
- **`deliveryMode`**（默认 `background`）：三级投递升级链——background → foreground（驱动自带激活+恢复）→ `bring_to_front`（AttachThreadInput 绕 Windows 前台锁）→ 重试 → 恢复原前台；工具级 `foreground: true` 单次覆盖。
- **`unverifiable` 回执注记**：引擎仅返回投递回执时显式标注「未验证目标响应」，不再伪装成功。

### Security

- 密码框保护、`allowedApps` 区域白名单、快照 TTL、无快照拒绝等护栏在所有模式下保持不变（`unrestricted` 仅放行危险词审批一项）。
