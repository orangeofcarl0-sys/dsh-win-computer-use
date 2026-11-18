# TRAJECTORY-ANALYSIS — 模型行为与失败模式

> 目的：分析 t11/t12/t14/t15/t17 上模型“怎么用工具、为什么失败、哪些是插件缺口”；原始逐轮数据见 [EVIDENCE](EVIDENCE.md)。
> 读者：架构/评测/维护者。
> 状态：研究分析（数据截至 2026-11-18；结论随模型/驱动版本变化）。
> 相关：[CU-RESEARCH](CU-RESEARCH.md) · [TESTING](TESTING.md) · [WINDOWS](WINDOWS.md) · [EVIDENCE](EVIDENCE.md)。

## 1. 方法与证据边界

- 对象：dsh 0.2.2-rc.1 + 本插件，Windows 11 x64 / 150% DPI / dirty 桌面；驱动 0.23.2 与 0.52.13；模型 DeepSeek 官方与 opencode-go/deepseek-v4.1-flash。
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
