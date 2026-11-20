# EVIDENCE — 按日期归档的运行证据

> 目的：保存逐轮步数、探针结果、一次性结论与失败样本；**不描述当前实现**。当前行为见 [README](../README.md) 与各参考文档。
> 状态：历史证据（append-only；最后追加 2026-11-20）。
> 相关：[VERIFICATION](../VERIFICATION.md)（当前矩阵）· [TESTING](TESTING.md)（测试方法）· [TRAJECTORY-ANALYSIS](TRAJECTORY-ANALYSIS.md)（模型行为分析）。

## 1. 证据约定

1. **失败也记录**：超时、环境态失败、驱动缺陷、模型策略失败都保留；修复后保留根因与守门测试。
2. **测量产物不入库**：`evals/headless-runs/`、`report-last*.json`、trajectory JSONL、截图、工作区探针均在仓库外或被 gitignore；本文件只保留摘要与可复现命令。
3. **环境态与插件缺陷分开**：setup ENV、应用缺失、网络不可达、临时 `TEMP` 问题不混入 pass/fail；AC2 `SKIP` ≠ PASS。
4. **日期是运行日期**，不是文档修改日期；环境列写驱动/模型/宿主版本。
5. **“当时”标注**：数字随版本变化（如隐藏工具数），历史记录保留当时值并标“当时”。
6. **标签变更（2026-11-19）**：旧 `S4` 改称 `eval`；旧 `S2` 改称“像素定位修订”；`S3a`/`S3b` 改称“视觉断言协议”/“独立观察者”。只改标签，不改日期、命令、结果与 run id。

## 1.1 2026-11-20 — P1/P2 测试收口

环境：Windows 11 x64，DPI 150%，dsh 0.2.2-rc.1，cua-driver 0.52.13；opencode-go/deepseek-v4.1-flash；默认 deepseek-official/deepseek-flash（本次 `QUOTA` 402）。

- **AC2 全量**：`node evals/verify-oracles.mjs` → **22/23 PASS + t13 SKIP**；0 FAIL/ENV/dirty（`evals/verify-runs/2026-11-19T17-19-58`）。
- **oracle mutation**：三批 7+6+6 = **19/19**；t04/t07 live GUI、t13 ac2:none 按原因 SKIP。所有变异产物被 oracle exit 1 拒绝；t18 变异 PDF 按精确路径删除。
- **probe-ops**：11 PASS + 1 BLOCKED。`computer_menu` 在自建 WinForms 原生 HMENU 上仍返回 `menu_path_unavailable` / `window_id ... invalid`，未伪造成 PASS。
- **probe-launch**：7/7。daemon `S-1-16-12288`，但 `app_launch('powershell.exe')` 子进程为 `S-1-16-8192`；驱动侧 alt+F4 关闭，无残留；基线窗口未动。旧“app_launch 子进程一律 High IL”断言按实测改写。
- **probe-modifier-drop**：5/5。Explorer Ctrl+drag 复制、普通 drag 移动、`GetAsyncKeyState` 与 private-drag 回执均无卡键。
- **probe-safety-runtime 13/13；probe-scroll 3/3**（已改为 `import.meta.url` 推导根目录，加 120s 自关 Timer 与子进程身份清理）。
- **真跑**：默认 overlay 在 t19/t20 第一步即 `QUOTA` 402（ENV，不是任务失败）；opencode overlay：t19 **pass 35 步**、t20 **pass 17 步**（首轮）；第二轮 t19 **fail 56 步**、t20 **fail 33 步**（方差样本）。t20 第二轮失败时 Confirm 模态未关，cleanup 曾记 dirty；已加“先关 owned 模态 + 精确 PID/start 兜底”，合成模态复测 cleanup dirty=false。
- **S2 图像真跑**：p01 **pass 6 步**、p02 **pass 11 步**、p03 **pass 8 步**（opencode text+image；oracle 分别命中 C2 / P02-7K9 / D3）。
- **轨迹细节**：逐轮 observe/action、错误、重复调用与模型行为见 [TRAJECTORY-ANALYSIS](TRAJECTORY-ANALYSIS.md) §11；本节只保留结果摘要。
- **TabState 事件**：首轮 opencode t19/t20 结束时，模型自开的测试 Notepad（`target.txt`，modified）阻止 restore；按精确 HWND/pid/start + 允许标签 `target.txt` 关闭并丢弃，`tabstate.ps1 restore` 恢复 28 个用户 bin。t19/t20 cleanup 已加 `Close-OrphanTestNotepads` 防复发。
- **CI**：ubuntu 加 `npm ci` + `npm test`；新增手动 Windows self-hosted workflow（`verify-runtime` exit 2 视为 ENV；可选 probes）。**本地已提交，未推送/未运行**；在 runner 就绪前不能称 Windows CI 已覆盖。
- **AC6**：`headless-run` 落 `tokens`/`modelRoute`；`ac6-summary` 汇总 t01/t05 各 5 轮（opencode-go/deepseek-v4.1-flash）：
  - t01：5/5 pass；steps 中位 12 / p90 15（p90Unstable，n=5<8）；wall 114s；input 8,906 / output 2,119 / cacheRead 126,976 / total 145,003 / billable 10,731。
  - t05：5/5 pass；steps 中位 24 / p90 47（p90Unstable）；wall 224s；input 21,811 / output 3,182 / cacheRead 405,888 / total 430,881 / billable 24,993。
  - t11/t14/t15 的 5 轮未跑（成本/桌面时间），不把 t01/t05 的数字外推到长任务。

## 1.2 2026-11-20 — 轨迹修复复跑（t20/t19/t05）

环境：Windows 11 x64，DPI 150%，dsh 0.2.2-rc.1，cua-driver 0.52.13；opencode-go/deepseek-v4.1-flash；交互式桌面，TabState backup/restore 成功（31 bins）。

### 1.2.1 汇总

| 运行 | verdict | steps / inner | wall | errors / unverified | input | output | cacheRead | total | timeout/budget |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| t20 r1 | **pass** | 30 / 27 | 595s | 5 / 6 | 27,501 | 9,471 | 499,712 | 536,684 | false / false |
| t20 r2 | **pass** | 28 / 25 | 618s | 7 / 2 | 17,164 | 6,302 | 402,176 | 425,642 | false / false |
| t19 r1 | **pass** | 41 / 40 | 387s | 0 / 11 | 47,350 | 7,121 | 1,166,976 | 1,221,447 | false / false |
| t19 r2 | **pass** | 60 / 56 | 595s | 2 / 15 | 65,036 | 12,592 | 2,336,896 | 2,424,636 | false / false |
| t05 r1 | **pass** | 22 / 21 | 185s | 0 / 7 | 21,348 | 4,320 | 346,624 | 385,860 | false / false |
| t05 r2 | **pass** | 17 / 13 | 121s | 0 / 4 | 14,606 | 2,079 | 218,240 | 234,925 | false / false |

- 全部 `dirty=false`、`noFinal=false`；t20/t19/t05 的 oracle 均通过（t20 `cancelled=1 confirmed=1 deleted=true`；t19 `target.txt` 内容精确 `NAV-OK`；t05 ANSI 无 BOM、含非 ASCII、内容匹配）。
- 命令：`node evals/headless-run.mjs --tasks t20|t19|t05 --repeats 2 --timeout-min 12 --patch evals/headless-patch.opencode.yml --report evals/headless-runs/fix-<task>.json`。

### 1.2.2 t20：超时仍在，但模型能按新回执改走键盘

- r1：2 次 `cua-driver click timeout after 30000ms`、1 次 `bring_to_front timeout`、1 次 `move_cursor timeout`、1 次 `press_key timeout`（合计 5 次 / 150.1s，占 549s 的 27.3%）；模型在 click 超时回执后 `screen_observe` 新顶层对话框，并用 `Escape`/`Tab`/`Enter` 完成两次选择，最终 pass。
- r2：3 次 click、2 次 bring_to_front、1 次 move_cursor、3 次 press_key 超时（合计 9 次 / 270.2s，占 610s 的 44.3%）；同样通过 `Escape`/`Tab`/`Enter`/`Space` 完成，最终 pass。
- 对照：修复前同任务第二轮 33 步、709s、无 final，按预算耗尽记 fail；本轮两轮均 25–27 inner、595/618s、有 final。超时次数并未消失（驱动/UIA 等待模态的根因仍在），但模型不再进入“像素/zoom/drag 10+ 步”死循环。
- 题面改动：允许 Tab/Enter/Escape 选择按钮；强调始终回到 `S4-T20-DIALOG`。

### 1.2.3 t19：两轮均 pass，r2 的 56 inner 不再撞预算

- r1：41 steps / 40 inner / 387s，0 工具错误；`set_value` 2 次（含完整路径），`computer_key` 的 `ctrl+l`/`enter` 正常。
- r2：60 steps / 56 inner / 595s，2 工具错误；仍出现 `win+r`：当前实现把它降级为单键 `win`，打开 Start/SearchHost（不是 CmdPal；CmdPal 只在候选列表中标记 `[shell]`，未被选中），随后 12 步绕路；最终用 Notepad 另存为写入 `target.txt`，oracle 精确内容通过。
- 对照：修复前 r2 为 56 inner、708s、无 final（预算耗尽）；本轮同为 56 inner 但 595s 完成，说明题面明确允许 Notepad 另存为后，模型不再在“Explorer 新建”上耗到预算边界。
- 注意：t19 的 pass 不证明 Explorer 新建路径；oracle 只验文件，provenance 仍在 Notes 中明确为 out of scope。

### 1.2.4 t05：`set_value` 覆盖生效，步数从 43 降到 21/13

- r1/r2 都只调用 `computer_set_value` 写文件名（len=12，`out-ansi.txt`），**零 `computer_type`**；oracle 的 ANSI/BOM/内容检查全部通过。
- 对照：修复前 r4 用 `computer_type` 追加路径，43 inner、431s、1.25M total；本轮 21/13 inner、185/121s、0.39M/0.23M total。直接原因是 `set_value` 的 ValuePattern 覆盖写入；当时回执仍显示旧值，模型多 observe 一次（本轮修复已改为“旧值→新值”回显，未复跑验证）。

### 1.2.5 结论

- P0（t20 题面、预填字段 set_value）与 P1（click/key 超时回执、menu 归一化、shell 过滤、runner 预算语义）在本轮真实模型样本中均有可观察收益：
  - t20 2/2 pass（修复前 1/2，且失败为预算耗尽）；
  - t19 2/2 pass（修复前 1/2，且失败为预算耗尽）；
  - t05 2/2 pass，步数显著下降。
- 未消除的边界：t20 的 30s 驱动超时仍会发生，单轮仍接近 10 分钟；t19 r2 仍有 56 inner / 2.4M total 的高方差。它们是驱动/任务复杂度问题，不是本轮回执/题面回归。

## 1.3 2026-11-20 — P0/P1 复跑（t20/t19/t05）

环境：Windows 11 x64，DPI 150%，cua-driver 0.52.13，dsh 0.2.2-rc.1；opencode-go/deepseek-v4.1-flash；12min 预算。

### 1.3.1 汇总

| 运行 | verdict | steps / inner | wall | errors / unverified | input | output | cacheRead | total |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| t20 r1 | **pass** | 30 / 27 | 626s | 9 / 1 | 28,234 | 8,920 | 484,096 | 521,250 |
| t20 r2 | **pass** | 27 / 25 | 601s | 10 / 0 | 19,358 | 8,738 | 412,544 | 440,640 |
| t19 r1 | **pass** | 71 / 70 | 652s | 0 / 25 | 65,571 | 12,646 | 2,873,600 | 2,951,817 |
| t19 r2 | **pass** | 49 / 48 | 454s | 2 / 13 | 54,567 | 9,591 | 1,639,040 | 1,703,198 |
| t05 r1 | **pass** | 10 / 10 | 86s | 0 / 3 | 11,012 | 1,671 | 117,120 | 129,803 |
| t05 r2 | **pass** | 16 / 15 | 106s | 0 / 5 | 14,027 | 1,983 | 211,840 | 227,850 |

全部 `timeout=false`、`budgetExhausted=false`、`dirty=false`。

### 1.3.2 t20：超时仍多，但不再隐藏；候选/键盘回执真实生效

- r1：`bring_to_front` 2 次、`click` 4 次、`press_key` 4 次 30s 超时；`move_cursor` 为 **3000ms** 超时（per-call 生效）。回执出现 **8 次**“同 pid 的更高层窗口”候选，**1 次**“前置激活超时，本次点击未发送”。最终 pass。
- r2：`bring_to_front` 4 次、`click` 6 次、`press_key` 2 次 30s 超时；`move_cursor` 3s；候选 9 次、前置超时 1 次。最终 pass。
- 对比上一轮：wall 595/618s → **626/601s**，基本持平；total tokens 536k/426k → 521k/441k。改善是“超时/前置失败被如实暴露”，不是消除驱动根因；`targetGone` 未触发（对话框在 500ms 检查时仍在列表）。
- 关键：`move_cursor timeout after 3000ms` 证明 per-call 超时已生效，单次动作不再因装饰性移动白等 30s。

### 1.3.3 t19：`win+r` 归零，但 r1 明显回归

- r1：71 steps / 70 inner / 652s / 2.95M total；`computer_click` 22、`computer_key` 26、`computer_type` 10、`screen_observe` 58；**零 `win+r`**，地址栏提示命中 7 次；没有 `computer_set_value`，最终仍 pass。
- r2：49 / 48 / 454s / 1.70M；`activate` 10、`click` 6、`key` 16、`type` 8、`set_value` 2；地址栏提示 3 次；`win+r` 零；`tabstate clear-eval removed=3`。
- 对比上一轮：r1 40→**70** inner（回归），r2 56→**48**（改善）；两轮仍 pass。`win` fail-closed 消除了 Start/Search 12 步绕路，但 r1 把探索成本转移到 Explorer 新建/重命名路径上；不能写“t19 已优化”。
- 题面/回执：t19 prompt 明确禁止 Win+R；地址栏 `SuggestionsList` 提示被模型读取（7/3 次）。

### 1.3.4 t05：`set_value` 新值回执 + 目录提示显著降本

- r1：10 inner / 86s / 129,803 total；`set_value` 2 次，**零 `computer_type`**；`另存为提示` 命中 2 次、`新值=` 1 次；oracle 含 `no stray out-ansi.txt in src=true`，没有先写错目录。
- r2：15 inner / 106s / 227,850；`set_value` 2 次、`type` 0；`另存为提示` 3 次、`新值=` 1 次；同样无 stray。
- 对比上一轮：21/13 inner、185/121s、0.39M/0.23M → **10/15 inner、86/106s、0.13M/0.23M**。r1 达到计划目标（10–12）；r2 略高于上一轮但仍远低于修复前 43。
- 关键：模型在 `set_value` 回执看到新值后不再回读；`另存为提示` 让 r1 直接填完整路径/确认目录，没有产生 `src\out-ansi.txt`。

### 1.3.5 结论

- P0 超时语义：**行为正确性提升**（嵌套超时/前置失败不再被吞，候选窗口与键盘回执可见），但 t20 驱动根因未消除，wall 基本持平。
- P0 win fail-closed：`win+r` 从每轮多次降为 **0**；t19 总成本未稳定下降（r1 回归、r2 改善），需继续观察。
- P0 另存为：t05 **10/15 inner、86/106s**，零 `type` 追加、零 `src` 残留；这是本轮最确定的收益。
- P1 地址栏提示/新值回执/clear-eval 均有轨迹命中；t19 r1 的 70 inner 是新的高方差样本，不作为“稳定通过”。

## 1.4 2026-11-20 — t20 模态 30s 超时根因探针

环境：Windows 11 x64，DPI 150%，cua-driver **0.52.13**；无模型（直接驱动调用）。
命令：

```bash
node evals/probe-modal-timeout.mjs
node evals/probe-modal-escapes.mjs            # 约 3 分钟；--trigger-only 只跑触发侧
```

探针自建 WinForms `S4-MODAL-PROBE`，点 `Delete` 弹出 `MessageBox(YesNo)`（与 t20 同形态），逐项测量。结果：

| 观测 | 结果 |
|---|---|
| 基线 AX 树（模态前） | **6 元素 / 1.6s** |
| 模态期间 `get_window_state` 默认 1000ms | **0 元素 / 3.0s**，`truncation_reason=timeout` |
| 同调用 `timeout_ms=5000` | **0 元素 / 6.9–7.4s** |
| 同调用 `timeout_ms=15000` | **0 元素 / 17–18s** |
| 同 pid 主窗口 `timeout_ms=5000` | **0 元素 / 7.0s**（整个进程，不只对话框） |
| capture-only（`include_accessibility_tree:false`） | **成功 / 1.5–1.9s / PNG 16KB** |
| `bring_to_front`（8s 上限） | timeout |
| `press_key` background / foreground（8s 上限） | timeout |
| 坐标 `click` background（8s 上限） | timeout |
| 原生 `WM_COMMAND(IDNO/IDYES)` 或 `GetDlgItem+BM_CLICK` | **对话框关闭**；`cancelled/confirmed` 状态正确 |
| 原生 `PostMessage(WM_KEYDOWN, VK_ESCAPE)` | 无效（Yes/No 对话框没有 Cancel 按钮） |
| 驱动 `press_key` Escape background（60s） | timeout，对话框未关 |
| 驱动 `hotkey` Alt+N foreground（60s） | 一次 20.3s 关闭但回执为失败；另一次 60s timeout 未关（不稳定） |
| 原生 `EnumChildWindows` 找 `Button` + `BM_CLICK` 点 Delete | **~1.2s 返回**，模态 4s 内出现，无 30s 阻塞 |
| 触发模态的 element click 返回时间 | 探针先跑 ~75s 的其他测试；原生关闭模态后 click 立即返回（总计 74.6s），证明它被模态生命周期卡住 |

结论：

1. **UI 线程没有死**：MessageBox 的模态循环仍会抽 Win32 消息，`WM_COMMAND`/`BM_CLICK` 能立即关闭对话框。问题不是“窗口无响应”。
2. **UIA provider 在模态期间不服务跨进程 UIA/COM 请求**：同 pid 的主窗口和 MessageBox 都返回 0 元素；把预算从 1s 提到 5s/15s 仍为 0。因此 **`timeout_ms` 重试不是修复**，`observe` 不应据此改默认。
3. **驱动的动作层依赖 UIA/前台激活**：`click` 的 element token 走 UIA Invoke，背景像素点击先做 UIA hit-test；`bring_to_front`/`press_key` 也在模态期间阻塞。30s 是插件的传输层上限，不是驱动的内部超时；模态关闭后，挂起的 element click 会返回。
4. **原生 Win32 标准控件路径不受影响**：`EnumChildWindows` + `BM_CLICK` / 控件 ID 的 `WM_COMMAND` 可在 ~1s 内完成“触发 + 关闭”。这是一条可行的 Windows-only 快速路径，但它绕过驱动的 UIA 动作层，属于新能力，需单独的安全边界与产品决策；本轮**未**把它加入插件。
5. 因此 t20 的 30s 超时根因是**驱动/UIA 等待模态**，不是插件重试策略；插件侧调参不能消除。当前 t20 仍 2/2 pass，但每轮仍有多次 30s 超时。

回执修正（本轮）：

- click/key 超时不再建议“Escape=取消 / Enter=默认按钮 / foreground 键”作为快速路径（实测 Escape 在 Yes/No 上无效，foreground 键 60s 仍阻塞）。
- 改为：先等待 5–10s，再用 `screen_observe`（capture/ax 均可）确认“超时是否其实是延迟成功”；若仍需操作，按对话框按钮的加速键只发一次，并接受回执可能延迟/失败。
- 守门：`tests/delivery.failures.mjs` 的 `D-timeout-click` / `D-timeout-key` 断言包含 `capture`、`Escape 在 Yes/No`、`5–10s`、`加速键`。

## 1.5 2026-11-20 — 私有 Win32 原生对话框后端

环境：Windows 11 x64，DPI 150%，cua-driver 0.52.13。实现：`nativeDialogs:auto`（默认）+ `tools/native-dialog.ps1` + `lib/nativeDialogs.js`。

真机命令：

```bash
node evals/probe-native-dialog.mjs
node tests/native-dialogs.test.mjs
```

结果：

- `probe-native-dialog` **9 PASS / 0 BLOCKED / 0 FAIL**：
  - 插件 UIA element click 打开 `S4-NATIVE-DIALOG-CONFIRM`（触发调用挂起，正是 t20 路径）；
  - `screen_observe(window_id=dialog)` → `mode=native-dialog`，2 个按钮（是/否），坐标在对话框本地空间（rect 同源）；
  - `computer_double_click` / `computer_key` 明确拒绝；
  - `computer_click(element=No)` → 原生消息 `BM_CLICK`，对话框关闭，state `cancelled=1`；
  - 之前挂起的 UIA trigger 在对话框关闭后返回（ok=true / unverifiable）。
- 离线 `tests/native-dialogs.test.mjs` **18/18**：空 AX→native 合成按钮；native click 不走驱动；坐标/键盘/滚动/双击/右键拒绝；`nativeDialogs:off`/非模态回退；点击失败不消费；allowedApps/snapshot_id/UIA 复核；sidecar JSON/base64/超时。
- 覆盖范围：同 pid 顶层标准 `#32770` 模态对话框 + 标准 `Button`；只发 `BM_CLICK`；不自动选择 Yes/No。
- 未覆盖：触发模态的 UIA click 仍可能 30s；WPF/WinUI/自定义对话框、Edit 输入、modifier/double/right/from_zoom 不走该后端。驱动/UIA 根因仍见 §1.4，`evals/BLOCKED.md` 保持“部分 BLOCKED”。

## 1.6 2026-11-20 — 实验性后台输入（B0/B1/B2/B3）真机探针

命令：`node evals/probe-background-input.mjs`（自建原生 message/pointer 窗口 + 隐藏 controller + cover；不加入 `npm test`）。

结果：干净轮次 **10 PASS / 1 BLOCKED / 0 FAIL**；脏桌面轮次 **8 PASS / 3 BLOCKED / 0 FAIL**（B1 光标漂移、B3 fail-closed；均不冒充 PASS）。

| 检查 | 结果 | 说明 |
|---|---|---|
| 自建窗口 | PASS | native pointer 窗口，`touchWindow=true`，clientOrigin/rect 可读 |
| B0 posted click | PASS | 指针窗口收到 `MOUSEDOWN/MOUSEUP`；side_effects.cursorMoved=false |
| B0 posted text | PASS | `WM_CHAR` 5 字符收到（`CHAR:112/114/111/98/101`） |
| B0 posted key | PASS | `KEYDOWN:65` 收到；`FocusOrTarget` 未发到无关窗口 |
| B1 synthetic touch | PASS | pointer 窗口收到 `TOUCHDOWN/TOUCHUP`；anchorUsed=true |
| B1 遮挡 | PASS | cover 覆盖后返回 `occluded`，未注入、未提升窗口 |
| B1 光标 | PASS | 最终一轮漂移 0px；helper `cursorMoved=false`。早期脏桌面轮次漂移 30–751px 时记 BLOCKED，不冒充 PASS |
| B2 cursor | BLOCKED | 当前会话 `BlockInput(TRUE)` 返回 false；实现失败关闭，未移动光标 |
| B3 window | PASS | 窗口移到光标下点击后还原；窗口 rect 与光标检查通过 |

结论：

- B0 消息/文本/按键、B1 合成触控、B1 遮挡失败关闭、B3 窗口锚定均有端到端证据。
- B2 在当前会话不可用（`BlockInput` 被拒），记 BLOCKED；B1 的“不移动光标”在最终干净轮次通过，但脏桌面外部光标移动仍可能使其 BLOCKED。
- 离线新增 `tests/background-input.test.mjs`（32 项）；`npm test` 29 套 / 724 项；语法 45/45；默认三键 off。

## 1.7 2026-11-20 — 后台输入硬化与 WM_TOUCH-only 探针

命令：`node evals/probe-background-input.mjs`（新增只处理 `WM_TOUCH` 的 touch-only 窗口；不加入 `npm test`）。

结果：干净轮次 **12 PASS / 1 BLOCKED / 0 FAIL**；B2 仍因 `BlockInput` 被拒记 BLOCKED。

新增/变化的证据：

| 检查 | 结果 | 说明 |
|---|---|---|
| B1 WM_TOUCH-only 目标 | PASS | 只处理 `WM_TOUCH` 的窗口收到 `WMTOUCH`；合成 pointer 被系统转换 |
| B1 不改变前台 | PASS | 注入前后 `probe.foreground` 不变；`side_effects.foregroundChanged=false` |
| B1 incomplete/回执字段 | 离线 | `complete=false` + `warning_code` 进入插件结构化回执 |
| B2 正路径断言 | 修正 | 探针改读 `state.wndLog` + `MOUSEDOWN`；当前会话仍 `BlockInput` 被拒 → BLOCKED |
| B0/B3 清理 | 离线 | down/up/KEYUP 失败补发并标 partial；B3 有界轮询 + 还原校验 |
| nativeMenus 真机 | PASS | `probe-ops` 的 SetMenu fixture 自检 `GetMenu`/menu-count，专用 `menu:0x4D4B` marker 出现；离线 18 项通过；MenuStrip/WPF/WinUI 明确 `no_hmenu` |
| 离线 | 42 + 18 项 | `npm test` 31 套 / 764 项 |

## 1.8 2026-11-21 — nativeMenu 真机通过 + 原生 Button 触发探针

命令：
- `node evals/probe-ops.mjs`：**13 PASS / 0 BLOCKED / 0 FAIL**；`nativeMenus:auto` 对 SetMenu fixture 通过（fixture 自检 `GetMenu`/menu-count，`menu:0x4D4B` marker）。
- `node evals/probe-native-button.mjs`：**4 PASS / 0 BLOCKED / 0 FAIL**；自建 WinForms `Delete` + MessageBox。

| 检查 | 结果 | 说明 |
|---|---|---|
| 原生 Button 触发 | PASS | `nativeButtonTrigger:auto` 点击 1.2s 返回；`opened=1`；driver UIA 对照 30s |
| 模态出现/关闭 | PASS | MessageBox `Confirm` 出现；native-dialog 点 `否(N)`，`cancelled=1` |
| 10s latch | PASS | 重新 observe 后再次点同一 Delete，被 `native_button_latched` 拒绝；`opened` 仍 1 |
| HMENU 真机 | PASS | fixture 的 `window_id` 即 HWND；`GetMenu` 可读；`WM_COMMAND` commandId 到达 |
| 离线 | 42 + 18 + 12 项 | `npm test` 31 套 / 764 项 |

## 2. 运行矩阵（t11 / t12 / t14 / t15 / t17）

环境：dsh 0.2.2-rc.1，Windows 11 x64，DPI 150%，dirty 桌面；驱动/模型见各段。`inner steps` 为 dsh 内部步数；`errors / unverified` 为工具错误/未验证计数。

| 运行 | 结果 | inner steps | observe | click | type | drag | zoom | activate | errors / unverified | 时长 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| t11 旧题面 | fail 71 | 140 | 86 | 28 | 0 | 8 | 31 | 1 | 7 / 44 | 1161s |
| t11 显式题面 A | **pass 84** | 82 | 47 | 13 | 1 | 12 | 4 | 1 | 4 / 29 | 734s |
| t11 显式题面 B | **pass 77** | 76 | 41 | 19 | 2 | 7 | 3 | 1 | 3 / 29 | 707s |
| t11 显式题面 C | fail 49 | 47 | 22 | 10 | 2 | 7 | 0 | 1 | 1 / 23 | 350s |
| t11 第七轮 A | **pass 58** | 57 | 32 | 15 | 1 | 4 | 0 | 3 | 6 / 20 | 398s |
| t11 第七轮 B | **pass 94** | 91 | 29 | 17 | 3 | 9 | 24 | 7 | 3 / 26 | 934s |
| t11 0.52.13 opencode | **pass 77** | 75 | 46 | 17 | 0 | 5 | 0 | 5 | 4 / 20 | 929s |
| t11 capture-only | **pass 76** | 73 | 38 | 16 | 1 | 6 | 3 | 5 | 3 / 24 | 1224s |
| t11 回执修复 | **pass 70** | — | 28 | 22 | 4 | 4 | 3 | 4 | 3 / 31 | 1000s |
| t12 旧 seed | fail 189 | 187 | 51 | 47 | 20 | 2 | 0 | 0 | 6 / 129 | 1191s |
| t12 简化无占位柱 | fail 160 | 157 | 64 | 40 | 9 | 4 | 0 | 1 | 2 / 88 | 1192s |
| t12 保存按钮 | fail 162 | 160 | 62 | 38 | 12 | 1 | 6 | 0 | 5 / 93 | 1189s |
| t12 占位柱 | fail 178 | 174 | 71 | 61 | 6 | 0 | 5 | 2 | 25 / 77 | 1191s |
| t12 预填+占位柱 25min | fail 190 | 186 | 79 | 60 | 8 | 0 | 8 | 3 | 10 / 97 | 1492s |
| t12 第七轮 | **pass 152** | 150 | 50 | 39 | 3 | 0 | 12 | 3 | 9 / 76 | 1069s |
| t12 0.52.13 opencode | **pass 112** | 110 | 60 | 28 | 4 | 0 | 2 | 5 | 2 / 41 | 1581s |
| t12 capture-only | **pass 98** | 96 | 41 | 24 | 7 | 0 | 0 | 3 | 6 / 44 | 1378s |
| t12 回执修复 | **pass 100** | — | 45 | 27 | 5 | 0 | 0 | 5 | 3 / 44 | 1781s |
| t15 r1 | **pass 177** | 176 | 77 | 26 | 1 | 0 | 26 | 1 | 9 / 90 | 1110s |
| t15 r2 | **pass 146** | 143 | 43 | 40 | 2 | 1 | 0 | 2 | 9 / 85 | 853s |
| t15 r3 | **pass 89** | 88 | 30 | 42 | 0 | 1 | 1 | 1 | 14 / 55 | 560s |
| t15 第七轮 A | **pass 85** | 84 | 39 | 17 | 2 | 0 | 1 | 0 | 4 / 40 | 555s |
| t15 第七轮 B | **pass 67** | 64 | 22 | 12 | 7 | 0 | 0 | 0 | 6 / 36 | 356s |
| t15 0.52.13 opencode | **pass 55** | 53 | 23 | 15 | 1 | 0 | 0 | 1 | 0 / 28 | 419s |
| t15 capture-only | fail 52 | — | 18 | 3 | 1 | 0 | 6 | 3 | 8 / 11 | 1200s |
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
| t17 post-fix | **pass 86** | — | 34 | 17 | 4 | 0 | 0 | 3 | 1 / 37 | 885s |
| t17 capture-only | **pass 29** | — | 9 | 5 | 1 | 0 | 4 | 2 | 2 / 10 | 335s |
| t14 capture-only r1 | **pass 76** | — | 23 | 18 | 2 | 0 | 6 | 3 | 6 / 26 | 1058s |
| t14 capture-only r2 | fail 64 | — | 21 | 6 | 6 | 0 | 5 | 2 | 11 / 27 | 970s |

> `capture-only` = 0.52.13 上 `include_accessibility_tree:false` 的像素预取路径；`回执修复` = 2026-11-18 native/vision 快照 id + query 清除说明。`—` 表示报告未单列该计数。

## 3. 2026-11-18

### 3.1 观察回执修复后的 t11/t12

环境：cua-driver 0.52.13、opencode-go / deepseek-v4.1-flash、dirty 桌面；`node evals/headless-run.mjs --tasks t11,t12 --repeats 1 --timeout-min 35 --patch evals/headless-patch.opencode.yml`。

| 任务 | 结果 | 步数 | 时长 | 工具错误 | unverified | oracle | 残留 |
|---|---|---:|---:|---:|---:|---|---|
| t11 Paint | pass | 70 | 1000s | 3 | 31 | 22/22 | `snapshot_expired` 1、`window_target_not_found` 1、保存后标题观察失败 2；`snapshot_mismatch` 0 |
| t12 PowerPoint | pass | 100 | 1781s | 3 | 44 | 13/13 | `snapshot_expired` 2、query 后 `snapshot_missing` 1、前台锁；`snapshot_mismatch` 0 |

- 3.1 之前同题面 capture-only：t11 76 步 pass（1224s、3 errors、24 unverified、oracle 22/22）；t12 98 步 pass（1378s、6 errors、44 unverified、oracle 13/13）。两条轨迹均无 `screenshot_context_missing`/`stale_element_token`。
- 回执修复的直接效果：native/vision 文本回显 `快照 s...；全局单例`；跨窗口旧 id 的 `snapshot_mismatch` 从 2 次降到 0。t12 的 1 次 query 后 `snapshot_missing` 是模型未读“旧动作快照已清除”提示，fail-closed 正常。

### 3.2 0.52.13 canary 探针

| 探针/检查 | 结果 |
|---|---|
| `verify-runtime` | 18/18（0.23.2 与 0.52.13） |
| `live-action.e2e` | 33/33（0.52.13） |
| `probe-driver-shape` | 默认 markdown/显式 elements、session 归属、capture-only 截图上下文均确认 |
| `probe-modifier` | `ok=true` / `dragModifierSupported=true`；0.52.13 原生 modifier drag delivered |
| `probe-combo-foreground` | blocker 前台时插件 `key()` 自动前台，Ctrl+V 到达 WinForms TextBox |
| `probe-private-drag` | 3/3；down/move/up 均读到 `Shift, Control`，drop 后无卡键 |
| `probe-from-zoom` | 请求 160×100 → 返回 224×140，图中心点击命中 |
| `probe-native-freshness` | WinForms 文本变化窗口未复现“AX 已变而 PNG 不变” |

### 3.3 其他任务

- t17 capture-only **29 步 pass**（A1 exact、0 假成功；2 errors 均为 1 步恢复）。
- t14 capture-only **76 步 pass**；**64 步 fail**（单元格全 false、图表 title/categories true；Paste 未落，非兼容错误）。
- t15 capture-only **55 步 pass / 52 步 fail**（fail 轮未用 Ctrl+click，文件未移动；非兼容错误）。
- 同轮 t11 **77 步 / capture-only 76 步**、t12 **112 步 / capture-only 98 步** 均有通过样本。

## 4. 2026-11-17

### 4.1 手势/画布/白底轮

| 任务 | 轮次 | 结果 | 步数 | 关键点 |
|---|---|---|---:|---|
| t15 | Ctrl+click 批量 | **3/3 pass** | 77/72/59 | 各 5 次 Ctrl+click；文件单选 `foreground=true`；无 Notepad/Photos 误开；dirty=false |
| t11 | 画布原点/线宽 | **3/3 pass** | 70/88/48 | UIA 画布 `(879,600) 800×600`；setup 固定三种形状 8px；activate + 焦点 click；app_launch=0 |
| t12 | 白底 seed + 直接输入 | **2/2 pass** | 140/169 | hash/1 页/16:9/Q1-Q3/三色柱全 true；40 分钟预算 |
| t14 | 旧题面 | **2/2 pass** | 141/71 | 24 格/barChart/标题/Sales/Month categories 全 true |
| t17 | 旧题面 | **2/2 pass** | 89/63 | A1 exact；三击句子 + Ctrl+C；测试 Firefox 标签单独 Ctrl+W |

### 4.2 第七轮（输入真实性与前台语义）

| 任务 | 结果 | 步数 | 关键点 |
|---|---|---|---:|
| t14 新题面 | **3/3 pass** | 59/41/57 | `typeCalls=1/1/2`、`clipboard=1`、seed unchanged、oracle 全 true |
| t17 新题面 | **3/3 pass** | 37/53/48 | `typeCalls=0`、`clipboard=1`、A1 exact、seed unchanged、用户 Firefox 无测试标签 |
| t15 回归 | pass | 85/67 | 8 文件/内容/旧路径全 true；第二轮 5 次 Ctrl+click 批量 |
| t12 回归 | pass | 152 | 1 页/16:9/Q1-Q3/三色柱全 true；1069s |
| t11 回归 | pass | 58 / 94 | forced drag 前置单次 58；全部指针前置单次 94；三色 ROI/coverage/precision 全绿 |
| t14/t17 指针回归 | pass | 42 / 42 | 去掉失败后重试未破坏路径 |

- `probe-combo-foreground`：blocker 前台时插件 `key()` 自动前台目标并把 `Ctrl+V` 送进 WinForms TextBox，文本 `S4-COMBO` 完整到达。
- `probe-private-drag`：3/3；真实插件 `computer_drag(modifier=["ctrl","shift"], dwell_ms=120)` → 持久 helper；WinForms down/move/up 均读到 `Shift, Control`，`sent=30`、`foregroundRestored=true`、无卡键。
- t14 r1 的 28 次 type 中 26 次被误报“未送达”，但 24 格全部写对；根因是 `background_delivery_failed` 被整段 JSON 子串误判为硬失败。改为词边界后消失。

### 4.3 ZCode CU 同机能力探针

方法：ZCode `computer-use` skill 要求 main agent only，由主会话直接执行；只验证关键原语，不是完整三题跑分。

| 任务 | 探针结果 |
|---|---|
| t15 Explorer | 返回 291 个元素；`click(alpha)` + `click(beta, modifiers:"ctrl")` 后状态栏“已选择 2 个项目 28 字节”；命令栏剪切 → 打开 docs → Ctrl+V 成功。inline 重命名一次 `type` 返回 “response lost”，需 observe 后继续。结论：Ctrl+click 批量多选可行 |
| t11 Paint | 返回 221 个元素，含画布 bounds `[879,600,800,600]`、矩形/椭圆/直线、红/靛蓝/黑；元素点击可选工具/颜色。坐标 drag 要求先 `get_app_state({include_screenshot:true})`；返回 frame 是 1280×800（不是 2560×1600），画布映射约 `[440,300,400,300]`；`[480,345]→[580,415]` 被接受但 Paint 状态无变化；Windows 无 `bring_to_front`/activation API。结论：ZCode CU 在 t11 同样无法稳定完成 |
| t12 PowerPoint | 返回 353 个元素；形状以 `Image "S4 Bar Q1/Q2/Q3"` 暴露并带 bounds；标题/副标题 value 可读；`形状填充/形状轮廓` SplitButton 可见。按元素名选中形状可行；surface reference 会 retired，需要重新 observe。文本/颜色/字号/居中仍是应用层成本 |

## 5. 2026-11-16

### 5.1 脏桌面首轮（t11-t17）

| 任务 | 结果 | 步数 | 备注 |
|---|---|---:|---|
| t13 论文下载 | pass | 19 | NeurIPS PDF SHA-256，cleanup removed=1 |
| t15 Explorer | pass | 112 | 能收敛但探索很长 |
| t16 本地表单 | pass | 17 | 本地 server result.json |
| t11 Paint | fail | 107 | 未保存输出 |
| t12 PPT | fail | 126 | 未保存输出 |
| t14/t17 | 仅 setup/cleanup | — | oracle 未跑 |

### 5.2 修复轮

- t11 显式题面 **84/77 步 pass**（app_launch=0、computer_activate 使用、12 drag）；旧题面 107/71 fail。
- t15 新题面 **3/3 pass**（177/146/89 步，仍高于旧 112）。
- t12 16:9 seed + 占位柱可打开/保存；25 min/190 步仅 title/subtitle、红/蓝柱、Q1 通过，仍高风险。

### 5.3 t01 / t05 / 离线

- t01 新题面 **5/5 pass**，steps 17/32/8/19/11（median 17），wall 98.0/278.5/69.2/129.8/81.0s；中间题面版本 4/5。
- t05 **3/3 pass**，steps 26/28/19，dirty=false，tabstate restored。
- 离线 **22 套 / 483 断言**；`observe.truth` 25、`schema.conformance` 45。
- query 只读回归：`snapshotId=null`、动作 `[snapshot_missing]`、差分/降噪不污染、全量观察后恢复。
- `verifyAfterAction` A/B：**10/10 pass**；t01 off 9/19/52 步、61.6/117.1/377.3s；auto 66/15/8 步、533.2/98.1/60.9s；t05 off 24/34、auto 22/26。auto 中位略优但有 533s 尾部、每轮多 2–12 次 click 复核；默认保持 `off`。
- 第二轮离线 **22 套 / 477 断言**；pack 38 文件；`key.xaml` 33、`action.echo` 30、`observe.truth` 20。
- 第三轮离线 **22 套 / 483 断言**；pack 39?（原文未单列）；t01 新题面 5/5。

### 5.4 WinUI 键鼠通道探针

| 组合 | 通道 | 实际效果 |
|---|---|---|
| Ctrl+A | `hotkey` background/foreground | 抛 `could not find a UIA AcceleratorKey`，无选择 |
| Ctrl+A | `press_key` + ctrl，background | 无选择，且把裸 `a` 插入正文（textLen 27→28） |
| Ctrl+A | `press_key` + ctrl，foreground | 选中全文（28/28） |
| Ctrl+A | 点“编辑”菜单 → 点“全选” | 选中全文（28/28），推荐回退 |
| Alt+F | `hotkey` background/foreground | 找不到 AcceleratorKey，菜单未打开 |
| Alt+F | `press_key` + alt，foreground | 文件菜单打开 |
| Alt+Tab | `hotkey` background/foreground | UIA 加速器 4s 超时，前台 HWND 不变 |
| Alt+Tab | `press_key` + alt，foreground | 前台切换（真实切走） |

- 结论：Ctrl+A 可靠回退是“点编辑菜单 → 全选”；Alt+F 只在 foreground `press_key` 可靠；Alt+Tab 优先用 `computer_activate`/`app_launch`。

## 6. 2026-11-15

### 6.1 runtime/pipeline 复盘

- t01 50 次调用（10 click / 14 key / 7 zoom / 1 set_value / 15 observe），约 6 分钟；8 次执行点击 × 5 段滑行 ≈ 40 次小段指针移动；另存为文件名框出现 `count:3` 三连击 + 8 次 BackSpace（`delivery_failed`/unverifiable）。
- Notepad 污染：同一窗口 8 个标签：2 个用户已修改文档 + 6 个测试文件；窗口标题无 `*`；旧 cleanup 会尝试 WM_CLOSE。
- 修复：`cacheSnapshot` 存点击空间；`resolveClickTarget` 检查 TTL；滑行目标不再偏移 `screenOrigin`；`deliveryFailure` + `settleAction` 统一 `ok:false`；L3 retry 失败不写“完成”；notFound/降级清快照策略；suspect 去重强制全量；Notepad `Get-NotepadTabs`/`Test-NotepadTabSet` + ExpectedTabs。
- 真机 t01 ×3：**0/3 执行，3/3 setup error（steps=0）**；seed 落进现有 Notepad 窗口（`owned=False`，含 2 个用户已修改标签 + 测试标签）；fail-closed 生效。
- CU 轨迹监控首个样本：443 events / 589.5s；34 observe / 39 action；53 `move_cursor` / 7257px；自动标记 repeat_action、observe_burst、repeat_observe。
- 监控下 t01：fail 76 steps / 8 errors / 15 unverified / timeout；轨迹显示 3 次重复 click、3 次连续 observe、另存为窗口重复 native+ax 观察。
- 修复后 t01：58 steps pass（4 err / 15 unverified / 354.2s；26 observe / 30 action；2 `move_cursor` / 248px）；42 steps pass（4 err / 12 unverified / 233.9s；19 observe / 22 action；0 `move_cursor`）；原地保存 31 steps pass（1 err / 8 unverified / 184.5s）。
- 原地保存 ×3：37/18/19 steps pass；err 1/0/1；unverified 12/4/4；273.4/121.7/104.2s；每次 1 `move_cursor` / 0px；无 timeout/dirty。
- `verify-oracles` 2026-11-15 18:40 复跑 **10/10 PASS**；tabstate restored。
- t01 P2 后 3x：2/3 pass（r1 9、r2 13 steps pass；r3 66 steps fail，内容不匹配）。
- t05 旧 Save As 失败样本：fail 50 steps / 2 err / 17 unverified / dirty；oracle 文件不存在。
- t01 观察真值轮 ×3：99/9/10 steps pass；oracle exact。
- t05 观察真值轮 ×3：26/28/19 steps pass；err 1/2/0；unverified 11/10/9；dirty=false。
- 输入回读/保存门禁离线 **458 断言**；`from_zoom` 真机探针 pass（请求 160×100 → 返回 224×140）。
- 第二轮离线 2026-11-16：22 套 / 477；第三轮 483；verify-runtime 17/17（当时）。

## 7. 2026-11-12

### 7.1 dsh 0.2.2-rc.1 headless 真机加载

```bash
dsh --profile headless --patch "<workspace>/_probe-win-cu-deepseek.yml" \
  --permission-mode read-only --approval-policy never \
  "只做只读验证：status / screen_observe / catalog / 隐藏 computer_wait"
```

| 检查 | 结果 |
|---|---|
| 会话 | `session-e1d8a603-...`，1 轮 5 步，`turn_end: completed` |
| 插件加载 | `computer_do(status)` → dispatcher；直接可见 `computer_do, screen_observe`；**当时 20 隐藏** |
| 真实观察 | `screen_observe()` → `Arknights.exe · 明日方舟`，pid 47912 / window 14354214，4 元素，快照 `s0000001f` |
| catalog | 20 个隐藏工具签名（当时） |
| 隐藏路由 | `computer_do({action:"call",tool:"computer_wait",args:{ms:50}})` → `[computer_wait] 已等待 50ms。` |
| prompt cache | `cacheReadTokens` 6528 → 6656 → 6912 → 7296；tools 列表稳定 |
| 安全边界 | 只读 observe + 纯等待；未调用 bash/文件工具 |

- headless 默认禁用 `credentials`；探针 patch 显式启用后可用。`OPENCODE_GO_API_KEY` 当时过期 401，使用默认 DeepSeek 通道。

### 7.2 eval oracle 双向验证

- `TEMP=C:\Windows\TEMP` 时 `Add-Type` 报找不到 `*.cs`，首次 0/10；把 `TEMP`/`TMP` 指到 `%LOCALAPPDATA%\Temp` 后 **10/10 PASS**（t01/t03/t04/t05/t06/t07/t09/t10/wa2/x1）。
- 判据：setup ok → oracle 空跑 fail → simulate pass ×2 → cleanup ok。

### 7.3 headless eval smoke

| 轮次 | 上限 | 结果 | 备注 |
|---|---:|---|---|
| Round 1（一次性 runner） | 8min | **3/4** | t01/t04/t07 pass；wa2 fail（57 调用，Archive） |
| Round 2（headless-run） | 10min | **4/4** | t01 41 调用/err 7/unverified 13；t04 23/0/10；t07 5/0/2；wa2 72/12/16（到点但 oracle pass） |

- 两轮合计 7/8；wa2 对时间预算敏感（8min fail → 10min pass）。
- Round 2 工具级：141 次调用，19 错误（13.5%），41 unverified（29.1%）。

### 7.4 dsh 0.2.2 兼容升级

| 检查 | 结果 |
|---|---|
| `computer_task` `startActivation` | headless 真机拉起子 agent；结构化 `OK`；回执写“同级能力” |
| API 形状 | 运行时扁平 spec；rc.2 无 `list()`，用 `getProvider` |
| vision 默认 | `deepseek-flash`；真机观察者返回视觉理解段 |
| native 附件限额 | `maxImageDimension`/`maxImagePixels` 纳入；compact 明确失败 |
| G1/G5 | scroll/drag 校验 `snapshot_id`；zoom `coordinateSpace` + `fromZoom` |
| PTC `run_code` | dispatcher / 20 hidden（当时） |
| PTC native | 图片作为 deferred context |
| PTC + task | `tools.computer_do` 拉起子 agent；直接 `tools.computer_task` 为 undefined |
| 离线 | 22 套 / 458；check 20/20；pack 37 文件（当时） |

## 8. 2026-11-09/10

- 离线 10 套 / 231 断言（当时）；新增 `action-bounds`、`dispatcher.test`、`package-manifest`；`delivery-chain` 改为真实 `cuaDeliver`。
- 语法 16/16；runtime 16/16（当时）；pack 31 文件（当时）。
- P0 修复：`type`/`key` 不再盲发 desktop；`scroll`/`drag` 透传 `window_id`；`suspected_noop` 终态失败；指定窗口未匹配 fail-closed；观察降噪完整指纹。
- 工具面：dispatcher 默认（2 可见/20 隐藏，当时）；hybrid（7/15，当时）；dynamic 删除。
- 缓存：稳定 dispatcher 重复 99.5%、首 tool_call 后 92.1%、第二次 85.4%；tools 变化首击 0–18%。

## 9. 2026-09-17

- 离线 7 套 / 148 断言；schema 20 工具 / 42 场景；config.plumbing 25。
- `live-action.e2e` **23/23**（唯一命名临时文件 + 标题匹配，不杀进程）。
- parity：observe/zoom 29 场景 `{value,render}` 逐字节一致；20 工具工具面 JSON 逐字节一致。
- `verify-oracles` **10/10**（首次 t04 因遗留计算器窗口失败，清理后通过）。
- 发现并修复：`scroll`/`drag` 把结构化拒绝当成功；`runAction`/`dedupInvalidate`/`taskCallCount` 死代码；schema 覆盖 13/20 → 20/20。
- v0.5.6 注解 tag；`main` 单分支。

## 10. 2026-09-16

- 离线 4 套 / 74 断言；19 工具 / 22 场景。
- `live-action.e2e` 3 轮 **30/30**（旧版设计）。
- 坐标标定：可控探针逐点最小二乘 **残差 ≤0.55px**；`computer_click(x,y)` = 窗口矩形相对物理像素；截图 == `list_windows.bounds` 1:1。
- 输入通道：经典 Win32（regedit `ctrl+f`）**3/3**；WinUI3（记事本）`hotkey` **5/5 失败**（UIA 加速器 4s 超时，#3908）。
- 驱动完整性：`cua-driver.exe` 清单 `requireAdministrator` → daemon 与 `app_launch` 子进程 High IL；非提权客户端清不掉（#3607）。
- eval 9 任务 + AC2 **9/9**（连跑 3 次一致）；冒烟 t07 pass。
- 客户端适配：严格输出校验、composer `Input.insertText`、页脚格式、新会话视图钉住。

## 11. 2026-09-06/07

- A6 密码窗口 **9/9**：结构标记注记 / guard 硬拒 / 普通框零误拒 / sidecar 时延 1.4–1.6s / zoom crop 元数据；发现并修复标记坐标系错误。
- 快照新鲜度 **4/4**：快照 id / 首写 confirmed+readback / 同快照二写一致性注记 / 密码框硬拒。
- A7 坐标语义六轮：驱动 0.23.2 文档契约与实测矛盾，screen/bounds-local/client-local 三假设均有反例 → 像素路径 best-effort。
- dsv4fv 通道：ax ✓；native ✓（attachments 端到端，首 token 0.9s / 116 tok/s / 缓存 74%）；vision 观察者半通（只出思考）；GLM 无 key 优雅降级。
- 上游反馈：#3576（密码投影）、#3586（树版本/条件请求）、#3587（干预信号）已提。

## 12. 2026-08-25 / 08-15

- 2026-08-25：`verify-runtime` **12/12**；12 工具注册（新增 `screen_zoom`）；AX 真实树；native text-only 拒绝；native image route PNG（1.06MB）attachments + `{type:"image"}`；zoom 区域 JPEG；vision 降级链；坐标语义；安全回归；结构化拒绝透传。
- 2026-08-15：macOS 初始验证；cua-driver headless / MCP 链路 / dsh-mcp-client 桥接；11 工具注册；备忘录“打开→点击→输入”闭环；TTL/白名单/危险词/密码保护；home 级 patch 安装与 HMR。此阶段危险词审批已在 0.4.0 删除，结论仅作历史。

## 13. 原始 run id 索引

- t11：`2026-11-16T10-45-11`（旧题面 71）、`11-09-17`（84）、`11-22-15`（r2 49）、`11-46-40`（77）
- t12：`12-10-08`（189）、`12-32-32`（160）、`13-37-29`（162）、`14-01-08`（178）、`14-29-56`（190）
- t15：`12-53-31`（r1/r2/r3）
- t14 旧题面：`2026-11-17T07-12-15`（141/71）；新题面：`10-14-28`（59）、`10-22-40`（41/57）
- t17 旧题面：`2026-11-17T07-39-05`（89/63）；新题面：`10-33-54`（37/53/48）
- 0.52.13 canary：t14 `18-20-17`（53）、`18-37-44`（64 fail：Sales series false）、`18-45-29`（51）、`20-19-28`（opencode 60）；t17 `18-25-41`（75）、`18-32-57`（37）、`20-32-44`（opencode 40）、`21-36-14`（post-fix 86）、`2026-11-18T06-35-51`（capture-only 29）、`06-43-40`（capture-only t14 r1 76）、`07-06-08`（capture-only t14 r2 64 fail）；t11 opencode `19-20-34`（77）；t15 opencode `19-37-43`（55）、`07-29-55`（capture-only 52 fail）；t12 opencode `19-51-11`（112）、`08-14-46`（capture-only t11 76 / t12 98）、`10-26-53`（回执修复后 t11 70 / t12 100）

## 14. 证据边界

- 原始 report/trajectory 在 gitignored 的 `evals/headless-runs/`；本文件不提交截图/文档正文/模型原始 thinking。
- ZCode CU 探针是能力验证，不是完整 t11/t12/t15 的通过/失败统计。
- native 截图“陈旧”目前是轨迹观测 + 模型判断；`probe-native-freshness` 在 WinForms 文本变化窗口未复现。修复前不要写成已证实的普适 bug。
- t12 的 PowerPoint 行为来自本机 Office 16 / Windows 11 / 150% DPI，其他环境可能不同。
- 跨 provider 对比不是受控 A/B；桌面脏状态、模型采样和驱动 capture 行为都会影响步数。
