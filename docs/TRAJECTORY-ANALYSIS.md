# TRAJECTORY-ANALYSIS — 模型行为与失败模式

> 目的：分析 t11/t12/t14/t15/t17 与 2026-11-20 的 t19/t20/p01-p03/t01/t05 上模型“怎么用工具、为什么失败、哪些是插件缺口”；原始逐轮数据见 [EVIDENCE](EVIDENCE.md)。
> 读者：架构/评测/维护者。
> 状态：研究分析（数据截至 2026-11-20；结论随模型/驱动版本变化）。
> 相关：[CU-RESEARCH](CU-RESEARCH.md) · [TESTING](TESTING.md) · [WINDOWS](WINDOWS.md) · [EVIDENCE](EVIDENCE.md)。

## 1. 方法与证据边界

- 对象：dsh 0.2.2-rc.1 + 本插件，Windows 11 x64 / 150% DPI / dirty 桌面；驱动 0.23.2 与 0.52.13；模型 DeepSeek 官方与 opencode-go/deepseek-v4.1-flash。2026-11-20 追加 t19/t20（导航/对话框）、p01-p03（像素）、t01/t05（AC6）。
- 原始 report/trajectory 在 gitignored 的 `evals/headless-runs/`；本文不包含截图、文档正文、模型原始 thinking。
- 运行矩阵、逐轮步数、工具计数、错误分类见 [EVIDENCE](EVIDENCE.md) §2–§5；本文只保留**仍然成立的结论**与**当前建议**。
- 跨 provider 不是受控 A/B：桌面脏状态、采样、驱动 capture 行为都会影响步数；单次 pass 不是稳定承诺。

## 2. t11（Paint 鼠绘）：不是“不会画”，是焦点 + 首次拖拽 + 状态判定

### 2.1 仍然成立的结论

1. **AX 树上下文不稳定**：Paint 调色板/形状控件时有时无；模型必须 force/全量观察或 native 兜底。
2. **第一次 drag 经常只聚焦不画**：这是驱动/窗口焦点行为，不是模型“不会拖”；`computer_activate` + 画布焦点 click 后通常第 1–2 次 foreground drag 才出现形状。
3. **画布原点和线宽是 setup 问题**：UIA 实测最大化 Paint 画布 `(879,600) 800×600` 1:1；失败轮的原点偏 4–7px、线宽 1px。setup 用 AX `大小` 固定三种形状为 8px、题面给精确原点后，3/3 pass（70/88/48 步）。
4. **强制前台 drag 不能失败后重试**：旧 L3 重试把单次拖拽变成约 9s、同一形状画两遍，模型误入“鼠标键/设置”；改为“前置 → 只拖一次 → 恢复”后回归通过。
5. **native 截图“陈旧”未证实为普适 bug**：t11 轨迹里出现 drag 前后同一 PNG hash，但 `probe-native-freshness` 在 WinForms 文本变化窗口未复现；不要据此写普适缓存结论。
6. **保存阶段仍贵**：Save As 对话框的 `Ctrl+A`/输入可能落到主窗口或导航树；模型靠 native 截图和绝对坐标救回。这是应用/焦点成本，不是插件可以完全消除的。

### 2.2 已修复/已接线

- click 家族 `modifier`（Ctrl+click）、drag `from_zoom`/`steps`/`modifier`/`dwell_ms` 已接线。
- 私有 SendInput 拖拽解决 0.23.2 的 drag modifier 不生效；0.39+ 原生可用。
- 观察回执补 native/vision 快照 id 后，t11 的 `snapshot_mismatch` 从 2 次降到 0；最新 70 步 pass。

### 2.3 仍待观察

- t11 方差大（48–94 步）；焦点/重画策略仍由模型决定。
- Paint 笔刷宽度跨启动持久化；setup 已固定，但用户环境不同。
- Explorer/Excel/PPT 的 modifier drop 仍是下一轮真机项。

## 3. t12（PowerPoint 布局）：不是“不会做 PPT”，是每根柱的格式化成本 > 预算

### 3.1 仍然成立的结论

1. **一根柱约 7–8 分钟**：选形状只占小部分，成本在颜色对话框（独立窗口、UIA 字段不可写）、文本编辑入口（双击/F2 不可靠，右键“编辑文字”才成功）、字号/居中/加粗。
2. **模板标题页的视觉噪声**会诱导模型反复确认“这是不是我的幻灯片”；白底 seed 裁掉装饰后显著改善。
3. **直接输入标签比插入文本框便宜**：双击柱直接输入 Q1/Q2/Q3，避免额外的文本框/格式步骤。
4. **保存被排到最后**：题面要求每柱保存，模型仍在 14.9 分钟才第一次保存；绿柱没有时间。白底 seed + 40 分钟预算后 2/2 pass（140/169 步）。
5. **强制前台指针前置单次**避免了重复点击/重复格式；第七轮 152 步 pass，仍在预算内。

### 3.2 已修复/已接线

- `computer_activate`、`set_value`、组合键自动前台、capture-only、`computer_click` modifier 等已接线。
- 观察回执补 id 后，t12 的 `snapshot_mismatch` 从 2 次降到 0；最新 100 步 pass。
- t12 仍有 2 次 TTL、1 次 query 后 `snapshot_missing`（模型未读“旧动作快照已清除”）、前台锁；均为 1 步恢复。

### 3.3 结论

**没有通用 CU 解**：形状选择可以被元素级动作改善，但 PowerPoint 文本/颜色/保存仍是应用层成本；不建议写 Office 专用 CU 层。Office 可靠路径是 OOXML/COM/API；GUI 只处理 UI-only 部分。

## 4. t15（Explorer 整理）：方差来自导航策略，不是任务难度

### 4.1 仍然成立

1. **三种策略步数 89–177**：zoom/坐标映射最贵；AX 索引 + 命令栏 Cut/Paste 最省；逐文件循环可被 Ctrl+click 批量替代。
2. **后台单击文件项会打开文件**：Explorer 文件项的 UIA Invoke 等于默认动作；单选必须 `foreground=true`，多选 Ctrl+click 已自动前台。
3. **`Ctrl+A` 在 inline edit 里可能被当字面 `a`**：F2 后先全选含扩展名，再输入完整文件名；否则 `report-final.txt.txt`。
4. **`computer_activate` 对 F2/前台编辑必要**；激活前 F2 多次无效。
5. **逐文件循环至少部分是工具缺口**：补 `modifier` 后 3/3 pass（77/72/59 步，各 5 次 Ctrl+click）。

### 4.2 仍待观察

- capture-only 复跑 52 步 fail 是模型未用 Ctrl+click、zoom 过宽、文件未移动；不是 capture/token 兼容错误。t15 仍是高方差任务。

## 5. t14/t17（Excel/PDF）：输入真实性与保存路径

### 5.1 t14

- **剪贴板 TSV + 功能区 Paste** 比逐格 type 便宜；`Ctrl+Shift+End` 选 A1:D6 + `Alt+F1` 插原生柱状图是稳定路径。
- **`background_delivery_failed` 曾被误判为硬失败**：t14 r1 的 28 次 type 中 26 次“未送达”，但 24 格全部写对；词边界修复后回执为“输入完成（未验证）”。
- **无 Document 的聚焦输入保留快照**，避免每格 type 后 observe；t14 新题面 3/3 pass（59/41/57 步），forced pointer 后 42 步。
- capture-only r2 64 步 fail 是 Paste 目标偏离、空区域做成图表；不是驱动兼容错误。t14 仍高方差。

### 5.2 t17

- **三击句子 + Ctrl+C** 比“文本选择原语”更实际；Excel 先 Save As 再粘贴。
- **native 截图 ≠ 像素 click capture**：pre-fix 的 `screenshot_context_missing` 被写成“点击完成”是最严重的真实性问题；`pointerCaptureReady` + 裸 code 拒绝修复后，post-fix 86 步、0 假成功。
- capture-only 保留 token 后回到 zoom/from_zoom 路径，**29 步 pass**。
- **不要关用户 Firefox 窗口/进程**：旧轮只在测试标签被选中时 Ctrl+W；新题面不再产生测试标签，cleanup 只关 setup Chrome。

## 6. 共性问题

1. **AX 树上下文不稳定**：Paint 调色板、PowerPoint ribbon、Explorer 文件列表都会在操作后“消失”或截断；模型只能用 force/full observe、native、zoom 兜底。
2. **background 动作经常是 no-op/unverifiable**：首次 drag/click 可能只聚焦不执行；模型需要 1–2 次 foreground 重试。`computer_activate` 有帮助，但有时被前台锁拒绝。
3. **native 截图可能陈旧（未证实普适）**：t11 有轨迹观测；deterministic probe 未复现。不要据此改缓存策略。
4. **保存不是 checkpoint**：题面要求“每柱保存”，模型仍把保存放到最后；Save As/颜色对话框焦点问题放大成本。
5. **验证回执驱动过度观察**：大量 `unverifiable` 让模型每步 observe/force；这是主要上下文/步数成本。
6. **应用/模板状态泄漏**：t12 主题装饰、t11 笔刷宽度会跨轮次影响结果；setup 需要显式清理/固定。

## 7. 与 ZCode CU 的对比（结论）

- **Ctrl+click 批量多选可实现**：ZCode CU 在 Explorer 上 `click(alpha)` + `click(beta, modifiers:"ctrl")` 后状态栏“已选择 2 个项目”；本插件补 `modifier` 后 t15 3/3。
- **Windows 画布拖拽需要 activation**：ZCode CU 在 Windows 上没有 `bring_to_front`/activation API，Paint 坐标 drag 被接受但状态无变化；本插件的 `computer_activate` + foreground drag 是必要能力。
- **PowerPoint 形状可按名称选中**：ZCode CU 读取 `Image "S4 Bar Q1/Q2/Q3"`；文本/颜色对话框成本仍在。
- 本地探针的原始元素数/坐标/结果见 [EVIDENCE](EVIDENCE.md) §4.3；完整产品对比见 [CU-RESEARCH](CU-RESEARCH.md)。

## 8. 建议与状态

| 优先级 | 改动 | 状态 |
|---|---|---|
| P0 | click 家族 `modifier` | ✅ 已实现/真机验证 |
| P0 | drag `from_zoom`/`steps` | ✅ 已实现 |
| P0 | drag `modifier` | ✅ 私有 SendInput 实现；0.39+ 原生 |
| P0 | t15 Ctrl+click 批量 | ✅ 3/3 pass（77/72/59） |
| P1 | t11 activate + 画布焦点 + 固定线宽/原点 | ✅ 3/3 pass（70/88/48） |
| P1 | t12 白底 seed + 直接输入 + 40 分钟 | ✅ 2/2 pass（140/169） |
| P1 | native freshness probe | ✅ 未复现；保留探针 |
| P2 | `selectText`/key hold/drag-from-element/多显示器 frame | 未做；当前 Cut/Paste 与坐标/AX 路径足够 |

## 9. 跨 provider 观察

| 任务 | DeepSeek 官方 | opencode-go | 观察 |
|---|---|---|---|
| t11 | 58/94 步 | 77 / capture-only 76 / 回执修复 70 | 回执修复后 mismatch 0、步数下降；方差仍来自 activate/focus |
| t12 | 152 步 / 1069s | 112 步 / 1581s；capture-only 98 / 回执修复 100 | 步数更省、单步更贵；native/query 更多 |
| t14 | 53/51 pass，64 fail | 60/59/76 pass，64 fail | 两边都有失败样本；高方差 |
| t15 | 85/67 步 | 55 pass / 52 fail | 最好样本更省；capture-only 失败是选择策略 |
| t17 | 37/75 步 | 40（pre-fix）/86（post-fix）/29（capture-only） | 最好样本同量级；post-fix 走手动输入路径 |

结论：**没有“opencode 一定更快”**。差异主要来自模型策略；驱动兼容层对两个 provider 行为一致。

## 10. 剩余摩擦

1. **启动主题错误是噪声**：早期每轮 `set_agent_cursor_theme` 失败 1 次；默认已改为 `cua.default`，失败回退。
2. **前台锁是环境成本**：F12/另存为/对话框常见；L3 有时被系统拒绝。不建议自动重试（会重复点击/输入）。
3. **工具描述可更明确**：参数误用（`screen_zoom(x,y,width,height)`、`computer_activate(foreground)`、`computer_key(pid,window_id)`）现在有 `PARAM_HINTS` + 通用速查，1 步可恢复。
4. **`markTokensStale` 是必要代价**：0.23.2 像素预取替换 index map，旧编号必须失效；模型重新 observe 的 1–2 步是正确行为。
5. **t17 capture-only 29 步**：保留 token 后回到 zoom/from_zoom 路径；不需要任务级提示。

## 11. 2026-11-20：t19/t20、p01-p03 与 AC6 轨迹

> 数据：`evals/headless-runs/2026-11-19T17-30-51`（t19/t20 首轮）、`17-41-07`（第二轮）、`18-09-47`（p01-p03）、`18-15-16`（t01/t05 各 5 轮）。模型 opencode-go/deepseek-v4.1-flash；驱动 0.52.13；Windows 11 / 150% DPI / 有用户窗口的桌面。

### 11.1 总表

| 运行 | inner steps | observe | action | obs:act | errors | unverified | wall | input | output | cacheRead | total | 结果 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| t19 首轮 | 32 | 13 | 19 | 0.68 | 1 | 11 | 335s | 41,071 | 7,369 | 812,288 | 874,168 | pass（Notepad 路径） |
| t19 二轮 | 52 | 25 | 27 | 0.93 | 7 | 21 | 708s | 69,860 | 14,840 | 2,226,048 | 2,310,748 | fail（撞 12min 预算） |
| t20 首轮 | 16 | 10 | 6 | 1.67 | 4 | 4 | 157s | 15,501 | 2,116 | 179,712 | 197,329 | pass |
| t20 二轮 | 28 | 17 | 11 | 1.55 | 3 | 5 | 709s | 25,845 | 14,537 | 529,920 | 596,158 | fail（撞 12min 预算） |
| p01 | 6 | 4 | 2 | 2.00 | 0 | 1 | 76s | 13,897 | 1,722 | 55,040 | 70,659 | pass |
| p02 | 10 | 5 | 5 | 1.00 | 1 | 3 | 100s | 15,924 | 1,467 | 115,712 | 133,103 | pass |
| p03 | 7 | 5 | 2 | 2.50 | 0 | 1 | 74s | 8,324 | 1,201 | 85,376 | 94,901 | pass |
| t01 r1 / r2 | 7 / 12 | 4 / 7 | 3 / 5 | 1.33 / 1.40 | 0 / 2 | 3 / 2 | 93 / 163s | 7,494 / 11,043 | 2,119 / 4,654 | 84,608 / 173,696 | 94,221 / 189,393 | 均 pass |
| t05 r1 / r4 | 12 / 43 | 5 / 19 | 7 / 24 | 0.71 / 0.79 | 1 / 6 | 3 / 14 | 120 / 431s | 11,169 / 39,869 | 2,097 / 9,382 | 142,336 / 1,199,872 | 155,602 / 1,249,123 | 均 pass |

两个 t19/t20 二轮的 `wallMs` 都是 **720,0xx ms**，正好落在 `--timeout-min 12` 边界，且没有 `final`/`turn_end`；应归因为**时间预算耗尽**，不是稳定的任务失败率。`headless-run` 当前把 `timedOut` 记为 false（进程关闭与超时计时器竞争），报告语义需要修。

### 11.2 t19：地址栏可靠，创建文件是薄弱环节

**首轮 pass（35 个工具调用 / 32 inner）**：
1. 观察 Explorer → `computer_activate` → `ctrl+l` → 输入任务目录 → `enter`，3 个动作到达 `nav`。
2. 没有使用 Explorer 的“新建”菜单，而是 **Win 键 → 开始菜单 → 记事本**，输入 `NAV-OK`。
3. `ctrl+s` 被 WinUI 拒绝（“没有可匹配的 UIA 加速键”），改用“点文件菜单 → 点保存”；随后 Save As 用 `computer_set_value` 写完整路径，点击/Enter 保存。
4. 回 Explorer 按 F5、zoom 确认。最终 `final` 明确写“通过 Explorer 地址栏进入…并用记事本新建 target.txt”。

**二轮 fail（56 个工具调用 / 52 inner）**：
- 同样在 3 个动作内到达 `nav`，说明**地址栏导航本身是可靠的**。
- 随后找“新建”按钮：点 `(57,113)` 两次无变化；点 `(121,241)` 反而点到导航树，跳到 D: 盘。
- 重新导航回 `nav`，用 `screen_zoom` + `from_zoom` 点“新建”，实际点中了地址栏；再试 `shift+f10`、右键空白、`win+r`。
- `win+r` 在这台机器上打开的是 **Command Palette（CmdPal）**，不是运行对话框；CmdPal AX 树为空、`type_text` 投递失败、`bring_to_front`/`click` 被前台锁拒绝。模型在 CmdPal 上耗了约 10 步。
- 结束：`alt+f` 后撞 12min 预算；36 次 `get_window_state`、25 次 `list_windows`、19 次 `bring_to_front`、12 次 click。

**结论**：
1. **导航能力已被证明**：两轮都在 3 步内到达任务目录；失败不在 Ctrl+L/路径输入。
2. **创建文件没有稳定入口**：Explorer 的“新建”按钮/右键菜单没有被可靠定位；坐标 `(57,113)` 与 `(121,241)` 说明模型在读图后仍用像素猜工具栏。t19 的 pass 实际是“导航 + 记事本另存为”，oracle 只验文件，无法区分 Explorer 新建与 Notepad 另存为。
3. **CmdPal 是环境陷阱**：Win+R 不再保证 Run 对话框；shell 表面无 AX、不能前台激活。题面/提示应引导 `app_launch` 或开始菜单，而不是 Win+R。
4. **无目标 observe 的代价**：首步 `screen_observe` 未指定窗口，选中 CmdPal（AX 空）→ 又用 `alt+tab` 失败；这是 2 步噪声。

### 11.3 t20：同一动作两种驱动状态，模态是死锁点

**首轮 pass（16 inner）**：
- 观察主窗 → 点 Delete（`unverifiable`，但模态出现）→ 观察主窗 → 点 Confirm 的“否(N)”元素，首次返回 **`element_not_visible` 拒绝**；模型没有重复同一点，而是观察 Confirm 独立窗口、用其快照再点，成功。
- 随后再次 Delete → Confirm → 点“是(Y)”元素成功；最终 `final` 明确写“未使用任何键盘快捷键”。

**二轮 fail（28 inner）**：
- 点 Delete **`cua-driver click timeout after 30000ms`**；Confirm 出现后，坐标 click 同样 30s 超时；`computer_activate` 也超时/拒绝。
- 模型尝试 `screen_zoom`/`from_zoom`、`computer_drag`（同点 dwell）、`computer_hover`、`app_list`，均无进展。
- 关键误导：`computer_drag((150,10)→(170,30))` 实际拖动了**标题栏**，窗口原点 +21/+20；模型把 `screenOrigin` 变化当成“坐标输入生效”，继续点 No，但仍未关闭对话框。
- 最后主窗激活后前台变成 ChatGPT，模型 `screen_observe("ChatGPT")` 并结束；没有 result.json。

**结论**：
1. **同一 Delete 点击有两种驱动结果**：首轮 `unverifiable`，二轮 30s timeout。模态出现时驱动/UIA 等待会阻塞；这是驱动层不稳定，不是模型单独的错。
2. **`element_not_visible` 可能是假阴性**：首轮拒绝后，重新观察再点成功。插件现有“拒绝可能是误报”的提示是必要的。
3. **模态需要独立窗口快照**：首轮模型做对了（观察 `Confirm` 并用它的 element）；二轮被困在像素/zoom/drag，没有回到这条路径。
4. **标题栏拖动不是点击证据**：拖动窗口改变 `screenOrigin` 会让坐标“看起来生效”，但没有改变对话框状态。工具提示应避免把 drag 当 click 的替代。
5. **题面禁止键盘快捷键**：t20 prompt 写“Do not use keyboard shortcuts to bypass the dialogs”。二轮模型因此完全没有尝试 Enter/Escape；而 `Escape` = No、`Enter` = 默认 Yes 是原生 MessageBox 的可靠回退。题面应区分“不得绕过对话框”和“可用 Tab/Enter 选择按钮”。
6. **注意力漂移**：主窗激活失败后前台是 ChatGPT，模型跟到 ChatGPT；应在题面/系统提示中要求“始终以 S4-T20-DIALOG 为目标，不要跟随前台窗口”。

### 11.4 p01-p03：像素链路可用，成本低

- **p01**：AX 观察 → 激活 → native `force` → zoom → `from_zoom` 点击 → native 验证；6 inner，70,659 total。
- **p02**：native 读 canvas token → zoom → 激活 → 点输入框 → AX 观察找到 element 12 → `computer_type` 后台被 Chrome 拒绝（`background_unavailable`）→ 前台重试成功 → native 验证 → 点 Submit → native 验证；10 inner，133,103 total。
- **p03**：catalog → **无目标 AX 观察选中 ChatGPT（浪费 1 步）** → 目标 AX → 激活 → native → zoom → `from_zoom` 点击 → native 验证；7 inner，94,901 total。

**结论**：
1. canvas/OCR/zoom 的模型路径已成立：3/3 pass，6–10 inner，成本远低于 t11/t12 的 Office 任务。
2. p02 暴露了 Chrome 的后台输入限制；前台重试 1 步恢复，属于预期能力边界。
3. p03/t01 r2/t19 二轮都出现“无目标 observe 选到 ChatGPT/CmdPal”的噪声；这是跨任务的提示层问题。

### 11.5 t01/t05（AC6）：方差来自一个错误原语

- **t01 r1（7 inner，94k）**：catalog → 观察 `note.txt` → 一次 `computer_type` → 观察 → 点“文件” → 观察 → 点“保存” → 观察。
- **t01 r2（12 inner，189k）**：完整 catalog + status → **无目标 observe 选中 ChatGPT** → 观察 note.txt → 激活 → 输入 → zoom 验证 → 两次 `computer_menu`（`文件->保存` 被解析成 `文件-`；`文件>保存` 找不到第二段）→ 观察 → 点“保存”。菜单尝试多花 2 个工具调用。
- **t05 r1（12 inner，156k）**：status → catalog → app_list → 观察 pid → 激活 → `ctrl+shift+s`（WinUI 拒绝，给出菜单指引）→ 点“文件” → 点“另存为” → Save As 观察 → **`computer_set_value` 写完整路径** → 观察 → 点保存 → 观察标题。
- **t05 r4（43 inner，1.25M）**：观察标题 → 3 次 catalog → 激活 → `ctrl+shift+s` 失败 → 点文件/另存为 → Save As → **`computer_type` 写文件名**，结果把路径追加到 `draft.txt` 后面（`draft.txt…`），随后 query/观察/点字段/双击/ctrl+a/backspace/前台点击/拖动，全部无效或未验证；最后 `computer_set_value("out-ansi.txt")` 覆盖并点保存，成功。6 errors、14 unverified、431s，是 t05 的 1.25M total 尾部样本。

**结论**：
1. **Save As 文件名必须优先 `computer_set_value`**：`computer_type` 在已有值的编辑框会追加；`ctrl+a` 在 WinUI 对话框不可用；backspace/拖动救不回来。t05 的 12 → 43 步几乎全部由这一处引起。
2. **`computer_key ctrl+a` 的提示方向错误**：当前回执建议“点击输入框后用 computer_type”；对预填字段这是 append 陷阱。应改为“先 set_value 覆盖；控件不支持 ValuePattern 时再点击+清空+type”。
3. **`computer_menu` 的 `->` 解析**：`文件->保存` 被拆成 `文件-` + `保存`；应归一化 `->`/`→`，或明确拒绝并提示用 `>`。
4. **cacheRead 主导成本**：t05 r4 total 1.25M 中 cacheRead 1.20M（96%）；AC6 的 `billable`（in+out+cacheWrite）只有 24,993（中位），不能把 cacheRead 当“免费”或当“输入 token”。
5. **错误/未验证数与成本强相关**：t05 r1 1 error/3 unverified/156k；r4 6/14/1.25M；t19 1/11/874k vs 7/21/2.31M。`unverified` 单独不是失败（p01/t20 pass 也有），但与反复 observe/重试叠加时会放大 context。

### 11.6 横向模式

| 模式 | 证据 | 影响 | 建议 |
|---|---|---|---|
| 无目标 `screen_observe` 选中前台 ChatGPT/CmdPal | t19 二轮首步、t01 r2、p03 | 1–2 步噪声；CmdPal 可引发 10 步陷阱 | 题面/COMMON 要求先按任务窗口标题观察；工具层考虑排除 shell 表面（CmdPal/TextInputHost） |
| Win+R 打开 CmdPal 而非 Run | t19 二轮 | CmdPal 无 AX、不能前台激活，输入失败 | 指引用 `app_launch`/开始菜单；文档记录环境差异 |
| 模态 click 30s timeout | t20 二轮 | pass/fail 分化的直接原因 | click 超时回执给“观察新对话框/使用其快照/Enter-Escape”指引；不要重试像素/zoom/drag |
| 预填文件名用 `computer_type` | t05 r4 | 12 → 43 步、1.25M total | `computer_type`/`ctrl+a` 提示改为优先 `computer_set_value`；描述明确“可能追加” |
| `computer_menu` 的 `->` | t01 r2 | 2 次无效调用 | 解析归一化 `->`，或在错误中明确“用 `>`/数组” |
| 标题栏 drag 改变 origin | t20 二轮 | 模型误以为坐标生效 | drag 描述/回执提示“从标题栏拖动=移动窗口，不是点击/落点证明” |
| 12min 边界无 final | t19/t20 二轮 | 被记 fail，但实际是预算耗尽 | `headless-run` 增加 `budgetExhausted/noFinal` 标记；报告不要把边界样本当稳定失败率 |
| t19 用 Notepad 另存为 | t19 首轮 | 可达 oracle，但未验证 Explorer 新建文件 | 要么题面/README 明确允许；要么加 provenance（禁止 Notepad 窗口） |
| t20 禁止键盘 | t20 prompt | 模态 click 超时后无回退 | 改为“不得绕过对话框；可用 Tab/Enter 选择按钮”，或明确 Enter/Escape 可用 |

### 11.7 优先级建议

| 优先级 | 改动 | 理由 |
|---|---|---|
| P0 | t20 prompt 澄清 Tab/Enter 可用于选择对话框按钮；保留“不得绕过/不得直接改文件” | 二轮 fail 的直接可修复项；当前题面把唯一的可靠回退禁掉了 |
| P0 | `computer_key` `ctrl+a` 回执与 `computer_type` 描述：预填字段优先 `computer_set_value` | t05 12→43 步、1.25M total 的根因 |
| P1 | `computer_click` 超时回执：先观察新顶层对话框、用其 window_id/snapshot；不要重试像素/drag/hover | t20 二轮 30s 超时后模型进入 10+ 步无效探索 |
| P1 | `computer_menu` 路径解析归一化 `->`/`→`；WinUI 菜单明确“不可用，点菜单栏” | t01 r2 的 2 次无效调用；与 WinForms menu BLOCKED 一致 |
| P1 | `screen_observe` 无目标时排除 CmdPal/TextInputHost 等 shell 表面，或返回候选列表 | 多个任务的 1–2 步噪声；t19 二轮 CmdPal 陷阱 |
| P1 | `headless-run` 报告 `budgetExhausted`/`noFinal` | 当前 720s 边界样本被记为普通 fail，混淆通过率 |
| P2 | t19 增加“Explorer 新建”provenance 或题面明确允许 Notepad 另存为 | 避免把 Notepad 路径当成 Explorer 新建能力的证据 |
| P2 | `computer_drag` 描述提示标题栏拖动=移动窗口 | 防止模型把 origin 变化当成点击生效 |
| P2 | AC6 继续跑 t11/t14/t15 5 轮；报告同时给 total 与 billable | 当前只有 t01/t05；长任务尾部成本未知 |

### 11.8 修复验证（2026-11-20）

#### 11.8.1 已落地改动

| 优先级 | 改动 | 文件 | 守门 |
|---|---|---|---|
| P0 | t20 允许 Tab/Enter/Escape 选择按钮；强调始终回到 `S4-T20-DIALOG` | `evals/tasks/t20-dialog-chain.md` | `tests/tasks.check.mjs` t20 prompt 守卫 |
| P0 | 预填字段优先 `computer_set_value`；`computer_type` 明确为追加 | `index.js`、`lib/observe.js`、`lib/keyFallback.js` | `observe.truth` T1b；`key.xaml` K22b |
| P1 | click/key 驱动超时回执 + `markSuspect` | `lib/receipt.js`、`index.js` | `delivery.failures` D-timeout-click/type/key |
| P1 | `computer_menu` 归一化 `/`、`›`、`>`、`->`、`→` | `lib/menuPath.js`、`lib/ops.js`、`lib/guard.js` | `tools.smoke` G2d2/G2d3 |
| P1 | 无目标观察跳过 CmdPal/TextInputHost 等 shell 表面 | `lib/observe.js` | `observe.truth` T26 |
| P1 | `budgetExhausted`/`noFinal`；边界样本记 `verdict=timeout` | `evals/lib/run.mjs`、`evals/headless-run.mjs`、`ac6-summary`、`ab-summary` | `tests/proc-run.test.mjs` |
| P1 | COMMON 要求显式指定任务窗口、不跟随前台 | `evals/headless-run.mjs` | 真实模型复跑 |
| P2 | t19 明确允许 Notepad 另存为（不证明 Explorer 新建） | `evals/tasks/t19-explorer-navigation.md` | `tests/tasks.check.mjs` t19 prompt 守卫 |
| P2 | drag 标题栏检测/注记/清快照 | `lib/observe.js`、`lib/actions.js`、`index.js` | `action.echo` E34/E35 |

#### 11.8.2 真跑复跑（opencode-go/deepseek-v4.1-flash，12min 预算）

| 运行 | 结果 | inner | wall | total tokens | 行为变化 |
|---|---|---:|---:|---:|---|
| t20 r1 | pass | 27 | 595s | 536,684 | 2×click/1×bring_to_front/1×move_cursor/1×press_key 超时（5 次/150s）；按回执 observe 新对话框并用 Escape/Tab/Enter 完成 |
| t20 r2 | pass | 25 | 618s | 425,642 | 3×click/2×bring_to_front/1×move_cursor/3×press_key 超时（9 次/270s）；仍用 Escape/Tab/Enter/Space 完成 |
| t19 r1 | pass | 40 | 387s | 1,221,447 | `set_value` 完整路径；地址栏导航正常 |
| t19 r2 | pass | 56 | 595s | 2,424,636 | `win+r` 被降级为单 `win`，打开 Start/SearchHost（CmdPal 未选中），12 步绕路；最终 Notepad 另存为成功 |
| t05 r1 | pass | 21 | 185s | 385,860 | 仅 `set_value` 写文件名（len=12），零 `type` |
| t05 r2 | pass | 13 | 121s | 234,925 | 同上；13 inner 为当前最低 |

- 对照修复前：t19/t20 各 1 pass / 1 预算耗尽（无 final）；t05 r4 43 inner/431s/1.25M。修复后 6/6 pass、0 timeout/dirty。
- t20 的改善不是“超时消失”，而是“超时后不再死循环”：两轮仍出现多次 30s 超时，单轮仍接近 10 分钟；根因在驱动/UIA 等待模态，已记入 [VERIFICATION](../VERIFICATION.md) §2。
- t19 r2 仍是高方差样本（56 inner/2.4M total）；题面允许等价 GUI 路径降低了预算耗尽概率，但没有降低探索成本。r2 的 `win+r` 被降级为单键 `win`，打开 Start/SearchHost（CmdPal 未选中），说明 `win` 组合键解析缺陷未被 COMMON 消除；本轮改为 fail-closed。
- t05 的直接收益最清晰：`set_value` 覆盖替代 `type` 追加后，步数 43→21/13，total 1.25M→0.39M/0.23M。

#### 11.8.3 P0/P1/P2 状态

| 项 | 状态 | 说明 |
|---|---|---|
| P0 t20 题面 | **已闭合** | 2/2 pass；键盘回退可用 |
| P0 预填字段 | **已闭合** | t05 2/2 pass，零 type 追加 |
| P1 click/key 超时回执 | **已闭合（行为）** | 超时仍在，但模型能恢复；驱动根因未闭合 |
| P1 menu 归一化 | **已闭合** | G2d2/G2d3 通过 |
| P1 shell 表面过滤 | **已闭合** | T26 通过；显式目标仍可观察 |
| P1 runner 预算语义 | **已闭合** | proc-run 3/3；报告字段可用 |
| P2 t19 provenance | **按“明确允许”闭合** | 文档明确不证明 Explorer 新建 |
| P2 drag 标题栏 | **已闭合** | E34/E35 通过 |
| P2 AC6 t11/t14/t15 5 轮 | **未做** | 本轮只复跑 t20/t19/t05；长任务成本仍未测，不伪造中位数 |

静态基线：`npm test` **27 套 / 674 项**，语法 **39/39**，`npm pack` **57 文件**；t20/t19 AC2 2/2 PASS。所有复跑数据见 [EVIDENCE](EVIDENCE.md) §1.2。

### 11.9 第二轮修复验证（2026-11-20，P0/P1 后）

#### 11.9.1 复跑结果

| 运行 | 结果 | steps / inner | wall | total tokens | 关键行为 |
|---|---|---:|---:|---:|---|
| t20 r1 | pass | 30 / 27 | 626s | 521,250 | 2×bring/4×click/4×press 30s + 1×move 3s；候选提示 8 次、前置超时 1 次 |
| t20 r2 | pass | 27 / 25 | 601s | 440,640 | 4×bring/6×click/2×press 30s + 1×move 3s；候选提示 9 次、前置超时 1 次 |
| t19 r1 | pass | 71 / 70 | 652s | 2,951,817 | `win+r` 0；22 click/26 key/10 type/58 observe；未用 set_value |
| t19 r2 | pass | 49 / 48 | 454s | 1,703,198 | `win+r` 0；地址栏提示 3 次；set_value 2 次；clear-eval removed=3 |
| t05 r1 | pass | 10 / 10 | 86s | 129,803 | 零 type；set_value 2 次；另存为提示 2 次；无 src 残留 |
| t05 r2 | pass | 16 / 15 | 106s | 227,850 | 零 type；set_value 2 次；另存为提示 3 次；无 src 残留 |

#### 11.9.2 结果解读

- **超时语义变诚实，但 t20 没有变快**：wall 595/618s → 626/601s，total tokens 基本持平。`move_cursor` 已从 30s 降到 3s，`preflight bring` 超时后不再发送 click（回执明确“本次点击未发送”）；但 click/press_key 在模态上的 30s 超时仍多次发生，驱动根因未消除。
- **候选窗口提示真实生效**：t20 两轮分别出现 8/9 次“同 pid 的更高层窗口”候选；模型仍会先尝试后台点击，但不再需要自己从 `foregroundHint` 猜 window_id。
- **t05 是最大收益**：10/15 inner、86/106s，零 `type` 改文件名，`set_value` 新值回执与“另存为默认目录/绝对路径”提示直接消除了修复前的重存循环；oracle 的 `no stray out-ansi.txt in src` 也通过。
- **t19 是混合结果**：`win+r` 从每轮多次降为 **0**，说明 fail-closed 生效；r2 从 56→48 inner 改善，但 r1 从 40→**70** inner 回归。r1 的 22 次 click/26 次 key 主要花在 Explorer 新建/重命名探索，未使用 `set_value`；题面禁止 Win+R 后，模型把绕路转移到了 Explorer 工具栏/右键。不能写“t19 已优化”，只能写“Start 绕路消除、Explorer 新建方差仍在”。
- **TabState 隔离生效**：t19 r2 与 t05 r2 的 `clear-eval removed=3` 说明上一轮 eval bins 被清掉；本轮未再出现“恢复上一轮 target.txt 标签”的错误对话框。

#### 11.9.3 剩余边界与下一步

| 项 | 状态 | 建议 |
|---|---|---|
| t20 模态 30s 超时 | **未闭合（驱动根因）** | 保持“超时=结果未知”的回执；下一步做 `get_window_state timeout_ms:5000` 探针，只有探针 PASS 才改 observe 重试；不盲改默认 |
| t19 r1 Explorer 新建探索 | **新发现的高方差** | 题面加一句“If Explorer New is not directly available, switch to Notepad Save As instead of probing toolbar coordinates”；改后需复跑 2 轮，不能沿用本轮数据 |
| t19 r1 未用 set_value | 模型策略 | 题面已允许 Save As；可在 t19 Notes 明确“优先 app_launch Notepad + set_value 完整路径”，但会降低 Explorer 新建覆盖，需选一个目标 |
| t20 候选提示仍会后台点击 | 模型策略 | 回执已说“不要后台坐标点击”；若仍反复，可评估在对话框窗口上直接拒绝 background 点击（需要更细的模态识别） |
| AC6 t11/t14/t15 5 轮 | **未做** | 不伪造中位数；等空闲桌面/额度 |
| WinForms menu、Excel/PPT、A11、多屏、macOS/Linux、t13 | **外部阻塞** | 保持 `eval/BLOCKED.md`；不计 pass |

本轮结论：**P0 超时透传/候选回执、win fail-closed、t05 另存为修复均已落地并有真实轨迹支撑；t20 驱动根因和 t19 Explorer 新建方差仍未闭合**。

