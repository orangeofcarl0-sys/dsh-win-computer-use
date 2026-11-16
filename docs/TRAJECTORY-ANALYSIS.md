# TRAJECTORY ANALYSIS — t11 / t12 / t15 的模型行为与失败模式

> 数据日期：2026-11-16/17。对象：`dsh-win-computer-use` 插件 + dsh 0.2.2-rc.1 的真实 dirty 桌面运行，以及同机 ZCode CU 的能力探针。
>
> 原始 report/trajectory 在 `evals/headless-runs/`（gitignored，不入库）。本文只保留摘要、时间线、工具计数和可复现的观察，不包含截图/文档正文。
>
> 相关：[CU-RESEARCH](CU-RESEARCH.md)（社区 CU 处理模型）、[TESTING](TESTING.md)（测试体系）、[WINDOWS](WINDOWS.md)（Windows 投递/坐标）。

## 1. 运行矩阵

| 运行 | 结果 | inner steps | observe | click | type | drag | zoom | activate | errors / unverified | 时长 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| t11 旧题面 | fail 71 | 140 | 86 | 28 | 0 | 8 | 31 | 1 | 7 / 44 | 1161s |
| t11 显式题面 A | **pass 84** | 82 | 47 | 13 | 1 | 12 | 4 | 1 | 4 / 29 | 734s |
| t11 显式题面 B | **pass 77** | 76 | 41 | 19 | 2 | 7 | 3 | 1 | 3 / 29 | 707s |
| t11 显式题面 C | fail 49 | 47 | 22 | 10 | 2 | 7 | 0 | 1 | 1 / 23 | 350s |
| t12 旧 seed | fail 189 | 187 | 51 | 47 | 20 | 2 | 0 | 0 | 6 / 129 | 1191s |
| t12 简化无占位柱 | fail 160 | 157 | 64 | 40 | 9 | 4 | 0 | 1 | 2 / 88 | 1192s |
| t12 保存按钮 | fail 162 | 160 | 62 | 38 | 12 | 1 | 6 | 0 | 5 / 93 | 1189s |
| t12 占位柱 | fail 178 | 174 | 71 | 61 | 6 | 0 | 5 | 2 | 25 / 77 | 1191s |
| t12 预填+占位柱 25min | fail 190 | 186 | 79 | 60 | 8 | 0 | 8 | 3 | 10 / 97 | 1492s |
| t15 r1 | **pass 177** | 176 | 77 | 26 | 1 | 0 | 26 | 1 | 9 / 90 | 1110s |
| t15 r2 | **pass 146** | 143 | 43 | 40 | 2 | 1 | 0 | 2 | 9 / 85 | 853s |
| t15 r3 | **pass 89** | 88 | 30 | 42 | 0 | 1 | 1 | 1 | 14 / 55 | 560s |

原始 run id：

- t11：`2026-11-16T10-45-11`（旧题面 71）、`11-09-17`（84）、`11-22-15`（r2 为 49）、`11-46-40`（77）
- t12：`12-10-08`（189）、`12-32-32`（160）、`13-37-29`（162）、`14-01-08`（178）、`14-29-56`（190）
- t15：`12-53-31`（r1/r2/r3）

## 2. t11：不是“不会画”，是焦点 + 首次拖拽 + 状态判定

### 2.1 84 步 pass 的时间线

- 0–144s：观察 Paint AX/native/catalog。AX 树一开始只有 43/44 个元素，调色板不在树里；force/全量观察后才出现 85 个元素。模型用 native 截图反推画布位置。
- 144–200s：第一次 `computer_drag(956,679→1156,819)` 返回 unverified，native 仍是空白；`computer_activate` 后重试，第二次 foreground drag 才画出红色矩形。
- 200–509s：椭圆和直线各需要 1–2 次重试，最终 **12 次 drag 画完 3 个形状**。
- 544–734s：保存。`Ctrl+Shift+S` 没有打开对话框，模型改用 File 菜单 → Enter 展开 PNG 子菜单 → Save As；文件名/保存类型输入又因焦点错误走错窗口，靠 native 截图和绝对坐标才保存。

关键行为：模型从状态栏坐标反推画布原点：drag 起点 `956,679`，状态栏 `77,79` → 原点 `879,600`。这是它后来能精确画椭圆/直线的关键。

### 2.2 77 步 pass 的差异

- 开头同样遇到“调色板不在 AX 树”，模型用 `screen_observe(query="色")` + 全量 observe 恢复 87 个元素。
- 它总结出 **第一次 drag 只把光标移到起点、不真正画**：背景 drag 无效果，`activate` 后第一次 foreground drag 仍空白，第二次 foreground drag 才出现形状。
- 后续椭圆/直线主动重复 drag，7 次完成 3 个形状，比 84 步少。
- 保存阶段仍然很贵：Save As 对话框的 `Ctrl+A`/输入被主窗口或导航树抢走；模型用 native 截图确认“out 文件夹、文件名、PNG 类型”，最后点击保存时出现 `window_target_not_found`，但文件实际已保存。

### 2.3 49 步 fail：最快但质量最差

- 180s 内画完三个形状并保存。
- `activate` 之前有一次 `drag(631,463→831,603,fg)`，模型自己也不确定是否画出；最终 oracle：
  - `red global precision=false`：画布上出现参考区域之外的红色笔画；
  - 红/蓝/黑 `reference coverage=false`：线条比参考细很多。
- Paint 的笔刷宽度是**跨启动持久化**的；前一轮可能把宽度留在 1px，本轮没有重新设置，导致覆盖不足。
- 说明 t11 的 pass/fail 不只取决于“有没有画”，还取决于 **Paint 持久化的笔刷状态 + 是否多画了错误笔画**。

### 2.4 t11 根本问题

1. **AX 树上下文不稳定**：调色板/形状控件时有时无；模型必须 force/全量观察或 native 兜底。
2. **第一次 drag 经常只聚焦不画**：这是驱动/窗口焦点行为，不是模型“不会拖”。
3. **native 截图存在陈旧/缓存迹象**：模型在 s24–s26 看到 drag 前后同一张 PNG hash，而 AX 状态栏已变化；它因此误判 drag 失败，重复 drag/undo。需要 deterministic probe 确认是驱动截图缓存还是窗口渲染延迟。
4. **Save As 焦点不稳定**：Ctrl+A/输入落到主窗口或导航树；模型只能靠 native 截图和绝对坐标救回。
5. **Paint 笔刷宽度持久化**：同一题面不同轮次的线宽不同，oracle 覆盖阈值把状态差异放大成 pass/fail。

## 3. t12：不是“不会做 PPT”，是每根柱的格式化成本 > 预算

### 3.1 25 分钟 / 190 步的时间分布

- **0–247s（4.1 分钟）**：没有一次 foreground click。模型在 native 截图、zoom、slideshow（F5/Alt+F10）、选择窗格之间探索。它看到模板标题页的深色背景/大标题/红蓝色带，误以为幻灯片状态不对，甚至进入放映视图确认。
- **247–524s（4.6 分钟）**：第一次 foreground 点击选中红色占位柱；打开“设置形状格式”窗格，点“填充”→“其他颜色”，发现颜色对话框是**独立窗口**；UIA `set_value` 对十六进制字段无效，键盘焦点又被还原，最后靠 `computer_activate(颜色窗口)` + 点击/输入才设置 `#C00000`。
- **524–893s（6.1 分钟）**：给红柱加 Q1 文本。双击/F2 都不能进入文字编辑，最后右键 →“编辑文字”才成功；随后 Ctrl+A 后点字号框，把 Q1 替换成了“40”，Ctrl+Z 后重输；再调 40pt、加粗、白色、居中、垂直居中。**14.9 分钟才第一次 Ctrl+S**。
- **893–1492s（10 分钟）**：选蓝柱、设 `#2E75B6`、加 Q2 文本、重复字号/居中流程。绿柱和 Q3 完全没开始。

结论：**一根柱约 7–8 分钟**；其中大部分不是“选形状”，而是颜色对话框 + 文本编辑/字号/居中。3 根柱在 25 分钟内不可能完成。

### 3.2 其他 t12 运行说明了什么

- **旧 seed / 189 步**：Q1/Q2/Q3 文本都写了，但 bars 全部 false，只有 2 次 drag、20 次 type。模型把“柱”做成了文本框/标签，而不是带填充色的矩形。
- **无占位柱 / 160 步**：没有保存，没有 bars；模型在标题/字体/版式里消耗完预算。
- **占位柱 / 178 步**：红/蓝柱、Q1/Q2 成功，绿柱/Q3 缺失；25 errors、26 次 force observe。占位柱确实把“插入形状”问题解决了，但每根柱的文本格式化仍然太贵。
- **预填 title/subtitle + 25min / 190 步**：title/subtitle 保住了，红/蓝柱成功；绿柱/Q3 仍未完成。预填只省了标题，没有改变“每根柱 7 分钟”的成本结构。

### 3.3 t12 根本问题

1. **模板标题页的视觉噪声**：`WidescreenPresentation.potx` 的 title slide 带主题背景/装饰，native 截图里出现深色背景、超大标题、红蓝色带，模型花了很多步确认“这是不是我的幻灯片”。
2. **PowerPoint 的格式面板/颜色对话框是独立窗口**：UIA 字段不可写，foreground 恢复会抢焦点；模型只能“activate 对话框 → 点字段 → 键盘输入”。
3. **文本编辑入口不可靠**：双击/F2 都不进入编辑，右键菜单“编辑文字”才成功。
4. **字号操作打断文本选择**：点字号框后 Ctrl+A 仍选中形状文本，输入“40”把 Q1 替换；这是典型的 PowerPoint 焦点/选择状态问题。
5. **保存被排到最后**：题面要求每根柱保存，但模型在 14.9 分钟才第一次保存；绿色柱没有时间。

## 4. t15：同一任务三种策略，步数 89–177

### 4.1 r1 = 177 步：zoom/坐标映射策略

- 26 次 `screen_zoom`、51 次 observe、70 次 key、3 次 double-click。
- 用 zoom 图估行坐标，但 padding/缩放导致点错行：想选 report，实际选 temp；想选 alpha，实际选 beta；`Home` 又把焦点送到地址栏/父目录。
- F2 多次无效，直到 `computer_activate` 后才出现 inline edit。
- 每个文件都要 zoom/确认/导航，步数高。

### 4.2 r2 = 146 步：混合策略

- 43 次 observe、40 次 click、11 次 force observe、2 次 type、4 个 loop；不再大量 zoom/native。
- 用 AX 元素索引 + 键盘导航，仍有 focus/选择错误，但比 r1 稳定。

### 4.3 r3 = 89 步：AX 索引 + 命令栏 Cut/Paste 策略

- 30 次 observe、42 次 click、12 次 key、23 次 force observe。
- 直接用元素索引：选文件 → 命令栏“剪切” → 点目标文件夹 → Enter → 命令栏“粘贴”。
- 仍然有 14 errors / 12 delivery failures；最典型的是 **inline edit 里 `Ctrl+A` 被当成字面字符 “a”**，把 `report-draft.txt` 改成 `a.txt`，最后用 `set_value(el=178, "report-final.txt")` 救回。
- 它没有按目标批量移动（所有 txt 一次、所有图片一次），而是逐文件循环；如果能批量，步数还能降。

### 4.4 t15 结论

- **方差主要来自导航策略，不是任务难度**：zoom/坐标映射 177 步，AX 索引 + 命令栏 89 步。
- 题面“最后统一验证”有效（r3 只验证 inbox 终态），但模型仍会在每次导航后 force observe 以拿新索引。
- `Ctrl+A` 在 inline edit 的解析 bug 是确定性问题，应单独加回归测试。
- **逐文件循环不完全是模型自发**：当前 `computer_click` 没有 `modifier`，非连续 Ctrl+click 多选不可用。ZCode CU 真机探针证明 Ctrl+click 可用（见 §6.1），所以先补 modifier，再判断模型是否仍逐文件。

## 5. 共性问题

1. **AX 树上下文不稳定**：Paint 调色板、PowerPoint ribbon、Explorer 文件列表都会在操作后“消失”或截断；模型只能用 force/full observe、native、zoom 兜底。
2. **background 动作经常是 no-op/unverifiable**：t11/t12 的首次 drag/click 经常只聚焦不执行；模型需要 1–2 次 foreground 重试。`computer_activate` 有帮助，但有时被前台锁拒绝。
3. **native 截图可能陈旧**：t11 有直接证据（drag 前后同一 PNG hash，而 AX 状态已变）；模型被迫用状态栏/坐标判断，增加重复动作。待 deterministic probe 确认。
4. **保存不是 checkpoint**：题面要求“每根柱保存”，模型仍把保存放到最后；Paint/PPT 的 Save As/颜色对话框焦点问题进一步放大。
5. **验证回执驱动过度观察**：大量 `unverifiable` 让模型每步 observe/force；t12 79 次、t15 77 次 observe 是主要上下文/步数成本。
6. **应用/模板状态泄漏**：t12 的主题装饰、t11 的 Paint 笔刷宽度都会跨轮次影响结果；测试 setup 需要显式清理/固定这些状态。

## 6. ZCode CU 真机探针（同机对比）

> 方法：`computer-use` skill 要求 main agent only，因此这部分由主会话直接执行，不是子代理。探针不是完整三题跑分，只验证关键原语。

### 6.1 t15：Ctrl+click 多选成功

- ZCode CU 读取 Explorer 返回 **291 个元素**，包括 `row alpha.txt`、`row beta.txt`、`row report-draft.txt`、`row docs/images/archive`、命令栏 `剪切/复制/粘贴/重命名`。
- 执行 `click(alpha)` + `click(beta, { modifiers: "ctrl" })` 后，AX 状态栏显示 **“已选择 2 个项目 28 字节”**。
- 命令栏 `剪切` → 打开 `docs` → `Ctrl+V`，docs 中出现移动后的文件。
- inline 重命名字段可用 `setValue`/点击+输入，但一次 `type` 返回 “response lost”，必须 observe 后再继续。

结论：**Ctrl+click 批量多选是可行的**；t15 的逐文件循环至少部分是本插件缺少 `modifier` 导致的工具缺口，不是纯模型策略。

### 6.2 t11：画布拖拽仍需要前台

- ZCode CU 读取 Paint 返回 **221 个元素**，包含画布 bounds `[879,600,800,600]`、`矩形/椭圆/直线`、`红色/靛蓝色/黑色`。
- 元素点击可以选中工具/颜色；坐标拖拽要求先 `get_app_state({include_screenshot:true})` 取得 actionable frame。
- 返回的 frame 是 **1280×800**（不是 2560×1600），画布映射到约 `[440,300,400,300]`；直接用屏幕 bounds 会越界。
- 用 frame 坐标 drag `[480,345] → [580,415]` 被接受，但 Paint 状态无变化；ZCode CU 提示“coordinate pointer action ... act on element or keyboard”。画布没有 element，键盘也不能画图。
- ZCode CU 在 Windows 上没有 `bring_to_front`/activation API，因此无法把 Paint 切到前台再发真实拖拽。

结论：**ZCode CU 在 t11 上也会失败**；本插件的 `computer_activate` + foreground drag 是必要能力。

### 6.3 t12：形状可按名称选中

- ZCode CU 读取 PowerPoint 返回 **353 个元素**，形状以 `Image "S4 Bar Q1/Q2/Q3"` 暴露并带 bounds；`标题文本框`/`副标题文本框` 的 value 也可读；`形状填充/形状轮廓` SplitButton 可见。
- 按元素名选中形状可行；surface reference 会 retired，需要重新 observe。
- 文本/颜色对话框/字号/居中仍是应用层成本，CU 只能减少“选形状”的步骤。

## 7. 建议（按 ROI）

| 优先级 | 改动 | 依据 |
|---|---|---|
| **P0** | `computer_click`/`double_click`/`right_click` 加 `modifier`；`computer_drag` 加 `modifier`/`from_zoom`/`steps` | driver 0.23.2 已支持；t15 Ctrl+click、t11 zoom/Shift 直接受益 |
| **P0** | t15 用 Ctrl+click 批量跑 3–5 次 | 区分工具缺口与模型逐文件策略 |
| **P1** | t11 题面/插件加“activate + 画布焦点 click + drag”；固定 Paint 笔刷宽度 | 减少首次 drag 被吞、coverage 随机 fail |
| **P1** | t12 35–40 分钟或拆题；白底 seed + 预填 title/subtitle/占位柱；ZCode 式按形状名选择 | 当前 3 柱 + 文本格式化在 25 分钟不可完成 |
| **P1** | native screenshot freshness probe；`selectText`/key hold/drag-from-element 评估 | 解决 t11 重复 drag、t12 文本选择/格式部分成本 |
| **P2** | Explorer spring-loaded dwell、drag path、多显示器 frame | 高级拖放；当前 Cut/Paste 已足够 |

## 8. 证据边界

- 原始 report/trajectory 在 gitignored 的 `evals/headless-runs/`；本文不提交截图/文档正文/模型原始 thinking。
- ZCode CU 探针是能力验证，不是完整 t11/t12/t15 的通过/失败统计；完整三题仍需按本插件 eval 框架重跑。
- native 截图“陈旧”目前是轨迹中的直接观测证据 + 模型自身判断，尚未用独立 deterministic probe 确认；修复前不要把它写成已证实 bug。
- t12 的 PowerPoint 行为来自本机 Office 16 / Windows 11 / 150% DPI，其他环境可能不同。
