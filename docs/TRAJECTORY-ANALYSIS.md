# TRAJECTORY ANALYSIS — t11 / t12 / t14 / t15 / t17 的模型行为与失败模式

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
| t11 第七轮 A | **pass 58** | 57 | 32 | 15 | 1 | 4 | 0 | 3 | 6 / 20 | 398s |
| t11 第七轮 B | **pass 94** | 91 | 29 | 17 | 3 | 9 | 24 | 7 | 3 / 26 | 934s |
| t11 0.52.13 opencode | **pass 77** | 75 | 46 | 17 | 0 | 5 | 0 | 5 | 4 / 20 | 929s |
| t12 旧 seed | fail 189 | 187 | 51 | 47 | 20 | 2 | 0 | 0 | 6 / 129 | 1191s |
| t12 简化无占位柱 | fail 160 | 157 | 64 | 40 | 9 | 4 | 0 | 1 | 2 / 88 | 1192s |
| t12 保存按钮 | fail 162 | 160 | 62 | 38 | 12 | 1 | 6 | 0 | 5 / 93 | 1189s |
| t12 占位柱 | fail 178 | 174 | 71 | 61 | 6 | 0 | 5 | 2 | 25 / 77 | 1191s |
| t12 预填+占位柱 25min | fail 190 | 186 | 79 | 60 | 8 | 0 | 8 | 3 | 10 / 97 | 1492s |
| t12 第七轮 | **pass 152** | 150 | 50 | 39 | 3 | 0 | 12 | 3 | 9 / 76 | 1069s |
| t12 0.52.13 opencode | **pass 112** | 110 | 60 | 28 | 4 | 0 | 2 | 5 | 2 / 41 | 1581s |
| t15 r1 | **pass 177** | 176 | 77 | 26 | 1 | 0 | 26 | 1 | 9 / 90 | 1110s |
| t15 r2 | **pass 146** | 143 | 43 | 40 | 2 | 1 | 0 | 2 | 9 / 85 | 853s |
| t15 r3 | **pass 89** | 88 | 30 | 42 | 0 | 1 | 1 | 1 | 14 / 55 | 560s |
| t15 第七轮 A | **pass 85** | 84 | 39 | 17 | 2 | 0 | 1 | 0 | 4 / 40 | 555s |
| t15 第七轮 B | **pass 67** | 64 | 22 | 12 | 7 | 0 | 0 | 0 | 6 / 36 | 356s |
| t15 0.52.13 opencode | **pass 55** | 53 | 23 | 15 | 1 | 0 | 0 | 1 | 0 / 28 | 419s |
| t14 旧题面 r1 | **pass 141** | 140 | 57 | 8 | 28 | 0 | 0 | 0 | 31 / 73 | 925s |
| t14 旧题面 r2 | **pass 71** | 69 | 24 | 9 | 2 | 0 | 8 | 2 | 5 / 23 | 502s |
| t14 新题面 r1 | **pass 59** | 58 | 20 | 10 | 1 | 0 | 9 | 2 | 3 / 20 | 404s |
| t14 新题面 r2 | **pass 41** | 40 | 12 | 7 | 1 | 0 | 6 | 2 | 6 / 15 | 253s |
| t14 新题面 r3 | **pass 57** | 54 | 12 | 7 | 2 | 0 | 10 | 5 | 10 / 17 | 314s |
| t17 旧题面 r1 | **pass 89** | 85 | 33 | 10 | 4 | 0 | 6 | 2 | 4 / 35 | 575s |
| t17 旧题面 r2 | **pass 63** | 61 | 25 | 12 | 0 | 0 | 2 | 1 | 8 / 19 | 400s |
| t17 新题面 r1 | **pass 37** | 36 | 13 | 8 | 0 | 0 | 2 | 5 | 4 / 10 | 257s |
| t17 新题面 r2 | **pass 53** | 51 | 16 | 13 | 0 | 0 | 9 | 2 | 11 / 12 | 323s |
| t17 新题面 r3 | **pass 48** | 47 | 10 | 5 | 0 | 0 | 11 | 7 | 4 / 7 | 294s |
| t14 指针回归 | **pass 42** | 40 | 10 | 5 | 2 | 0 | 7 | 2 | 3 / 17 | 240s |
| t17 指针回归 | **pass 42** | 41 | 17 | 11 | 0 | 0 | 0 | 5 | 3 / 13 | 260s |
| t14 0.52.13 canary r1 | **pass 53** | 52 | 23 | 8 | 1 | 0 | 10 | 3 | 5 / 18 | 273s |
| t14 0.52.13 canary r2 | fail 64 | 61 | 22 | 10 | 1 | 0 | 9 | 4 | 3 / 14 | 356s |
| t14 0.52.13 canary r3 | **pass 51** | 50 | 21 | 10 | 1 | 0 | 8 | 3 | 2 / 16 | 315s |
| t14 0.52.13 opencode | **pass 60** | 59 | 18 | 8 | 2 | 0 | 8 | 4 | 10 / 19 | 585s |
| t17 0.52.13 canary r1 | **pass 75** | 73 | 25 | 13 | 0 | 0 | 9 | 8 | 8 / 19 | 291s |
| t17 0.52.13 canary r2（capture 复用） | **pass 37** | 36 | 17 | 4 | 0 | 0 | 4 | 2 | 3 / 7 | 178s |
| t17 0.52.13 opencode | **pass 40** | 40 | 12 | 4 | 0 | 0 | 7 | 5 | 9 / 7 | 332s |

原始 run id：

- t11：`2026-11-16T10-45-11`（旧题面 71）、`11-09-17`（84）、`11-22-15`（r2 为 49）、`11-46-40`（77）
- t12：`12-10-08`（189）、`12-32-32`（160）、`13-37-29`（162）、`14-01-08`（178）、`14-29-56`（190）
- t15：`12-53-31`（r1/r2/r3）
- t14 旧题面：`2026-11-17T07-12-15`（141/71）；新题面：`10-14-28`（59）、`10-22-40`（41/57）
- t17 旧题面：`2026-11-17T07-39-05`（89/63）；新题面：`10-33-54`（37/53/48）
- 0.52.13 canary：t14 `18-20-17`（53）、`18-37-44`（64 fail：Sales series false）、`18-45-29`（51）、`20-19-28`（opencode 60）；t17 `18-25-41`（75）、`18-32-57`（37，capture 复用后）、`20-32-44`（opencode 40）、`21-36-14`（post-fix 86）、`2026-11-18T06-35-51`（capture-only 29）、`06-43-40`（capture-only t14 r1 76）、`07-06-08`（capture-only t14 r2 64 fail）；t11 opencode `19-20-34`（77）；t15 opencode `19-37-43`（55）、`07-29-55`（capture-only 52 fail）；t12 opencode `19-51-11`（112）、`08-14-46`（capture-only t11 76 / t12 98）、`10-26-53`（回执修复后 t11 70 / t12 100）

## 2. t11：不是“不会画”，是焦点 + 首次拖拽 + 状态判定

### 2.1 84 步 pass 的时间线

- 0–144s：观察 Paint AX/native/catalog。AX 树一开始只有 43/44 个元素，调色板不在树里；force/全量观察后才出现 85 个元素。模型用 native 截图反推画布位置。
- 144–200s：第一次 `computer_drag(956,679→1156,819)` 返回 unverified，native 仍是空白；`computer_activate` 后重试，第二次 foreground drag 才画出红色矩形。
- 200–509s：椭圆和直线各需要 1–2 次重试，最终 **12 次 drag 画完 3 个形状**。
- 544–734s：保存。`Ctrl+Shift+S` 没有打开对话框，模型改用 File 菜单 → Enter 展开 PNG 子菜单 → Save As；文件名/保存类型输入又因焦点错误走错窗口，靠 native 截图和绝对坐标才保存。

关键行为：模型从状态栏坐标反推画布原点：drag 起点 `956,679`，状态栏 `77,79` → 原点 `879,600`。这是它后来能精确画椭圆/直线的关键。

### 2.2 77 / 76 / 70 步 pass 的差异

- 开头同样遇到“调色板不在 AX 树”，模型用 `screen_observe(query="色")` + 全量 observe 恢复 87 个元素。
- 它总结出 **第一次 drag 只把光标移到起点、不真正画**：背景 drag 无效果，`activate` 后第一次 foreground drag 仍空白，第二次 foreground drag 才出现形状。
- 后续椭圆/直线主动重复 drag，7 次完成 3 个形状，比 84 步少。
- 保存阶段仍然很贵：Save As 对话框的 `Ctrl+A`/输入被主窗口或导航树抢走；模型用 native 截图确认“out 文件夹、文件名、PNG 类型”，最后点击保存时出现 `window_target_not_found`，但文件实际已保存。
- capture-only 复跑 **76 步 / 1224s / 3 tool errors / 24 unverified**（另有 2 次 `screen_observe` 窗口标识失败）：38 observe、16 click、6 drag、5 activate、3 zoom、1 type；仍是 activate → 画布焦点 click → drag 的纪律，红/蓝各重画一次后三色 ROI/coverage/precision 全绿。错误集中在 `snapshot_missing`/`snapshot_mismatch` 与 `screen_observe(window="17306228"/"s4-t11-canvas")`（数字/标题当窗口标识），按拒绝文本改走窗口列表后恢复；无 `screenshot_context_missing`/`stale_element_token`。
- 回执修复后 **70 步 pass**：native/vision 文本带当前快照 id 后不再猜 `snapshot_id`，`snapshot_mismatch` 为 0；剩余 1 次 TTL、1 次 `window_target_not_found`、2 次保存后标题观察失败，均 1 步恢复。

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

### 3.3 capture-only 复跑：98 步 pass

- 41 次 observe、24 次 click、11 次 key、7 次 type、5 次 right-click、3 次 activate、3 次 double-click、1 次 set_value；没有 drag。
- 1378s、6 tool errors、44 unverified；报告的错误为 2 次 `snapshot_expired`、2 次 `snapshot_mismatch`、1 次 `foreground_unavailable`（PPT 精确 HWND 未激活）、1 次 `window_target_not_found`（`bring_to_front` 失败），另有 1 次 key `delivery_failed` 与 1 次 `screen_observe` 窗口查找失败；模型用 observe/activate/foreground 重试恢复。
- oracle 13/13 全 true（1 页、16:9、title/subtitle、Q1-Q3、三色柱）。比 112 步样本少 14 步、墙钟少 203s；没有 `screenshot_context_missing`/`stale_element_token`，capture-only 没有改变 PowerPoint 的格式面板/前台锁成本结构。

### 3.4 t12 根本问题

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

| 优先级 | 改动 | 状态/依据 |
|---|---|---|
| **P0** | `computer_click`/`double_click`/`right_click` 加 `modifier` | **已实现并真机验证**（element/坐标两条路径，Ctrl 到达目标） |
| **P0** | `computer_drag` 加 `from_zoom`/`steps` | **已实现**；拖拽起点/终点按 zoom 图坐标映射，steps 1–200 |
| **P0** | `computer_drag` 加 `modifier` | **第八轮已私有实现**：driver 0.23.2 schema 接受但真机 `Control.ModifierKeys` 全是 `None`；改走 `tools/private-drag.ps1` 原子 SendInput（t11 题面仍不用 Shift，避免改变任务） |
| **P0** | t15 用 Ctrl+click 批量跑 3–5 次 | **已跑**：3/3 pass，77/72/59 步，各 5 次 Ctrl+click；见 §9.1 |
| **P1** | t11 题面加“activate + 画布焦点 click + foreground 重试”；固定线宽/原点 | **已完成**：setup 用 AX `大小` 固定 8px，题面给精确画布原点；3/3 pass，70/88/48 步；见 §9.2 |
| **P1** | t12 35–40 分钟；白底 seed + 预填 title/subtitle/占位柱；按形状名选择/直接输入标签 | **已完成**：白底 seed + 直接输入；**2/2 pass，140/169 步**，oracle 全绿；oracle 颜色目标未改；见 §9.3 |
| **P1** | native screenshot freshness probe | **已完成**：WinForms 文本变化窗口未复现陈旧；t11 的 hash 现象保留为待复现 |
| **P2** | `selectText`/key hold/drag-from-element、Explorer spring-loaded dwell、多显示器 frame | 未做；当前 Cut/Paste 与坐标/AX 元素路径足够 |

## 8. 证据边界

- 原始 report/trajectory 在 gitignored 的 `evals/headless-runs/`；本文不提交截图/文档正文/模型原始 thinking。
- ZCode CU 探针是能力验证，不是完整 t11/t12/t15 的通过/失败统计；完整三题仍需按本插件 eval 框架重跑。
- native 截图“陈旧”目前是轨迹中的直接观测证据 + 模型自身判断；`evals/probe-native-freshness.mjs` 在 WinForms 文本变化窗口上未复现（driver 截图 hash 与插件 native 字节数都随文本变化）。修复前不要把它写成已证实的普适 bug。
- t12 的 PowerPoint 行为来自本机 Office 16 / Windows 11 / 150% DPI，其他环境可能不同。

## 9. 2026-11-17 手势轮复跑

### 9.1 t15：Ctrl+click 已可用，真正的坑是后台点击会打开文件

- 第一次复跑（未改题面）在 54 步时被中止：模型用了 6 次 Ctrl+click，但普通文件单击走 `background`，driver 的 UIA hit-test/Invoke 把 `report-draft.txt`、`alpha.txt`、`chart.png` 当成“默认动作”打开，弹出了 Notepad/Photos（还激活了一个用户 PDF 窗口）。这不是模型双击，而是后台点击语义。
- 题面加入“文件单选必须 `foreground=true`”后，第二次复跑不再打开任何 Notepad/Photos；但 F2 编辑框保留了 `.txt` 扩展名，输入 `report-final.txt` 得到 `report-final.txt.txt`。
- 题面再加入“F2 后先 Ctrl+A 全选含扩展名，再输入完整文件名；若变成 `.txt.txt` 再改回”后，**3/3 pass**：77/72/59 steps（5/5/5 次 Ctrl+click；29/28/24 observe），文件树与内容全部正确，无 Notepad/Photos 误开，dirty=false。相比 2026-11-16 的 177/146/89 步，中位从 146 降到 72。
- 2026-11-17 第七轮：forced click 原先在 unverified 时被 L3 重试，t15 的 16 次 foreground click 全部重试、单次约 9s；改为前置单次后 **85/67 steps pass**（第二轮 5 次 Ctrl+click 批量，明显快于逐文件剪切）。8 文件/内容/旧路径全 true。

### 9.2 t11：先修的是画布原点和线宽，不是提示词气势

- UIA 实测：最大化 Paint 的画布是 `(879,600) 800x600` window-screenshot 像素，1:1，没有 150% DPI 放大。两轮失败轨迹用的原点是 `(872–875, 594–595)`，偏 4–7px；同时默认线宽太细，导致 `visible/bbox/area` 全过、`reference coverage` 全 false。
- Paint 的 AX `大小` 按钮可打开 `3/5/8 像素` 菜单。setup 现在依次选中 `矩形/椭圆/直线`，用 UIA TogglePattern + MenuItem Invoke 把三者都设为 `8 像素`，再回到矩形；题面不再让模型碰 `大小`。
- 修正后 **3/3 pass：70/88/48 steps**（68/85/47 inner；5/6/3 drags；`activateBeforeFirstDrag`/`focusClickAtDragStart` 均 true，app_launch=0）。之前 1:1 失败轮是 99 steps；setup 固定线宽 + 精确原点把无效重画压掉了。
- 2026-11-17 第七轮回归发现：forced drag 的 L3 重试把单次拖拽变成约 9s、同一形状画两遍；模型看到重复图形后尝试 `ALT+SHIFT+NUMLOCK`、打开“设置 → 鼠标键”，离题。改为 **先 bring_to_front → 只拖一次 → 恢复原前台** 后 **58 steps pass**；再把 forced click/scroll 也改为前置单次后 **94 steps pass**（17 clicks、24 zoom、7 activate；方差仍大）。两轮三色 ROI/coverage/precision 全绿；Mouse Keys 侧效应已关闭并复核。
- 注意：UIA 同名元素会同时出现 `ListItem`（只支持虚拟化）和真正的 `ToggleButton`；helper 必须遍历同名元素并依次尝试 Invoke/Toggle/SelectionItem/Legacy，否则会在 ListItem 上误判“不支持的模式”。

### 9.3 t12：白底 seed + 直接输入标签，首次真机通过

- 白底 seed 只保留 title/subtitle 占位符和三条灰柱，模板装饰被裁掉；setup 用 `TitleNeedle='replica'` 记录加载完成的窗口，AC2 setup 无修复对话框。
- 题面按 AX 形状名选择 `S4 Bar Q1/Q2/Q3`；红/蓝用标准色，绿用主题色；双击柱直接输入 Q1/Q2/Q3（不再插入文本框）；每柱后保存；颜色/格式对话框关闭后 `computer_activate` 主窗。
- 40 分钟预算下 **2/2 pass，140/169 steps**（139/168 inner；2 errors；71/96 unverified）。两轮 oracle 都是 hash 变化、1 页/16:9、title/subtitle/Q1/Q2/Q3、red/blue/green bar 全 true。此前 25 分钟/190 步只完成 red/blue + Q1；白底 seed 和直接输入把剩余两条柱压进了预算。
- 2026-11-17 第七轮：forced pointer 前置单次后复跑 **1/1 pass，152 steps**（150 inner；50 observe/39 click/29 key/12 zoom/7 double-click/5 set_value；1069s）；1 页/16:9/Q1-Q3/三色柱全 true。仍在 40 分钟预算内，组合键前台与 type 保留快照未破坏 PowerPoint 路径。

### 9.4 t14：Excel 表格+原生柱状图

- 首轮（原题面）24 个单元格、原生 barChart、标题 `S4 Sales`、Sales 系列全过，唯一失败是 `Month categories=false`：模型没选数据范围就插图表，走了“选择数据源”。
- 名称框和“提前 Save As”两个变体都回退：名称框/Go To 绕步多；提前保存让模型逐格输入，最终输出还是空白。
- 最终题面：先输表，点 A1 → `Ctrl+Shift+End` 选 A1:D6 → `Alt+F1` → 标题 `S4 Sales` → 最后 Save As；25 分钟预算。oracle 同时接受 `catFormula` 含 A2 或图表缓存里的 Jan..May 分类。
- 结果：**2/2 pass，141/71 steps**；24 格、barChart、标题、Sales 系列、Month categories 全 true。
- 2026-11-17 第七轮：`deliveryFailure` 对 `background_delivery_failed` 改用词边界（此前 26/28 次 type 假“未送达”），组合键自动前台，题面改为剪贴板 TSV + 功能区 Paste、activate/wait、A1 用 zoom/from_zoom、Save As 用 `computer_set_value`。**3/3 pass，59/41/57 steps**（404/253/314s）；`typeCalls=1/1/2`（只剩图表标题），`clipboard=1`，`activate=2/2/5`，`wait=2/2/0`；24 格/barChart/标题/Sales/Month 全 true，seed unchanged。
- 残留：驱动仍会在少数 type/key 上返回精确 `delivery_failed`（本轮 0/3/5 次），文字实际已落、模型靠 observe 恢复；下一轮可评估“type 的 delivery_failed 降级为未验证”，而不是继续当硬失败。
- 后续 forced pointer（click/scroll/drag）全部改为前置单次后复跑：**42 步 pass**（240s，typeCalls=2、deliveryFailures=0、click=5、zoom=7）；说明去掉失败后重试不会破坏表格/图表路径。

### 9.5 t17：PDF 单行句子用三击比“文本选择原语”更实际

- Chrome setup 窗和用户 Firefox 同时存在；模型把测试 PDF 开进了用户 Firefox 的一个新标签（Firefox 主窗口有 8 个标签，测试页被选中）。
- 题面要求三击句子（`computer_click(count=3)`）+ Ctrl+C，禁止 Ctrl+A；Excel 先 Save As `out\excerpt.xlsx`，再 Ctrl+V，最后 Ctrl+S。
- 结果：**2/2 pass，89/63 steps**，A1 两次精确匹配。模型最后用 `computer_clipboard` 回读剪贴板，确认是完整句子。
- 2026-11-17 第七轮：题面写死“只用 setup 打开的浏览器，禁止在 Firefox/其它浏览器打开 PDF”；先 activate + wait 2000-4000ms，空白时 force observe + reload；Excel 文件名用 `computer_set_value`；A1 用 zoom/from_zoom。setup 新增 UIA page-3 readiness（`S4-T17:`），oracle 去掉 Trim 并校验 seedHash。**3/3 pass，37/53/48 steps**（257/323/294s）；`typeCalls=0`、`clipboard=1`、`activate=5/2/7`、`wait=1/1/7`；A1 exact 三次，seed unchanged；用户 Firefox 仍 8 个标签，无 `s4-t17` 测试标签。
- 残留：r2 有 3 次 delivery/stale/snapshotMismatch、9 次 zoom、3 次 repeat_suppressed，主要来自 Save As 文件名/A1 坐标的重复尝试；r3 用 7 次 activate + 7 次 wait 规避。下一步可把“Save As 对话框出现后先 activate 再 set_value”写得更硬，或给对话框场景增加 `wait_for` 谓词。
- 后续 forced pointer 前置单次后复跑：**42 步 pass**（260s，typeCalls=0、deliveryFailures=0、click=11、activate=5、wait=2、A1 exact）；与 37/53/48 同一量级，说明去掉失败后重试未破坏 PDF/Excel 路径。
- 清理：不能关 Firefox 窗口/进程（会带走用户标签）。旧轮跑完后在“测试标签仍被选中”时发一次 Ctrl+W，只关测试标签；确认选中态变成用户标签、窗口仍有 7 个用户标签。新题面下不再产生测试标签，cleanup 只关 setup Chrome。

## 10. 2026-11-18 0.52.13 + opencode-go canary 复盘

### 10.1 运行集

五个目标任务在 `cua-driver 0.52.13` + `opencode-go / deepseek-v4.1-flash` 上全部通过；同一题面在 DeepSeek 官方通道上有 t14 2/3、t17 37/75 的历史样本。opencode 样本不是受控 A/B：桌面脏状态、模型采样和驱动 0.52 的 capture 行为都会影响步数。

| 任务 | 结果 | 步数 | 时长 | observe | click | type | drag | zoom | activate | errors / unverified | oracle |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| t11 Paint | pass | 77 | 929s | 46 | 17 | 0 | 5 | 0 | 5 | 4 / 20 | 白底/红蓝黑 ROI 全 true |
| t12 PowerPoint | pass | 112 | 1581s | 58 | 28 | 4 | 0 | 2 | 5 | 2 / 41 | 1 页/16:9/文本/三色柱全 true |
| t14 Excel | pass | 60 | 585s | 18 | 8 | 2 | 0 | 8 | 4 | 10 / 19 | 24 格/barChart/标题/Sales/Month 全 true |
| t15 Explorer | pass | 55 | 419s | 23 | 15 | 1 | 0 | 0 | 1 | 0 / 28 | 所有文件/旧路径 true |
| t15 Explorer | fail（capture-only） | 52 | 1200s | 18 | 3 | 1 | 0 | 6 | 3 | 8 / 11 | 文件未移动/改名；模型未用 Ctrl+click |
| t17 PDF+Excel | pass（pre-fix） | 40 | 332s | 12 | 4 | 0 | 0 | 7 | 5 | 9 / 7 | A1 exact、seed unchanged |
| t17 PDF+Excel | pass（post-fix） | 86 | 885s | 34 | 17 | 4 | 0 | 0 | 3 | 1 / 37 | A1 exact、seed unchanged |
| t17 PDF+Excel | pass（capture-only） | 29 | 335s | 9 | 5 | 1 | 0 | 4 | 2 | 2 / 10 | A1 exact、seed unchanged |
| t14 Excel | pass（post-fix） | 59 | 633s | 18 | 8 | 3 | 0 | 6 | 4 | 9 / 21 | 24 格/barChart/标题/Sales/Month 全 true |
| t14 Excel | pass（capture-only r1） | 76 | 1058s | 23 | 18 | 2 | 0 | 6 | 3 | 6 / 26 | 24 格/barChart/标题/Sales/Month 全 true |
| t14 Excel | fail（capture-only r2） | 64 | 970s | 21 | 6 | 6 | 0 | 5 | 2 | 11 / 27 | 单元格全 false；图表 title/categories true；Paste 未落 |

> `pre-fix` = `pointerCaptureReady` / 裸 code 拒绝修复前；`post-fix` = 修复后。t11/t12/t15 未在 post-fix 重跑，但它们没有 `screenshot_context_missing` 假成功路径。

### 10.2 任务级模型行为

**t15（最干净样本 55 步 / 0 任务错误；capture-only 复跑 52 步 fail）**

- 第一次 activate 后直接进入 Explorer 文件列表；用 `F2 → Ctrl+A → type → Enter` 原地改名，避免了另存为/扩展名问题。
- 分组用 **Ctrl+click**（5 次），`Ctrl+X → 导航目标文件夹 → Enter → Ctrl+V` 循环三组；共 15 次 click、12 次 key、1 次 type。
- 28 次动作全部前台（`delivery:foreground=28`），但 0 delivery failure；文件单选的 `foreground=true` 是必要的，后台 UIA Invoke 会把文件当默认动作打开。
- 23 次 observe、21 次 changed observe；模型不是盲目重试，每一步都在确认文件列表/文件夹切换。没有 zoom、没有 drag、没有错误恢复，是五条里最接近“题面即策略”的一条。
- capture-only 复跑（52 步 fail）：模型没有使用 Ctrl+click，先用 `screen_zoom` 裁 550px（>500 被拒），随后只选中一个文件反复 F2/右键，最终没有完成 docs/images/archive 移动；错误为 zoom 过宽、snapshot 过期、`screen_observe(pid)` 未知参数。文件操作未发生，不是 capture/token 兼容错误；t15 的方差来自文件列表选择策略。

**t11（77 步 pre-capture；capture-only 76 步；回执修复 70 步）**

- 模型在每次 drag 前都先 `computer_activate`，再点一次画布 `(959,690)` 取得焦点；5 次 drag 对应三色图形，其中红/蓝各重画一次。`activateBeforeDrag=true`、`focusClickAtDragStart=true`，说明它已经学会“画布 drag 需要前台+焦点”，但每个图形都重复一次，成本高。
- 46 次 observe 中有 12 次 native、4 次 query；模型频繁用截图/过滤树确认颜色、线宽和图形是否出现。`computer_drag` 平均 7.8s，是工具耗时最高的项。
- 3 个快照类错误都恢复了：无快照点击、矩形工具的 `stale_element_token`、`snapshot_mismatch`；最后的 `screen_observe(window="s4-t11-canvas")` 失败是因为保存后窗口标题变成 `replica.png`，不是图形失败。
- 结论：t11 的主要成本不是“不会画”，而是**焦点纪律 + 每步视觉确认**；forced drag 前置单次已经避免了双画，但模型仍会主动重复 activate/focus。
- capture-only 复跑 76 步 / 1224s / 3 tool errors / 24 unverified（另有 2 次 `screen_observe` 窗口标识失败）：38 observe、16 click、6 drag、5 activate、3 zoom；activate → 画布焦点 click → drag 的纪律不变，红/蓝各重画一次，oracle 22/22 全 true。错误为 snapshot_missing/mismatch 与 `screen_observe(window="17306228"/"s4-t11-canvas")`（数字/标题当窗口标识），按拒绝文本恢复；无 capture/token 兼容错误。
- 回执修复后 **70 步 / 1000s / 3 tool errors / 31 unverified**：28 observe、22 click、4 drag、4 activate、3 zoom、4 type、4 key；`snapshot_mismatch` **0**（此前 2 次）；仍有 1 次 `snapshot_expired`、1 次 `window_target_not_found`、2 次保存后窗口标题观察失败（`..png`/`另存为` 已关闭），均 1 步恢复；oracle 22/22。

**t12（112 步 / 1581s / 41 unverified；capture-only 98 步；回执修复 100 步）**

- 58 次 observe、26 次 native、15 次 query；模型用原生截图和 query 反复检查幻灯片对象/文本框，而不是只靠 AX 树。28 次 click、8 次 key、4 次 type、2 次 double-click、1 次 set_value；没有 drag。
- 41 次 unverified 全部来自 PowerPoint 的前台文本/形状/格式动作；0 delivery failure，说明动作都送达，只是应用不提供可验证回执。oracle 通过，模型用 native/query 自行确认。
- 与 DeepSeek 的 t12（152 步/1069s；39 click/29 key/12 zoom/5 set_value/77 unverified）相比：opencode 少 40 步、少 11 次 click、少 21 次 key、少 10 次 zoom，但多 9 次 native、15 次 query，墙钟反而多 512s。**步数更省，单步更贵**。
- 两个 `snapshot_missing` 都是“先点后观察”的顺序错误，模型立即补 observe；没有 stale/mismatch。
- capture-only 复跑 98 步 / 1378s / 6 tool errors / 44 unverified：41 observe、24 click、11 key、7 type、5 right-click、3 double-click、1 set_value；错误为 snapshot_expired/mismatch、`foreground_unavailable`、`window_target_not_found`，另有 1 次 key `delivery_failed` 与 1 次 `screen_observe` 失败，均恢复；oracle 13/13 全 true。比 112 步少 14 步，仍没有 drag，格式面板/前台锁成本结构未变。
- 回执修复后 **100 步 / 1781s / 3 tool errors / 44 unverified**：45 observe、27 click、10 key、5 type、3 double-click、2 set_value、5 activate；`snapshot_mismatch` **0**（此前 2 次）；仍 2 次 `snapshot_expired`、1 次 query 后 `snapshot_missing`（模型在 `query:"重复"` 后仍用旧 id，未读“旧动作快照已清除”）、前台锁；oracle 13/13。

**t14（60 → 59 步）**

- 策略完整贴合题面：`clipboard write` TSV → A1 zoom/from_zoom → 功能区 Paste → `Ctrl+Shift+End` → `Alt+F1` → 双击标题 → `Ctrl+A`/type → `F12` Save As → `set_value` 文件名 → `Ctrl+S`。
- 8 次 zoom（A1、Paste、图表区、标题、保存对话框）；3 次 wait；4 次 activate。`clipboard=1/2`、`type=2/3`，没有逐格输入。
- pre-fix 10 errors 中有一组 `foreground_unavailable`/`bring_to_front` refused（F12/Ctrl+S 期间另一个窗口持有前台），还有 2 次 `delivery_failed` key、2 次 snapshot expired、2 次 stale、2 次 mismatch、1 次 zoom 宽 1090>500、1 次把数字当窗口标题。模型全部通过 observe/activate/foreground 恢复。
- post-fix 59 步、3 refusals、7 delivery failures、0 stale/mismatch；capture 预取把 stale/mismatch 换成了更多“未送达→前台重试”，最终 oracle 全 true。说明修复改变了失败分布，但没有破坏任务路径。
- capture-only r1：76 步 pass，24 格/图表全 true；23 observe/18 click/12 key/6 zoom；4 次 snapshot_expired 是长流程 TTL，不是 token 失效。
- capture-only r2：64 步 fail，单元格全 false、图表 title/categories true。轨迹显示首次点击/粘贴目标偏离，随后把空区域做成图表；`computer_type` 多次 delivery_failed，保存前没有核对表格。没有 `screenshot_context_missing`/stale 假成功；判为模型粘贴目标与保存路径失败，不是驱动兼容错误。

**t17（pre-fix 40 步；post-fix 86 步；capture-only 29 步）**

- pre-fix：三击 PDF 句子 → `Ctrl+C` → `clipboard read`；Excel `F12` → A1 `from_zoom` click → `Ctrl+V` → `Ctrl+S`。7 次 zoom、5 次 activate、9 个错误（多数是 schema/前台锁），A1 exact。
- pre-fix 的关键问题在 seq 74-76：Save As 对话框 native observe 后，模型做像素 click `(1024,787)`，驱动返回 `{"code":"screenshot_context_missing","reason":"no_screenshot"}`，但 `engineRefusal` 不认识裸 `code`，`settleAction` 把回执写成 **“点击完成”**。动作没有发生，回执却像成功——这是本轮轨迹复盘发现的最严重真实性问题。
- post-fix：原生截图不再被当作 click capture；像素动作前 `pointerCaptureReady` 为 false，插件补 `get_window_state(include_screenshot:true,max_elements:1)`；裸 `screenshot_context_missing` 按拒绝上报。模型改走“F12/文件名/手动输入+退格”路径，0 zoom、17 次 key、4 次 type、8 次 wait，86 步仍 pass，且只有 1 个 `snapshot_missing`，没有假成功。**真实性修好了，代价是模型选了更啰嗦的保存/输入路径**；这是模型方差，不是驱动兼容回归。

### 10.3 错误分类（去掉启动 cursor theme 噪声）

| 类别 | 证据 | 根因 | 模型恢复 | 插件动作 |
|---|---|---|---|---|
| 启动 cursor theme（修复前） | 早期轨迹每条 1 次 `set_agent_cursor_theme` 失败（rainbow 未安装） | 环境主题缺失 | 不影响任务 | 默认已改为 `cua.default`，失败回退 `cua.default`；capture-only 轮不再出现 |
| 快照守卫 | `snapshot_missing`（t11/t12/t14/t17）、`snapshot_expired`（t14）、`stale_element_token`（t11）、`snapshot_mismatch`（t11/t14） | 模型先点后观察、旧 snapshot_id、capture 预取替换 index map | 重新 observe，1–2 步 | 守卫按设计 fail-closed；`markTokensStale` 让旧编号明确失效 |
| 前台锁 | t14 `foreground_unavailable` + `bring_to_front` refused；t17 两次 activate refused；`delivery_failed` key | Windows 前台锁/另一个窗口（ZCode/Chrome/对话框）持有前台 | `computer_activate`、foreground 重试、重新 observe | L3 已尽力；拒绝时不假装成功 |
| 参数 schema | t17 `screen_zoom(x,y,width,height)`、`computer_activate(foreground)`、`computer_key(pid,window_id)`；t14 capture-only r1 `computer_click(window_id)`；zoom 宽 1090/700>500 | 模型套用了别的工具的参数 | 按拒绝文本重发，1 步 | 保持拒绝；新增 `PARAM_HINTS` + `computer_do` 常用参数速查，不自动改写参数 |
| 数值当窗口标题 | t14 `window:"2231898"`、t17 `window:"7081698"`；t11 `window:"17306228"` | 模型把 window_id 填进 window | 候选列表后改用 window_id/标题 | fail-closed，不静默回退；`window`/`window_id` 失败提示已按来源区分 |
| native/视觉观察无 snapshot id | t11 step 59→60（s28f vs s290）、step 65→66（s294 vs s295）；t12 step 9→10（s29e vs a0）、step 17→18（a3 vs a4） | `renderObserveText` 只在 ax 分支打印 `snapshot_id`，native/vision 文本没有；模型只能沿用/猜序号 | 重新 observe，1 步恢复 | **已修**：native/vision 文本回显 `快照 s...；全局单例`；回执修复后 t11/t12 mismatch 均为 **0** |
| query 清除旧快照未说明 | t11 step 19 drag `snapshot_missing` | query 会 `clearSnapshot()`，但文案只说“未建立动作快照” | 全量 observe + 带 snapshot_id 重试，1 步 | **已修**：query header/footer 明确“旧动作快照已清除” |
| 密码框值回显 | 静态审计发现 `describeClickTarget` 对 Edit 回显 value，未检查 `is_password` | 快照存了密码值，回执可能带出 | 不适用 | **已修**：密码框回执输出 `值（已隐藏）` |
| `screenshot_context_missing` | t17 pre-fix seq 74-76 | native 截图被误当 click capture；裸 code 未被识别 | 重新 observe/zoom | **已修**：`pointerCaptureReady` + `engineRefusal` 裸 code |

### 10.4 轨迹驱动的修复

本轮不是“看代码猜问题”，而是从 t17 pre-fix 轨迹里拿到了具体反例：

1. **native 截图 ≠ 像素动作 capture**：`cacheSnapshot` 原来用 `hasCapture = capture_id || screenshot_png_b64`；native observe 有截图，于是 `ensurePointerCapture` 跳过预取。但 0.52 的 click 仍报 `no_screenshot`。现在新增 `pointerCaptureReady`，只有 `ensurePointerCapture` / `screenZoom` 显式建立 capture 后才为 true；native 截图只用于模型展示，不再冒充点击上下文。
2. **裸 `code` 拒绝必须 fail-closed**：`engineRefusal` 原来只认 `effect/status/refusal/ok:false/error_code` 和三个 code；`screenshot_context_missing` 落到了成功分支。现在 `FAILURE_CODES` 包含 `screenshot_context_missing`、`window_target_not_found`、`target_not_found`、`stale_element_token`、`element_not_visible`、`menu_path_unavailable`，裸 code 也会返回拒绝。
3. **测试锁住**：`action.echo` E31/E32 覆盖裸 `screenshot_context_missing` / `window_target_not_found` 回执；`action-bounds` D11/D12 覆盖 capture-only 预取与 token 保留；`config.plumbing` B12-B16 覆盖参数误用提示与数字 window 提示；`delivery.failures` 覆盖前台锁提示。离线 26 套 / **634** 项全绿。
4. **post-fix 真机**：t17 86 步、1 个 snapshot_missing、0 假成功；t14 59 步、0 stale/mismatch、oracle 全 true。t14/t17 都仍 pass。
5. **capture-only 验证**：0.52+ 改用 `include_accessibility_tree:false` 后，t17 从 86 步降到 **29 步**（9 observe/5 click/4 zoom/1 type；A1 exact、0 假成功）；token 不再因像素预取而失效，模型回到 zoom/from_zoom 路径。2 个错误是 1 次 snapshot_missing + 1 次 snapshot mismatch，均在 1 步内恢复。 t14 capture-only r1 **76 步 pass**（全 true）；r2 **64 步 fail**（单元格全 false，粘贴目标偏离后把空区域做成图表；非兼容错误），说明 t14 仍是高方差任务，capture-only 不保证每次路径稳定。
6. **观察回执状态缺口（2026-11-18 复盘）**：对照 t11/t12 原始 session 发现，4 次 `snapshot_mismatch` 都紧跟在 native/native 降级观察之后；native 文本不打印新 snapshot id，模型只能沿用或猜序号（t11 step 15 猜对 s27c，step 60/66 猜错，t12 step 10 跨窗口仍用 PowerPoint 旧 id）。另有 1 次 `snapshot_missing` 来自 query 清空快照但文案未说明。修复：`renderObserveText` 的 native/vision 分支回显 `快照 s...；全局单例`；query header/footer 明确“旧动作快照已清除”；数字 `window`/`window_id` 提示按来源区分；`snapshot_mismatch` 拒绝文本带当前快照的 app/title/pid/window_id；密码框点击回执改为 `值（已隐藏）`。测试新增 C19/C20、T21 断言、B15b、E33、A18，离线 26 套 / 634 项；真机 `verify-runtime` 18/18（新增 native 文本 id 检查）。回执修复后 t11 **70 步 pass**、t12 **100 步 pass**，两者 `snapshot_mismatch` 均 **0**；t12 仍有 1 次 query 后 `snapshot_missing`（模型未读清除提示）和 2 次 TTL。

### 10.5 跨 provider 对比（同题面、非受控 A/B）

| 任务 | DeepSeek 官方 | opencode-go | 观察 |
|---|---|---|---|
| t11 | 58 / 94 步 | 77 步 / capture-only 76 / 回执修复 70 步 | 回执修复后 mismatch 0、步数下降；方差仍来自 activate/focus 重复 |
| t12 | 152 步 / 1069s | 112 步 / 1581s；capture-only 98 / 回执修复 100 步 | 回执修复后 mismatch 0，但 query 后旧 id 仍多花 1 步；native/query 多、单步更贵 |
| t14 | 53 / 51 pass，64 fail | 60 / 59 / 76 pass，64 fail | 两边都有失败样本；t14 是高方差任务，capture-only 不改变粘贴目标选择 |
| t15 | 85 / 67 步 | 55 pass / 52 fail | 最好样本更省 click/key；capture-only 复跑未用 Ctrl+click，失败是文件选择策略 |
| t17 | 37 / 75 步 | 40 步（pre-fix）/ 86（post-fix） | 最好样本同量级；post-fix 走手动输入路径，真实性优先 |

结论：**没有“opencode 一定更快”**。opencode 在 t12/t15 更省步数，t11/t14/t17 与 DeepSeek 同量级或略慢；capture-only 后 t12 98 步 / 1378s、回执修复后 100 步 / 1781s，说明长流程墙钟仍受 native/query 与前台锁影响。驱动兼容层对两个 provider 的行为一致，差异主要来自模型策略。

### 10.6 剩余摩擦与建议

1. **启动主题错误是噪声**：每轮 `set_agent_cursor_theme` 失败 1 次；如果主题未安装，建议插件静默或降级为空主题，避免轨迹 error 计数虚高。
2. **前台锁是环境成本**：t14/t17 的 `foreground_unavailable` 多发生在 F12/另存为/对话框；L3 有时被系统拒绝。模型已学会 activate/重新 observe，不建议再加自动重试（会重复点击/重复输入）。
3. **工具描述可更明确**：t17 的 `screen_zoom(x,y,width,height)`、`computer_activate(foreground)`、`computer_key(pid,window_id)` 都是 1 步可恢复的 schema 误用；在描述里给一个参数示例即可降低。
4. **`markTokensStale` 是必要代价**：像素 capture 预取会替换驱动 index map，旧编号必须失效；模型重新 observe 的 1–2 步是正确行为，不应为了省步数而保留陈旧编号。
5. **t17 capture-only 的 29 步**：capture-only 保留 token 后，模型回到 zoom/from_zoom 路径；不需要任务级提示。t14 capture-only 仍有 76 pass / 64 fail，失败是粘贴目标选择，不是 capture/token 问题。
