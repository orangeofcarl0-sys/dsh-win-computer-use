# CU RESEARCH — 社区成熟 Computer-Use 项目的复杂任务处理模型

> 调研日期：2026-11-16/17。范围：Codex、Claude Code、ZCode、Trae，以及 UI-TARS、Agent-S、OpenHands、Browser Use、Cua 等社区项目。
>
> 方法：官方文档/仓库/论文优先，其次官方博客、GitHub issue/PR、可核验的工程文章。凡官方未披露或只有间接证据的结论，均在正文标注“推断/不确定”。ZCode CU 的部分是本地 skill 文档 + 本机真机能力探针，不是纯资料调研。
>
> 相关：[TRAJECTORY-ANALYSIS](TRAJECTORY-ANALYSIS.md)（t11/t12/t15 轨迹与模型行为）、[WINDOWS](WINDOWS.md)（本插件 Windows 工程细节）、[TESTING](TESTING.md)（测试体系）。

## 1. 结论先行

1. **没有一家成熟项目用“全屏截图 + 单次坐标点击”解决复杂桌面任务。** 能稳定处理 Paint/PowerPoint/Explorer 这类混合任务的路线都是：
   - 结构化观察（UIA/AX/DOM）优先；
   - 元素级动作优先；
   - 坐标/像素只作画布、自绘控件、Electron 内容的兜底；
   - 明确的焦点/窗口模型；
   - 动作回执 + 可执行验证，而不是模型自述“完成”。
2. **Codex 的默认路线是“用代码/原生工具绕开 GUI”。** Codex CLI/Cloud 没有桌面 GUI；Codex App/ChatGPT 桌面端有 Computer Use，但 Windows 只能前台，复杂 GUI（幻灯片/日历）和文本编辑是官方承认的弱项；文档任务直接调用 LibreOffice/Poppler/Python 等 headless 工具。
3. **Claude Code 把 GUI 定位为最后手段。** 原生工具是 shell/文件/搜索；GUI 来自内置 `computer-use` MCP（research preview）。Computer Use API 的动作空间刻意保持最小（截图、点击、拖拽、down/up、键盘、等待），没有窗口/焦点/文本选择语义；官方要求每步截图验证，因为模型会“假装成功”。
4. **ZCode CU 是目前最接近“通用复杂 GUI 底座”的公开形态**：AX 树 + 截图 + element index；`drag` 支持元素或坐标、`modifiers`；`selectText`、`paste`、`setValue`、`key hold`；`frame_id` 绑定当前截图；`actionSent/retry` 明确失败语义。但它在 **Windows 上没有 bring_to_front/activation API**，画布拖拽仍需要调用方自己解决前台。
5. **Trae 不是通用桌面 CU。** 它的 Browser use 是页面级自动化（内置浏览器或 Chrome 扩展 + trusted domains），SOLO 是 IDE/终端/文件 + plan/subagents；公开资料没有证据表明 Trae 使用 UI-TARS。
6. **UI-TARS/Agent-S2 的 screenshot-only 路线不适合本插件的三类任务**：缺少 modifier、focus、窗口、文本选择；Agent-S2 的验证很弱（Worker 解析失败会退化成 `wait(1.0)`）。Cua 的工程范式最值得抄：UIA + 截图、element_token/capture_id、background-first、`bring_to_front`、`verified` 只认 AX read-back。

## 2. 对比矩阵

| 项目 | 观察 | 寻址 | 动作空间 | 拖拽 | 焦点/多窗口 | 验证 |
|---|---|---|---|---|---|---|
| Codex CLI/Cloud | 终端/文件/浏览器 | 文件、shell、DOM | shell、apply_patch、browser | 无桌面 | 无 | 测试/构建/PR |
| Codex App / ChatGPT 桌面端 | 截图为主；官方未披露 UIA/AX | 截图坐标 | 指针、点击、输入、键盘、窗口/菜单/剪贴板；CUA API 另有 drag/scroll | App 文档未列 drag；CUA API 有 | **Windows 只能前台**；目标必须在活动桌面可见 | 截图 + 保存结果检查 |
| Claude Code | 原生 shell/文件；GUI 走 `computer-use` MCP | 全显示截图坐标 | 17 个 CU 动作（screenshot/zoom/click/drag/down/up/move/scroll/type/key/hold/wait） | 有 `left_click_drag`、down/up、modifier | **无窗口/focus API**；event 路径要求前台 | 官方要求每步截图 + 一句话判断 |
| ZCode CU | AX 树 + 截图 + `elements()` | element index / frame 坐标 | click/drag/type/setValue/selectText/paste/key/performSecondaryAction | **元素或坐标 + modifiers** | 元素动作可后台；**Windows 无 activation API** | frame_id、settle、diff、effect evidence、actionSent/retry |
| Trae | IDE/终端/文件 + 浏览器页面 | 页面元素、tab | 页面点击/填表/切页、文件/终端、MCP | 未公开桌面 drag | 浏览器 tab；无 OS 窗口 | 构建、Diff、Auto Screenshot |
| UI-TARS | 截图 | 归一化坐标（1000） | click/double/right/drag/hotkey/type/scroll/wait/finished | 起止点；无 steps/modifier | 单显示器；无 focus 原语 | 模型 `finished` |
| Agent-S2 | 截图 | 坐标 + 描述 | click/type/scroll/hotkey/hold/drag/switch/wait/done/fail | 元素→元素 + hold_keys | `switch_applications`；单显示器 | Manager 重规划；无独立 verifier |
| Cua/cua-driver | UIA 树 + 截图 | element_token + capture_id + 坐标 | 强类型鼠标键盘 + browser refs | duration/steps/modifier/button/from_zoom | `pid+window_id`、`list_windows`/`bring_to_front` | `verified` 仅 AX read-back |

## 3. Codex：终端优先，GUI 只在一个产品面存在

### 3.1 产品面

- **Codex CLI**：本地终端编码代理，核心工具是 shell/exec、`apply_patch`、`view_image`、plan、MCP、subagents、web search。官方明确 Browser 不在 CLI/IDE 扩展中；代码级工具处理器里没有 computer/screenshot。
- **Codex Cloud**：云端隔离容器，读改文件、跑测试、提交 PR，可选 in-task 浏览器；没有桌面 GUI。
- **Codex App / ChatGPT 桌面端**：唯一有原生 Computer Use 的 Codex 面，支持 macOS/Windows；Windows 上只能前台运行，目标应用必须留在活动桌面可见，不能在同一 Windows 会话后台操作。
- **Operator / CUA API**：独立产品线。CUA API 的动作包括 click/double_click/drag/move/scroll/keypress/type/wait/screenshot；`computer_call` 携带有序 actions，执行后截新图；坐标用截图坐标，缩放后要映射回环境坐标。

### 3.2 复杂任务策略

- OpenAI 官方承认 CUA “不擅长陌生 UI”“文本编辑不精确”；Operator 把“做幻灯片、管理日历”列为困难场景；ChatGPT agent 的幻灯片仍是 beta，查看器与导出的 PowerPoint 可能不一致。
- Codex 桌面端缓存约 1.7 GB 运行时（Python、Node、Poppler、git、LibreOffice），documents 技能直接调用这些二进制处理 Word/PPT/Excel，而不是驱动 Office 界面。这说明其策略是 **API/脚本优先，GUI 兜底**。
- 拖拽在 Codex App 文档中没有逐项列出；CUA API 明确有 drag，因此“技术上可用”是合理推断，但“App 行为稳定”没有官方确认。
- 社区 Windows MCP/第三方克隆普遍采用截图 + UIA/AX 混合；官方 Codex 是否使用 UIA/AX 未披露。

### 3.3 对本插件的含义

- 不要把“万能点击”当默认；能走 UIA/COM/Open XML/文件 API 的任务优先走结构化路径。
- 对 Paint/PowerPoint/Explorer，GUI 只应处理 UI-only 的部分；最终验证必须是文件/像素 oracle。
- Windows 前台串行是现实约束；多窗口任务要显式“切换→确认前台→操作→验证”。

## 4. Claude Code：GUI 是最后手段

### 4.1 工具面

- Claude Code 原生工具是 Bash/PowerShell、Read/Edit/Write、Glob/Grep、WebFetch/WebSearch、LSP、Agent/Skill/Task 等；没有截屏/鼠标原生工具。
- GUI 来自内置 MCP server `computer-use`：CLI 仅 macOS；Desktop 支持 macOS/Windows；需要 Pro/Max/Ultra，且必须交互式会话。
- 官方工具选择阶梯：Connector/MCP → Bash/PowerShell → Claude in Chrome → Computer Use。原话是 “Computer use is the broadest and slowest”“Screen control is reserved for things nothing else can reach”。

### 4.2 Computer Use 动作空间

最新 `computer_toolset_20260801` 有 17 个成员工具：`screenshot`、`zoom`、`left_click`、`right_click`、`middle_click`、`double_click`、`triple_click`、`left_click_drag`、`mouse_move`、`left_mouse_down`、`left_mouse_up`、`cursor_position`、`scroll`、`type`、`key`、`hold_key`、`wait`。

关键点：

- 鼠标动作有 `text` 修饰键（shift/ctrl/alt/super），只在本次动作期间按住；`hold_key` 是持续按住。
- `left_click_drag` 只有起点/终点，没有 steps/duration；复杂拖拽要用 `left_mouse_down` → `mouse_move` → `left_mouse_up`。
- **没有窗口管理、focus/activate、resize/close、多显示器参数、文本选择动作、UIA/DOM**。`type` 只输入到当前键盘焦点。
- 截图是**全显示**，坐标是宿主返回的截图像素空间；缩放/Retina 由宿主换算。新版 toolset 没有 `display_number`；多显示器由宿主自行定义“full display”是哪块。

### 4.3 验证与限制

- 官方明确：“Claude sometimes acts as if its actions succeeded without explicitly checking their results.” 标准提示词要求每步截图、用一句话描述、判断成功，失败重试。
- 批处理必须串行执行、首败即停，后续返回固定 halt 文本；建议每个 batch 以截图结束。
- 官方限制：延迟、坐标幻觉、点击偏移、滚动不可靠、电子表格多选困难、下拉框/滚动条难操作、小众应用/多应用并行可靠性低。
- Claude for Excel 走结构化单元格/公式集成，而不是屏幕点击；这与其“Office 结构化优先”的立场一致。

### 4.4 对本插件的含义

- 我们的 `computer_verify`/`wait_for`/快照门禁与官方“每步验证”方向一致；但应把“动作已发送”与“应用已改变”分开，`unverifiable` 不能算完成。
- 坐标契约必须只有一个权威空间；不要把窗口屏幕 bounds 直接当截图坐标。
- Windows 插件必须自己提供 `window_activate`/`bring_to_front`，不能指望模型用 Alt+Tab。

## 5. ZCode CU：AX-first + 元素级手势

### 5.1 公开 API（本地 0.6.5 skill/docs）

- 绑定 app 后 `getAXState`/`getAXStateAndScreenshot`/`elements()`；元素有 index、role、title、value、actions、bounds。
- `click(target, { mouseButton, clickCount, modifiers, strategy })`；`drag(from: number | Vec2, to: number | Vec2, { modifiers })`；`pressKey(key, { holdSeconds, strategy })`；`selectText(elementIndex, text, { prefix, suffix, selectionType })`；`paste`；`setValue`；`performSecondaryAction`。
- 坐标动作必须绑定当前 raster/frame：`frame_id`；没有 actionable frame 时直接拒绝。element bounds 是屏幕全局点，不能直接当坐标。
- 错误有 `code`、`actionSent`、`retry`；`actionSent=true` 的非幂等动作不能盲目重放；`CONTROLLER_BUSY` 不可重试。
- `strategy: auto | a11y | event`：`event` 发送全局输入并要求目标已在前台，不会主动激活；在 Windows 上没有 `bring_to_front` 工具。

### 5.2 真机能力探针（本机，2026-11-16/17）

- **t15**：Explorer 返回 291 个元素；`click(alpha)` + `click(beta, { modifiers: "ctrl" })` 后状态栏显示“已选择 2 个项目 28 字节”；命令栏剪切→打开 docs→Ctrl+V 成功。说明 **Ctrl+click 批量多选是可实现的**，t15 逐文件循环至少部分是我们的工具缺口。
- **t11**：Paint 返回 221 个元素，包含画布 bounds `[879,600,800,600]`、`矩形/椭圆/直线`、`红色/靛蓝色/黑色`。元素点击可选中工具/颜色；但坐标拖拽：
  - 必须先 `get_app_state({include_screenshot:true})` 取得 actionable frame；
  - 返回 frame 是 **1280×800**（不是 2560×1600），画布映射到约 `[440,300,400,300]`；
  - drag `[480,345] → [580,415]` 被接受，但 Paint 状态无变化，因为它不是前台；ZCode CU 提示改用 element/keyboard，但画布没有 element，键盘也不能画图。
  - 结论：**ZCode CU 在 Windows 上缺少 activation，t11 画布拖拽同样无法稳定完成**。
- **t12**：PowerPoint 返回 353 个元素，形状以 `Image "S4 Bar Q1/Q2/Q3"` 暴露并带 bounds，`形状填充/形状轮廓` SplitButton 可见；按元素名选中形状可行。surface reference 会 retired，需要重新 observe；文本/颜色对话框成本仍在。

### 5.3 对本插件的含义

- **应该抄**：`elements()` 全量数据表、元素级 drag/click modifiers、`selectText`、`frame_id`/current raster、`actionSent/retry`、observe settle。
- **不要照抄**：Windows 无 activation；画布任务仍需插件自己的 `computer_activate` + 前台投递。
- ZCode 的 `drag(from element, to coordinate)` 很适合 PowerPoint 形状和 Explorer 文件；我们的 `computer_drag` 只有坐标，是明显缺口。

## 6. Trae：页面级自动化，不是桌面 CU

- Trae Browser use 官方文档：内置浏览器或 Chrome 扩展，AI 可打开网页、读取内容、点击按钮、切页、填表、检查布局；可配 Trusted Domains；可开 Auto Screenshot；内置 Chat agent 不能控制浏览器。
- SOLO 是 IDE + 浏览器 + 终端 + 文件 + plan/subagents；SOLO Desktop 打开本地文件夹，Mobile 派发任务到 Desktop/Web；没有公开的任意 Windows 应用控制、窗口/焦点 API 或坐标动作。
- 公开资料没有“Trae 使用 UI-TARS”的证据；Trae Agent 是文件/Bash/SWE Agent，不是 GUI Agent。
- 可学的是 plan/todo/subagents/上下文压缩；不可学的是把页面级 DOM 思路当成桌面 CU。

## 7. 社区项目：路线差异

### 7.1 UI-TARS / UI-TARS-desktop

- 纯截图输入；动作极简：click/left_double/right_single/drag/hotkey/type/scroll/wait/finished；坐标文本归一化到 1000。
- drag 只有起止点，无 duration/steps/modifier；无 focus/窗口原语；单显示器；25 步 loop 上限；仓库已归档（2026-11-09）。
- 已知坐标/DPI issue；`finished` 是模型自报，无独立 verifier。
- 适合“看屏幕就能做”的通用演示，不适合 Paint/PPT 这类需要 modifier、焦点、文本选择的复杂任务。

### 7.2 Agent-S / Agent-S2

- Agent-S1 在 Windows 上用 `pywinauto` UIA 树 + pyautogui，是混合观察；Agent-S2 论文强调 screenshot-only + Manager/Worker + Mixture-of-Grounding。
- Manager 做 subgoal/DAG，Worker 生成原子动作；动作含 `click/type/scroll/hotkey/hold_and_press/drag_and_drop/switch_applications/highlight_text_span/set_cell_values/wait/done/fail`。
- drag 是元素→元素 + `hold_keys`，无 steps；验证弱：Worker 异常会退化成 `wait(1.0)`，没有独立 verifier。
- 可学 Manager/Worker + grounding 路由；不可学“异常吞成 wait”。

### 7.3 OpenHands / Browser Use / Open Interpreter

- OpenHands：CodeAct（可执行 Python）+ 浏览器/终端，Action/Observation/Executor 分层、typed event、Condenser；不是桌面 CU。
- Browser Use：0.x 是索引 DOM + 固定动作；1.0 转向 Python REPL + CDP；没有把 drag 做成一等公民；适合浏览器，不适合原生桌面。
- Open Interpreter legacy OS mode 有 mouse.down/up/move、keyboard down/up，但无窗口/焦点/验证；当前主线已转向 Codex 风格 coding agent。

### 7.4 Cua/cua-driver

- 工程上最值得参考：`get_window_state` 同时返回 AX 树 + 截图；`element_token` 绑定 snapshot；`capture_id` 单次使用 + 60s 过期；点击/拖拽支持 `modifier`、`from_zoom`、`steps`、`button`；`bring_to_front`、`set_window_frame`、`invoke_menu` 是一等工具；background 强制第一次尝试，失败才 foreground；`verified` 只认 accessibility read-back。
- 不做 agent loop，任务分解交给 harness；一个 session 共享屏幕/键盘/焦点，不能在同一桌面并行跑多个 GUI 子代理。

## 8. 共同模式与本插件的映射

| 模式 | 成熟项目做法 | 本插件现状 | 建议 |
|---|---|---|---|
| 结构化优先 | AX/UIA/DOM 元素 + 语义动作 | 已有 element token/UIA + click modifier；drag 无 element | 保留 element 优先；后续评估 drag element |
| 像素兜底 | 坐标 + 当前 frame/capture + zoom 映射 | window screenshot 坐标；click/drag 均支持 from_zoom；drag 支持 steps | native freshness probe 已完成；按应用复现再修 |
| 手势 | click/drag 带 modifier、steps、down/up、hold | click modifier 已真机验证；driver drag modifier 在 0.23.2 目标端收不到；有 steps | 第八轮 drag modifier 改为私有 SendInput helper（`tools/private-drag.ps1`）；后续评估 down/up 原语 |
| 焦点 | 显式 activate/bring_to_front；foreground 恢复 | 新增 `computer_activate`；foreground L3 恢复 | 脏桌面先 activate；t11 画布先焦点 click |
| 验证 | 每步 screenshot/回执 + 最终 oracle | 有快照/回执/verify/oracle | 保持；明确 `unverifiable` 不是成功 |
| 长任务 | plan/subgoal/checkpoint；Cua 不做 loop | computer_task + eval runner | 子代理限制权限；每步 checkpoint |
| 应用路由 | 文档/表格走 headless 库 | 当前主要是 GUI | t12 等任务优先 OOXML/宽预算，不写专用 adapter |

## 9. 对本插件的结论

1. **t15 有明确、低风险的插件层解；t11 的 drag modifier 在 driver 0.23.2 没有，但第八轮已私有实现**：driver 0.23.2 的 `click` 已支持 `modifier`，真机探针确认 element/坐标两条路径都能到达目标；`drag` 虽在 schema 接受 `modifier`，但 MouseDown/Move/Up 读到的 `Control.ModifierKeys` 全是 `None`。第八轮改为 `modifier`/`dwell_ms` 走 `tools/private-drag.ps1`（SendInput 原子手势），无 modifier 的 drag 仍走 driver。
2. **t11 不能只靠“更好提示词”**：ZCode CU 的真机探针证明，Windows 上缺少 activation 时，画布坐标 drag 会被应用忽略；必须 `computer_activate` + 画布焦点 click + 精确画布原点/线宽。setup 用 UIA 固定 8px、题面给 `(879,600)` 后 **3/3 pass，70/88/48 步**。
3. **t15 的逐文件循环不是纯模型问题**：没有 Ctrl+click，非连续多选不可用；补 `modifier` 后 **3/3 pass，77/72/59 步**（各 5 次 Ctrl+click）。但文件单选必须 `foreground=true`，否则后台 UIA Invoke 会打开文件。
4. **t12 没有通用 CU 解，但白底 seed + 直接输入可以进预算**：形状选择可以被元素级动作改善（ZCode 能按 `S4 Bar Q1` 选中），但 PowerPoint 文本/颜色/保存仍是应用层成本；白底 seed + 按形状名选择 + 双击柱直接输入 + 每柱保存 + 40 分钟后，**2/2 pass，140/169 步**（此前 25 分钟/190 步仅 red/blue + Q1）。仍不建议写 Office 专用 CU 层。
5. **不要为单个应用写专用 CU 层**：Codex 的 LibreOffice 路线、Claude for Excel 的结构化路线都说明，Office 可靠路径是 API/OOXML，不是屏幕点击。
6. **Excel/PDF 的通用 GUI 路径仍可进任务预算，但靠任务级确定性**：t14 用 `Ctrl+Shift+End` 选 A1:D6 + `Alt+F1`（2/2 pass，141/71 步）；t17 用三击句子 + Ctrl+C、Excel 先 Save As 再粘贴（2/2 pass，89/63 步）。这不是专用 CU 层，而是把“选区/保存”做成可复现的题面纪律。
7. **2026-11-17 第七轮把这里的 P0 建议落地了**：`deliveryFailure` 不再把 `background_delivery_failed` 子串当硬失败；无 Document 的 type 保留快照；组合键自动前台；forced click/scroll/drag 先前置再单次执行。t14 新题面 **3/3 pass，59/41/57 步**，forced pointer 后 **42 步**；t17 **3/3 pass，37/53/48 步**，forced pointer 后 **42 步**；t15 **85/67 步**；t11 **58/94 步**。下一层仍是 `selectText`/key hold/drag element 与 Office 专用能力，不在本轮范围。
8. **2026-11-17 第八轮：drag modifier 改为私有实现**。cua-driver 0.23.2 的 `DragTool::invoke` 声明 modifier 但不读取；上游 PR #5667 / 0.39.0 已用 `modifier_hold_inputs` 修复。本插件不强制升级驱动，而是在 `computer_drag` 的 modifier/dwell 路径走 `tools/private-drag.ps1`：持久 PowerShell + C# P/Invoke，PMv2、virtual desk、4px 阈值、16ms 插值、modifier 持有到 drop、finally 释放、恢复前台；`from_zoom` 明确拒绝。WinForms 探针 **3/3** 在 down/move/up 均读到 `Shift, Control`，drop 后无卡键。Explorer Ctrl+drag 复制、Excel 标签 Ctrl+drag、PPT Shift 约束留作下一轮 drop-target 真机项。

## 10. 参考（主要）

- OpenAI Codex CLI/Cloud/App、Computer Use、CUA API：
  - https://github.com/openai/codex
  - https://learn.chatgpt.com/docs/computer-use
  - https://developers.openai.com/api/docs/guides/tools-computer-use
  - https://openai.com/index/introducing-operator/
- Anthropic Claude Code / Computer Use：
  - https://code.claude.com/docs/en/computer-use
  - https://code.claude.com/docs/en/tools-reference
  - https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
  - https://github.com/anthropics/claude-quickstarts/tree/main/computer-use-demo
- ZCode CU（本地）：
  - `C:\Users\66494\.zcode\cli\plugins\cache\zcode-plugins-official\computer-use\0.6.5\skills\computer-use\SKILL.md`
  - `...\docs\computer-use.md`
- Trae：
  - https://docs.trae.ai/ide/browser-use
  - https://www.trae.ai/blog/product_solo
- UI-TARS / Agent-S / Cua：
  - https://github.com/bytedance/UI-TARS
  - https://arxiv.org/abs/2501.12326
  - https://github.com/simular-ai/Agent-S
  - https://arxiv.org/html/2504.00906
  - https://github.com/trycua/cua
  - https://cua.ai/docs/cua-driver/concepts/how-cua-driver-works.md
- OpenHands / Browser Use：
  - https://github.com/All-Hands-AI/OpenHands
  - https://github.com/browser-use/browser-use
- Windows UIA / SetForegroundWindow：
  - https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/ui-automation-overview
  - https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow

> 证据等级提醒：Codex App 是否使用 UIA/AX、是否稳定支持 drag/scroll，官方未披露；Claude Code 的 `computer-use` MCP 成员 schema 未公开，本文以 CU API 作为能力上界；Trae 的内部 action schema 未公开。ZCode CU 的结论来自本地 skill/docs + 本机探针，不是官方跨平台承诺。
