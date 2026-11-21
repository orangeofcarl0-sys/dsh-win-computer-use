# TESTING — 测试体系与验证手册

> 目的：让每一类缺陷在**最便宜、最能复现**的层被抓住；真机只验证“离线测不出来”的部分。
> 读者：贡献者、维护者。
> 状态：当前实现（最后核对 2026-11-22：`npm test` 31 套 / **774 项检查**；`npm run check` 语法 57/57 + 文档/任务一致性；`verify-runtime` **18/18**）。
> 相关：[VERIFICATION](../VERIFICATION.md) · [EVIDENCE](EVIDENCE.md) · [WINDOWS](WINDOWS.md) · [DRIVER-SDK](DRIVER-SDK.md)。

## 1. 原则

1. **按层测试**：纯逻辑用离线桩；驱动契约用真实 `cuaDeliver` + 注入 `call`；GUI 行为用真机；任务级能力用 eval oracle（S1-S4）。
2. **看退出码**：`npm test` 用 `&&` 串联，某一套中途抛异常时，前面几套的输出仍然全绿。判据一律是 `npm test; echo $?` 或 `set -e`，不能只 grep 输出。
3. **拒绝“测复刻”**：投递链测试直接执行真实 `lib/cua.js`，通过 `opts.call` 注入假驱动；不复制一份实现来测。
4. **schema 严格校验**：dsh 0.2.2 对工具输出做 `additionalProperties:false` 校验；离线用与宿主语义对齐的校验器覆盖每种返回形态。
5. **动作语义 fail-closed**：`unknown` 不是成功；结构化拒绝不能上报为成功；`suspected_noop` 终态失败。
6. **测试窗口按标题/HWND 清理**：Win11 记事本单进程多标签，绝不按进程名杀；清理失败如实报告。

## 2. 测试层

| 层 | 阶段 | 命令 | 规模 | 能抓住什么 |
|---|---|---|---|---|
| 语法/安装脚本 | S1 | `npm run check` | 57 JS（含 lib/driver、eval runner、tasks.check、background-input、nativeMenus）+ 2 bash + 文档/任务检查 | 语法错误、Windows glob 失效、install/uninstall 语法、文档/阶段漂移 |
| 离线单元/契约 | S1 | `npm test` | 31 套 / 774 项检查 | 守卫、快照、schema、投递链、配置接线、dispatcher、边界、坐标一致性、观察值/差分、query 只读、元素点击 TTL、from_zoom、modifier/私有拖拽、capture-only、回执真实性、eval 安全、驱动归一化、原生对话框、实验后台输入 |
| 运行时（真驱动） | S1 | `node verify-runtime.mjs` | 18 项 | 引擎契约、真实截图/图片块、dispatcher 路由、坐标一致、native 快照 id |
| WinUI 键鼠通道 | S1 | `node evals/probe-winui-keys.mjs` | 14 组 | Ctrl+A/Alt+F/Alt+Tab 的 hotkey/press_key/菜单回退可达性 |
| from_zoom 映射 | S2 | `node evals/probe-from-zoom.mjs` | 1 项 | 真实 zoom padding/缩放后 from_zoom 点击命中按钮 |
| 显示/DPI 清单 | S2 | `node evals/probe-display.mjs` | 1 项 | 枚举 monitor count/DPI/virtual screen；单屏 BLOCKED，不改显示设置 |
| Windows 缺口清单 | S3 | `node evals/probe-win-gaps.mjs` | 1 项 | 只读 VS Code/VLC/Settings/WSL/CJK 语言；缺失记 BLOCKED |
| modifier 手势 | S2 | `node evals/probe-modifier.mjs` | 3 项 | click element/坐标的 Ctrl 到达；0.23.2 driver drag modifier 不进入目标；0.52.13 原生 delivered |
| 组合键前台 | S4 | `node evals/probe-combo-foreground.mjs` | 1 项 | blocker 前台时插件 `key()` 自动前台目标并把 Ctrl+V 送进 WinForms |
| 安全运行时 | S1/S4 | `node evals/probe-safety-runtime.mjs` | 13 项 | 密码拒绝、TTL 过期、stop/resume 锁存、驱动错误恢复 |
| 滚动 | S1 | `node evals/probe-scroll.mjs` | 3 项 | WinForms AutoScroll：向下/向上滚动与位置回读 |
| 私有拖拽 | S2 | `node evals/probe-private-drag.mjs` | 1 项 × 3 轮 | 真实插件 → helper → WinForms down/move/up 均读到修饰键，drop 后无卡键 |
| 原语矩阵 | S1/S3 | `node evals/probe-ops.mjs` | 13 PASS / 0 BLOCKED（2026-11-21） | click/double/right/key/hover/verify/wait_for/activate/app_list；`nativeMenus:auto` 对 SetMenu fixture 通过（fixture 自检 GetMenu/menu-count，专用 `menu:0x4D4B` marker）。默认 BLOCKED 退出 0；严格验收加 `--strict-blocked` |
| app 启动/收尾 | S1/S4 | `node evals/probe-launch.mjs` | 7 项 | app_launch pid/window、子进程 IL 实测、驱动侧 alt+F4/关闭按钮、基线窗口保留 |
| modifier drop | S2/S4 | `node evals/probe-modifier-drop.mjs`（可加 `--excel --excel-only`） | 5 项 + Excel 分支 | Explorer Ctrl+drag 复制、普通 drag 移动、无卡键；Excel 分支已实现 UIA `DataItem` 几何/Ctrl+drag/Ctrl+S/OOXML 校验；2026-11-22 复跑：`CellDragAndDrop=true`，边框 144–148/中心/不带 Ctrl 均投递成功但 A2 不动、E2 为空 → 拖拽未启动，仍 BLOCKED。`--strict-blocked` 时 BLOCKED 为 exit 2 |
| 模态根因 | S3 | `node evals/probe-modal-timeout.mjs` | 10 PASS / 13 BLOCKED（2026-11-20） | MessageBox 期间 AX 树 0@1s/5s/15s、capture 1.5s、驱动 click/key/bring 阻塞、原生 WM_COMMAND 关闭、触发 click 随模态关闭返回 |
| 模态逃逸 | S3 | `node evals/probe-modal-escapes.mjs` | 6 PASS / 4 BLOCKED（2026-11-20） | 原生 WM_COMMAND/BM_CLICK 关闭；VK_ESCAPE 无效；驱动 key/hotkey 60s 不稳定；`--trigger-only` 验证原生 BM_CLICK 触发无 30s 阻塞 |
| 原生对话框后端 | S3 | `node evals/probe-native-dialog.mjs` | 9 PASS / 0 BLOCKED（2026-11-20） | UIA trigger → `screen_observe` native-dialog 2 按钮 → `computer_click(No)` BM_CLICK 关闭、state cancelled=1；double/key 明确拒绝 |
| 常见对话框后端 | S3 | `node evals/probe-common-dialogs.mjs` | 6 PASS / 0 BLOCKED（2026-11-22） | WinForms Open/Save/Font/Color/Print：标准 `#32770`、`modal=owner-disabled`、Cancel `BM_CLICK`、state result=Cancel；不覆盖 WPF/WinUI/自定义 shell 对话框 |
| 手势真实性 | S2/S4 | `node evals/probe-gesture-truth.mjs` | private PASS；driver move BLOCKED（2026-11-22） | WinForms 记录 down/move/up + Ctrl：private 路径完整；driver 原生 drag 只看到 down/up、无中间 move，记 BLOCKED |
| WPF 模态 | S3 | `node evals/probe-wpf-dialog.mjs` | 7 PASS / 0 BLOCKED（2026-11-22） | WPF 模态 class=`HwndWrapper[...]`、owner 主窗口 disabled、UIA 5 元素、capture-only 可用、native scan=null |
| Chromium 文件/打印 | S3 | `node evals/probe-chromium-dialogs.mjs --browser chrome` | 1 PASS / 2 BLOCKED（2026-11-22） | 页面可加载；合成 click 未弹出 file chooser；Ctrl+P 未产生可识别 print 窗口 → BLOCKED |
| 跨 IL / UIPI | S3/S4 | `node evals/probe-cross-il.mjs --no-uac`；`--uac`（一次授权） | 只读 PASS；UAC 复跑 **7 PASS**（2026-11-22） | 高 IL sink/拒绝有证据（sink RID 12288/rank 2；helper medium/rank 1；`uipi`/0 events）；`IntegrityRank` off-by-one 修正后复跑 7 PASS / 0 BLOCKED / 0 FAIL |
| 原生 Button 触发 | S3 | `node evals/probe-native-button.mjs` | 4 PASS / 0 BLOCKED（2026-11-21） | 自建 WinForms Delete + MessageBox：原生触发 1.2s 返回、opened=1；native-dialog 点 No、cancelled=1；10s latch 阻止重复 |
| 实验后台输入 | S1/S4 | `node evals/probe-background-input.mjs`（可加 `--elevated`） | 默认 14 PASS / 1 BLOCKED；提权 14 PASS / 0 BLOCKED（2026-11-21） | 自建 native message/pointer/touch-only/mouse-only/cover：B0 click/text/key、B1 synthetic、B1 WM_TOUCH-only、B1 mouse-only 鼠标提升、B3 window 通过；B1 光标用 helper 注入窗口内 `cursorDrift=0` 判定，外部漂移不再污染；严格 B2 非提权 `BlockInput` 被拒 → BLOCKED，`--elevated`（UAC）**PASS**（125ms、`inputBlocked=true`、`cursorRestored=true`、`inputUnblocked=true`）；`cursor-clip` PASS；0 FAIL |
| oracle 变异 | S1-S4 | `node evals/oracle-mutation.mjs` | 37 条可变任务 | 错误但像成功的产物必须让 oracle exit 1；t04/t07/t13/t21 按原因 SKIP |
| AC6 成本 | S1-S4 | `node evals/ac6-summary.mjs --reports <report>` | per-task token/步数 | 读 `status/step_end.usage`，输出中位数/p90 与 billable |
| 驱动形态 | S2 | `node evals/probe-driver-shape.mjs` | 1 项 | 默认/显式 tree_format、window_bounds、frame/screenshot_frame、session、zoom MIME、click 回执 |
| native freshness | S2 | `node evals/probe-native-freshness.mjs` | 2 项 | 文本变化后 driver 截图与插件 native 图的 hash/字节数是否更新 |
| dsh 真机加载 | S1 | `dsh --profile headless --patch ...` | 5 步 | 插件注册、真实工具调用、dispatcher 路由、prompt cache |
| 平台套件 | 可选 | `node evals/probe-platform.mjs` | 1 项 | win32 + PowerShell + 任务定义 → PASS；非 Windows → BLOCKED（Linux 非门禁） |
| 真桌面闭环 | S1 | `node tests/live-action.e2e.mjs 3` | 23 项 × 3 轮 | 真实输入/焦点/窗口选择/剪贴板/验证 |
| 任务级评测 | S1-S4 | `node evals/headless-run.mjs --stage S1` | 41 条任务 | 多步任务收敛、步数/成本、模型行为（Web runner 已退役） |
| oracle 验证 | S1-S4 | `node evals/verify-oracles.mjs --stage S4` | 41 条（t13 可 SKIP/ENV） | setup 必 ok → 空跑必失败 → simulate 必过 → cleanup 干净 |

> 规模列中的 PASS/BLOCKED 是**最近一次真机结果**，日期随行标注；历史轮次见 [EVIDENCE](EVIDENCE.md)。

### 2.1 S1-S4 阶段

| 阶段 | 定义 | 非任务层 | 任务成员 |
|---|---|---|---|
| **S1 基础功能** | 单应用、确定性终态、基本 UI 原语 | 离线 31/774、`verify-runtime` 18、`live-action` 23、`probe-winui-keys` | t01/t03/t04/t05/t06/t07/t09/t10/t21/wa2（10） |
| **S2 像素定位** | 坐标、像素、拖拽、zoom/from_zoom | `observe.coords`、`human.click`、`action-bounds` 坐标用例；from_zoom/modifier/private-drag/driver-shape/native-freshness 探针 | t11 / dpi01 / p01 / p02 / p03（5） |
| **S3 覆盖面任务集** | 多应用/文件/Office/浏览器/委派/导航/对话框/恢复/安全契约 | — | t12–t20、t22、t23、w01/w02/sec01–sec04/rec01–rec03/combo01/combo02/b01/term01/a11y01/x1（26） |
| **S4 Dirty 能力任务集** | 脏桌面下的任务收敛、焦点、用户状态保留与清理 | `probe-combo-foreground` | t11–t18/t23/sec01–sec04/combo01/combo02/rec02/rec03（17） |

阶段是**成员标签，可重叠**：S1 10 / S2 5 / S3 26 / S4 17，成员合计 58，唯一任务 41。t11=S2+S4；t12-t18=S3+S4；t23/sec01–sec04/combo01/combo02/rec02/rec03 也含 S4；x1=S3。

边界：S2 的 p01-p03 需要 image 能力；S4 已给 t11–t18/t23/sec01–sec04/combo01/combo02/rec02/rec03 加 sentinel（窗口/身份/文件），sentinel 失败即 fail；`both` 任务在 clean 模式不建 sentinel，在 dirty 模式建。t13 仍是真实网络 `ac2:none`；t18 本地下载补 AC2。

## 3. 离线套件（`npm test`）

| 套件 | 断言 | 主要覆盖 |
|---|---:|---|
| `posture.smoke.mjs` | 37 | 零审批姿态、密码硬保护（AX/UIA/结构位/掩码）、极危注记、桌面降级、快照新鲜度、执行侧接线、zoom pid/500px/fromZoom、compact 明确失败 |
| `tools.smoke.mjs` | 28 | stop/resume 锁存、verify unknown≠成功、wait_for 超时、clipboard/menu/hover、失败回执、engineRefusal、menu 路径指引（`/`、`->`、`→`） |
| `delivery-chain.smoke.mjs` | 12 | 真实 `cuaDeliver`：三级链/恢复、hotkey 不 L3、background/foreground 模式、无 pid、未确认恢复、L3 重试失败不假报完成 |
| `schema.conformance.mjs` | 47 | 23 个工具 / 47 个场景，按声明 schema 严格校验正常/拒绝/驱动错误/降级/query 只读/窗口激活/modifier click 形态 |
| `observe.dedup.mjs` | 17 | summary/brief/off、force、动作后全量、标题/值/enabled/selected/actions 变化、时间噪声 |
| `observe.truth.mjs` | 29 | 输入值外显/预填字段优先 set_value、密码隐藏、标题/值/字符数差分、降噪 stub 关键控件、同标题多窗口警告、中英别名、Document 正文不泄露、顶层菜单栏、文档不置脏、query 只读/旧快照已清除、无目标跳过 shell 表面、另存为默认目录提示、地址栏建议提示 |
| `observe.coords.mjs` | 20 | 文本 `@(x,y)` == 结构化 `elements.x/y` == 减窗口原点；window_id 精确匹配；同 pid 多窗口 z 序；缺 bounds 降级；overlay 过滤；z 序提示；源图尺寸提示；native 快照 id + 全局单例；跨窗口旧 id 拒绝 |
| `key.xaml.mjs` | 39 | XAML 无 AcceleratorKey 指引；auto 两次 token 点击；歧义/缺失/非白名单不回退；投递失败不 ok:true；对话框 press_key 回退并指向 set_value 覆盖；alt+f/ctrl+a 的 xamlPressFallback；组合键默认前台；win+r fail-closed |
| `menu.receipt.mjs` | 8 | `effect:unverifiable`/effect 缺失必须 ok:false + 先观察；confirmed 成功；数组 path 可用 |
| `human.click.mjs` | 23 | 元素点击 TTL、background 不滑行、auto 单次/human 5 段/off 零移动、同目标跳过、tokenless 回退、from_zoom 映射/缺失/跨窗口拒绝、modifier 规范化/自动前台/非法值 |
| `action.echo.mjs` | 41 | 坐标/元素回显、密码值隐藏、重复点击抑制、观察变化放行、actionGuard=off、double_click 不拦、modifier 签名区分、app_launch 语义、activate、stale 清快照、verifyAfterAction、输入回读/保存门禁、set_value、Document 不泄露、菜单注记、无 Document type 保留快照、标题栏拖动注记/清快照 |
| `delivery.failures.mjs` | 33 | background/foreground/delivery_failed 对 click/type/scroll/drag/set_value 全部 ok:false；纯 unverifiable 仍 ok:true；`background_delivery_failed` 是升级建议；click/key/type 驱动超时回执分别指向对话框/不重复按键/部分写入；候选 window_id、目标已消失、enforce 消费 |
| `delivery.foreground.mjs` | 23 | 真实 `cuaDeliver`：force + foreground_unavailable → 精确 window_id 的 L3 → 恢复；重试失败如实报未送达；hotkey 升级；非 foreground 异常保持抛出；force + unverified 指针前置单次；type 不前置；preflight bring/click 超时透传 |
| `observe.failure.mjs` | 10 | notFound/不同窗口降级保留旧快照；同窗口降级清空；overlay 拒绝保留；suspect 后去重强制全量 |
| `trajectory.test.mjs` | 18 | 文本脱敏、驱动归属、AX 树不落盘、computer_do 透明、unverified/stub/suppressed/移动数、动作后复核不误报、modifier 独立签名、driver 手势参数保留 |
| `eval-safety.mjs` | 83 | 禁止按进程名杀；Explorer/Paint/Office/浏览器状态化 Open/Close；Notepad ProtectHwnd/orphan seed；标签枚举/ExpectedTabs/owned 对话框/UIA 关闭/测试标签丢弃；同 pid 模态归属；dirty helper/Downloads hash 清理 |
| `notepad-tabs.test.mjs` | 10 | 纯标签分类：精确/额外用户标签/已修改/未知后缀/双标签/数量不符；Save As 后允许的最终标签；TabState 只清测试路径 |
| `task.tool.mjs` | 17 | 子 agent 请求构造、结构化结果、超时、无服务配方、outputSchema 降级、预算 |
| `config.plumbing.mjs` | 33 | 30 个 Config 键 ↔ `cfg` ↔ 读取点三向比对；行为哨兵；数字 window/window_id 提示归属 |
| `action-bounds.mjs` | 37 | 无快照/窗口绑定/window_id 透传/suspected_noop/指定窗口 fail-closed/set_value/密码硬拒；drag steps/duration/from_zoom/zoom 缺失/非法参数；modifier/dwell 私有路由、屏幕坐标、modifier+from_zoom 拒绝、缺 frame 拒绝 |
| `dispatcher.test.mjs` | 36 | dispatcher/hybrid 注册面、catalog、隐藏工具不可直调、guard/stop/resume、参数校验、图片透传、data 字段、工具面稳定、宿主 schema、click modifier/drag from_zoom+steps、通用快照前置描述 |
| `driver.normalize.mjs` | 23 | 0.23.2 与 0.53 fixtures 归一化一致；未知字段保留；坐标空间校准 |
| `driver.capabilities.mjs` | 20 | 版本/能力/请求映射/自适应学习 |
| `driver.transport.mjs` | 13 | fake spawn：超时/非 JSON/contract/session/结构化退出；per-call 超时覆盖 |
| `driver.compat.mjs` | 6 | 真实 observe/refresh + 注入 transport 的端到端兼容 |
| `package-manifest.test.mjs` | 9 | 包名/仓库、peer/dev 依赖、dsh 兼容范围、发布文件、权限声明、测试脚本 |
| `proc-run.test.mjs` | 3 | 子进程超时（close 抢跑不丢 `timedOut`）、正常退出、spawn 失败不误报超时 |
| `native-dialogs.test.mjs` | 18 | 空 AX→native-dialog 合成按钮；native click 不走驱动；坐标/键盘/滚动/双击/右键拒绝；off/非模态回退；失败不消费；allowedApps/snapshot_id/UIA 复核；sidecar JSON/base64/超时 |
| `background-input.test.mjs` | 52 | 实验后台输入：click/type/key 接入；off/foreground/modifier/组合键回退；拒绝不重试；回执字段/错误码；client 就绪/超时/坏响应/旧进程 exit 竞态；分类器/坐标/VK；B0/B1/B2/B3 路由、遮挡不降级、密码拒绝；`cursor-clip`/`desktop_busy`/诊断透传；B3 外部移动回执；`syntheticPointer:promote` 路由与 pointer 契约不接管；G5b/I6b：UIPI 拒绝不落入 `unverifiable`、高 IL profile fail-closed |
| `native-menus.test.mjs` | 18 | 经典 HMENU 兜底：off 零调用；驱动拒绝后才回退；confirmed/unverifiable/effect 缺失/超时不回退；no_hmenu/timeout；resolve/invoke/base64/超时/非零退出；resolved hwnd/stage/诊断 |
| `native-button-trigger.test.mjs` | 12 | 原生 Button 触发：off 零调用；Button 命中不走 driver；非 Button/坐标/多击/modifier/foreground 不触发；pre-delivery 回退；owner_disabled/timeout/latch 不回退 |

合计 **774** 项；新增/删除断言后以 `npm test` 实际输出为准，并同步 `tests/docs.facts.json`。

### 3.1 共享脚手架

`tests/lib/harness.mjs` 提供：

- `makeWorkCopy()`：把 `index.js` + `lib/` 复制到 `.dsh-test/<prefix>-*`，保证 `@deepseek-ai/schemastery` 能沿目录树解析；
- `writeStubDriver()`：用可编程源码覆盖工作副本的 `lib/cua.js`；
- `makeCtx()`：捕获注册、提供假 `attachments`/`llm`/`approval` 服务与 `exec`；
- `validateSchema()`：与 dsh 严格语义对齐（`additionalProperties:false`、`required`、`type`、`oneOf`、`enum`、`items`），且按 JSON 往返后的值校验；
- `makeChecks()`：统一 `✅/❌` 记录与失败计数。

### 3.2 为什么 schema conformance 这么重

dsh 0.2.2 会对工具输出做严格校验。观测降级回执曾漏声明 `window/elementCount/mode/elements/visualOnly/driverAccess`，导致 `screen_zoom` 的降级路径整次 `invalid output`——工具等于不可用。`schema.conformance` 把实现可能返回的每种形态都对着声明 schema 校验；新增字段/新工具必须同时加场景。

`delivery-chain` 曾经用一份复刻的 `cuaDeliver` 测复刻，真实实现改动测不出来；现在通过 `opts.call` 注入假驱动，直接覆盖真实函数。

## 4. 运行时验证（真驱动）

```bash
node verify-runtime.mjs
```

前提：`cua-driver` 可用；当前桌面有可见窗口；Node 22。检查项（18）：

1. dispatcher 可见工具 = `computer_do` + `screen_observe`；
2. catalog 覆盖 21 个隐藏工具；
3. 注册面仍只有 2 个；
4. `screen_observe` 含 native 模式；
5. `screen_zoom` 在 catalog 中；
6. 无快照动作被拒（`[snapshot_missing]`）；
7. `screen_observe(ax)` 真实引擎返回树；
8. 文本 `@(x,y)` 与结构化 `elements` 坐标一致；
9. `native` + text-only route 优雅拒绝；
10. `native` + image route 图片落盘；
11. native 文本回显当前快照 id；
12. native render 产出 `{type:"image"}` 内容块；
13. `screen_zoom` 区域截图；
14. `screen_zoom` 经 dispatcher 的 render 图片块；
15. vision 无 key 优雅降级；
16. 坐标语义标注（窗口截图原图像素）；
17. `coordinateSpace === 'window-screenshot-px'`；
18. `screenOrigin` 元数据存在。

脚本只读观察，不执行桌面动作；窗口每次从 `list_windows(on_screen_only)` 发现，不写死 PID；选择时跳过 `0×0` shell 弹窗与驱动自身窗口。

### 4.1 dsh 真机加载（headless）

```bash
dsh --profile headless --patch "<repo>/evals/headless-patch.yml" \
  --permission-mode read-only --approval-policy never \
  "调用 computer_do(action='status')，把返回原文贴出来"
```

- `headless` 默认禁用 `credentials`；overlay 必须显式启用，否则会在 LLM 路由报 `MISSING_CREDENTIAL`，不是插件加载错误。
- 2026-11-12 实测：dsh 0.2.2-rc.1 + 默认 DeepSeek 通道，1 轮 5 步完成 `status` / `screen_observe` / `catalog` / 隐藏 `computer_wait`；当时 2 可见/20 隐藏；`cacheReadTokens` 6528→7296。
- 证据见 [EVIDENCE](EVIDENCE.md) §26.1。

### 4.2 headless eval smoke

```bash
node evals/headless-run.mjs --tier smoke --timeout-min 10
```

复用 setup/oracle/cleanup，逐条保存 `evals/headless-runs/<stamp>/<task>-r<n>.jsonl`，统计 pass/fail、工具错误、未验证、超时。`timedOut`/`budgetExhausted`/`noFinal` 分开记录；撞满 `--timeout-min` 且没有 `final` 的样本记 `verdict=timeout`，不再混成普通 fail。前置：headless profile 可解析 `dsh-win-computer-use`；`DSH_BIN` 可覆盖 dsh entry；`TEMP/TMP` 自动归一化。2026-11-12 两轮 smoke **7/8**（Round 2 4/4）；详见 [EVIDENCE](EVIDENCE.md) §26.3。

> **Web runner 已退役**：`evals/run.mjs` 的 UI 选择器/发送路径基于 dsh 0.1.5；在 0.2.2 上创建空会话、`steps` 误读。现在默认拒绝运行并提示改用 headless runner（`--allow-legacy-web` 仅旧 UI 调试，`--dry-setup` 仍可用）。

## 5. 真桌面闭环

```bash
node tests/live-action.e2e.mjs 3
```

设计要点：

- 用**唯一命名临时文件**打开记事本，做确定性窗口选择，避免桌面已有多个记事本时选错；
- 流程：observe(ax) → 找文档元素 → `computer_type`（`effect:confirmed`）→ **脚本自读 UIA 文档文本含标记**（独立见证）→ `computer_verify` 窗口谓词 satisfied / 自输入文本 `unknown+untrusted_source` → 未知参数拒绝 → 剪贴板往返 → `computer_wait`；
- 不杀进程：Win11 记事本可能同时持有用户未保存文档；脚本只报告残留标签，由人工关闭；
- 最近一次：23/23（2026-09-17，重设计后）；0.52.13 canary 33/33（详见 [EVIDENCE](EVIDENCE.md) §22.2）。

### 5.1 密码框冒烟（`tools/password-probe.ps1`）

```powershell
powershell -ExecutionPolicy Bypass -File tools/password-probe.ps1
```

期望：结构位标记命中；`computer_type` / `computer_set_value` 对密码框硬拒；普通输入框零误拒。

> **不再使用的旧验收项**：旧版 `WINDOWS_TEST.md` 曾要求“危险词按钮 → 触发审批”。审批网关在 0.4.0 已删除；现在的正确验收是 `extremePatterns` 命中 → 结果附警告注记但**动作仍执行**、密码框硬拒、快照 TTL/无快照结构化拒绝、`computer_stop` 全工具锁存。

## 6. 任务级评测（S1-S4，`evals/`）

```bash
node evals/headless-run.mjs --stage S1 --timeout-min 10
node evals/headless-run.mjs --stage S2,S4 --timeout-min 15
node evals/headless-run.mjs --tasks t01 --repeats 3 --timeout-min 10
node evals/headless-run.mjs --tier smoke --timeout-min 10   # 旧调度标签
node evals/verify-oracles.mjs --stage S4
```

- 任务集 41 条：S1 10（t01/t03/t04/t05/t06/t07/t09/t10/t21/wa2）+ S2 5（t11/dpi01/p01/p02/p03）+ S3 26（t12–t20、t22、t23、w01/w02/sec01–sec04/rec01–rec03/combo01/combo02/b01/term01/a11y01/x1）+ S4 17（t11–t18/t23/sec01–sec04/combo01/combo02/rec02/rec03）；成员合计 58，任务可重叠。`tier`（smoke/core）是旧调度标签，不是阶段。
- `--tasks` > `--stage` > `--tier`；`--stage` 无匹配时退出非 0；无参数仍按旧 smoke 运行。退役任务见 [evals/RETIRED](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/evals/RETIRED.md)。
- oracle 一律 PowerShell/Win32 确定性读，不用模型自评；`setup` 预置到决策点，`oracle` 判定，`cleanup` 清沙箱，`simulate` 用于 AC2 双向验证。
- `verify-oracles` 判据：setup 必 ok → oracle 空跑必失败 → simulate 后必通过 → cleanup 干净；**2026-11-20 全量 22/23 PASS + t13 SKIP（0 FAIL/ENV/dirty）**。若 PowerShell 报 `Add-Type` 找不到 `C:\Windows\TEMP\*.cs`，先把 `TEMP`/`TMP` 指到 `%LOCALAPPDATA%\Temp`。
- 报告（`evals/report-last*.json`）是**真值产物，不入库**；仓库只进 runner/任务/oracle。
- 基线不是通过率承诺；逐轮结果见 [EVIDENCE](EVIDENCE.md)。

### 6.1 verifyAfterAction A/B

只改配置，不改插件默认值。两份 patch 除 `verifyAfterAction` 外必须完全一致；实验 patch 放 `evals/headless-runs/ab/`（gitignore），不提交。

```bash
node evals/headless-run.mjs --tasks t01 --repeats 5 --timeout-min 12 \
  --patch evals/headless-patch.yml --report evals/headless-runs/ab/off-t01.json
node evals/headless-run.mjs --tasks t01 --repeats 5 --timeout-min 12 \
  --patch evals/headless-runs/ab/verify-auto.yml --report evals/headless-runs/ab/auto-t01.json
node evals/ab-summary.mjs --dir evals/headless-runs/ab --tasks t01,t05
```

- 交替跑 off/auto（每轮 `--repeats 1` 最稳）抵消机器漂移；两臂不要并发。两臂 patch 必须都固定 `agent-default-model`；dsh 0.2.2 不支持 seed/top_p，重复测试只能按统计分布解读。
- report 带 `patchPath/patchSha256/wallMs/innerSteps`；trajectory 分析用 `node evals/analyze-trajectory.mjs <file> --json`。
- 决策规则：pass 不下降；median steps/duration 不恶化超过约 15%；p90 不恶化超过约 25%（n<8 标 `p90Unstable`）；没有新增 dirty/timeout；strategy 分布不更偏 exploratory。否则保持 `off`。
- 2026-11-16 首轮 **10/10 pass**；auto 中位略优但有 533s 尾部、每轮多 2–12 次复核，默认保持 `off`。详见 [EVIDENCE](EVIDENCE.md) §24.3。

### 6.2 S4 脏桌面套件（t11-t18）

这组任务不建干净 VM/专用 Windows 用户，直接使用当前桌面和用户已打开的应用；通过 task md 的 `- **isolation: dirty**` 跳过 Notepad TabState backup。用户已有 Notepad/Paint/Office/浏览器窗口不关；只关闭 setup 记录的“测试新建 HWND/文档”，证明不了就 `leftover + dirty`。

| id | 任务 | 依赖 | oracle |
|---|---|---|---|
| t11 | Paint 鼠绘复刻 | Paint + 浏览器参考窗 | PNG 800x600 + 三色 ROI mask/bbox/覆盖率容差 |
| t12 | PPT 布局复刻 | PowerPoint + 浏览器参考窗 | 单页 16:9 + 标题/副标题 + 三色 bar/Q1-Q3；fixture simulate 后 oracle 通过 |
| t13 | 论文下载 | 用户浏览器 + 网络 | 用户 Downloads 中新增 PDF 的 SHA-256；真实网络，`ac2:none` |
| t14 | Excel 数据+柱状图 | Excel | XLSX XML 24 单元格 + chart part；fixture simulate |
| t15 | Explorer 多文件整理 | Explorer | 精确文件系统终态（8 文件，先重命名再移动） |
| t16 | 本地浏览器表单 | 用户浏览器 + 本地 server | result.json 精确字段 |
| t17 | PDF 定位+摘录 | 浏览器 PDF + Excel | XLSX A1 精确文本（不 Trim）；fixture simulate |
| t18 | 本地 PDF 下载 | 用户浏览器 + 本地 server | 新增 PDF 的 SHA-256 == fixture hash；AC2 full |

```bash
node evals/verify-oracles.mjs --tasks t11,t12,t13,t14,t15,t16,t17,t18
node evals/headless-run.mjs --tasks t15 --repeats 5 --timeout-min 20 --patch evals/headless-patch.yml
```

- `ac2: none` 只剩 t13（真实网络）在 verify-oracles 中显示 **SKIP**，表示 setup/oracle-empty/cleanup 已验，但无 simulate；不是假 PASS。t12/t14/t17/t18 均有 simulate。
- setup ENV（应用缺失/网络不可达/浏览器不能新开窗口）在 headless-run 记 `verdict=env`，不混入 pass/fail。
- t13 复用用户浏览器：下载目录是真实 Downloads；oracle/cleanup 只考虑任务开始后新增且哈希匹配的 PDF，绝不删除用户已有文件。
- 逐轮步数与失败样本见 [EVIDENCE](EVIDENCE.md) §2 与 §22–§24；模型行为分析见 [TRAJECTORY-ANALYSIS](TRAJECTORY-ANALYSIS.md)。

### 6.3 S2 像素/OCR/zoom 任务

| id | 任务 | 依赖 | oracle |
|---|---|---|---|
| p01 | 无坐标 canvas 红圆点击 | 浏览器 + 本地 pixel server | 点击 cell == C2 |
| p02 | 像素 token 读取输入 | 浏览器 + canvas + 输入框 | server token == P02-7K9 |
| p03 | screen_zoom 小目标点击 | 浏览器 + 密集 canvas | 点击 cell == D3 |

- 三条任务都要求 image 能力（native/zoom/vision）；text-only 路由失败，不记 ENV。
- p01/p02/p03 的 oracle 只读 server 写入的 `out/result.json`，不依赖模型自评；`hit/ok/cell` 使用严格布尔与 `-ceq`，字符串 `"false"` 不能通过。
- `node evals/verify-oracles.mjs --tasks p01,p02,p03` 必须三项 PASS。
- 2026-11-20 opencode 真跑：p01 **pass 6 步**、p02 **pass 11 步**、p03 **pass 8 步**。

### 6.4 S3 导航/对话框

| id | 任务 | 依赖 | oracle |
|---|---|---|---|
| t19 | Explorer 地址栏导航 | Explorer | 从用户目录导航到 `{task_dir}\nav` 并写 `NAV-OK` |
| t20 | 确认/取消对话框链 | 本地 WinForms app | result.json 有 cancelled=1、confirmed=1、deleted=true |

- t19 的 setup 不预置到目标目录；地址栏/Ctrl+L 是任务本身。
- t20 第一次 Delete 必须选 No/否，第二次选 Yes/是；只读 result.json 判定。
- 2026-11-20 最新 P0/P1 复跑：t19 **2/2 pass**（inner 70/48，steps 71/49，652/454s；`win+r` 归零，但 r1 从 40→70 inner 回归）、t20 **2/2 pass**（inner 27/25，steps 30/27，626/601s；30s 超时仍多，候选 window_id 已出现）、t05 **2/2 pass**（inner 10/15，steps 10/16，86/106s；零 `type` 改文件名、无 `src` 残留）。
- 上一轮题面修复后（同日更早）：t19 inner 40/56（387/595s）、t20 27/25（595/618s）、t05 21/13（185/121s）；再往前 t19/t20 各 1 pass/1 预算耗尽。保留为历史，不与最新结果混比。
- t19/t20 cleanup 会关闭模型自开的测试 Notepad；t20 先关 owned Confirm 模态，close 仍失败时按 pid+start 证明后结束测试进程。

## 7. 回归守门（代表性缺陷）

| # | 缺陷 | 根因 | 守门 |
|---|---|---|---|
| 1 | 插件整棵树加载失败 | 丢了 `defineTool()` 返回值；原始字面量被 `assertSupportedJsonSchema` 拒 | 真机 headless 探针（离线假注册表无校验） |
| 2 | 所有工具调用报 `reading 'kind'` | 订阅 `tools/post-execute` waterfall 却不调 `next()` | 真机探针 + 约定：只订阅 `tools/result` |
| 3 | 观测降级整次 `invalid output` | 降级回执字段未声明 | `schema.conformance` 降级场景 |
| 4 | 结构化拒绝被当成功 | `{refusal:{code}}`/`effect:refused` 分散判断 | `receipt.js` 单一出口 + schema 拒绝场景 |
| 5 | 坐标点击整体偏移 | 元素 frame 是屏幕 px，点击是窗口截图 px | 坐标标定 + observe 输出换算 |
| 6 | Windows 密码框保护静默失效 | guard 只匹配 macOS 角色 | `roles.js` 三态 + sidecar 结构位 |
| 7 | 结构密码标记标错相邻元素 | 旧假设“窗口本地+原点换算” | A6 端到端 + 屏幕坐标直配 |
| 8 | `type`/`key` 盲发前台 | 无 element/无快照时退回 desktop | `action-bounds` P0-1/2 |
| 9 | `suspected_noop` 报成功 | `engineRefusal` 未识别 | `action-bounds` P0-4 + `receipt` |
| 10 | 指定窗口未匹配却观察最前窗口 | 静默回退 | `action-bounds` P0-5 |
| 11 | 观察降噪误判“未变” | 旧哈希只看 label | `observe.dedup` 值/enabled/selected/actions |
| 12 | 投递链测试测的是复刻 | 测试替换整个 `lib/cua.js` | `delivery-chain` 真实函数 + `opts.call` |
| 13 | 文本元素坐标与点击空间不一致 | `renderLine` 用原始 frame，结构元素已减原点 | `observe.coords` + `verify-runtime` #8 |
| 14 | `menu` 把 `effect:unverifiable` 报成功 | 只判 refusal | `menu.receipt` |
| 15 | eval setup/cleanup 危及用户 Notepad | 按进程名/宽匹配杀 | `eval-safety` + `Open/Close-TestNotepad` |
| 16 | 元素点击绕过 TTL + 滑行偏移 | 快照存屏幕坐标；resolve 不查 freshness | `human.click` + `observe.coords` |
| 17 | 投递失败被当成功 | `engineRefusal` 不认 delivery codes | `delivery.failures` + `delivery-chain` |
| 18 | 新 Notepad 窗口恢复用户标签 | 只比较 HWND 新旧 | `notepad-tabs` + `eval-safety` |
| 19 | 元素点击滑行跨屏大弧线 | 屏幕坐标起点未减窗口原点 | `human.click` + trajectory |
| 20 | 另存为文件名盲区导致保存循环 | observe 用 `label || value`，隐藏旧值 | `observe.truth` + `action.echo` |
| 21 | 强制前台失败后无路可走 | force 直接返回，不尝试 `bring_to_front` | `delivery.foreground` + `delivery-chain` |
| 22 | 连续点击同一目标 | 回执 unverifiable + 无重复抑制 | `action.echo` + `loopGuard` |
| 23 | 5 段滑行 15–18s/点击 | 驱动单次移动 2–3s；旧 auto 仍 5 段 | `human.click` + `cursorMotion` |
| 24 | 轨迹工具计数翻倍 | 外壳与内层都记 `tool_end` | `trajectory.test` |
| 25 | 裸 `screenshot_context_missing` 假成功 | `engineRefusal` 不认裸 code | `action.echo` E31/E32 + `action-bounds` D11/D12 |
| 26 | native 观察无 snapshot id | 只 ax 分支打印 id | `observe.coords` C19/C20 + `verify-runtime` #11 |
| 27 | 密码框点击回显值 | `describeClickTarget` 未查 `is_password` | `action.echo` E33 |

## 8. 新增测试/工具

新增工具时至少补：

1. `schema.conformance`：正常/守卫拒绝/驱动拒绝/降级等返回形态；
2. `dispatcher.test`：若隐藏，校正 catalog 与可见/隐藏数量；若热工具，校正 hybrid 面；
3. `action-bounds`：无快照、窗口绑定、参数缺失/未知参数；
4. `config.plumbing`：若新增配置键，补 schema↔cfg↔读取点与行为哨兵；
5. `package-manifest`：若新增发布文件/依赖/权限，更新断言；
6. `docs/TOOLS.md` / `docs/CONFIGURATION.md` / `docs/ERRORS.md`：同步契约；跑 `npm run check`；
7. 新增/移动评测任务：更新 `stages` 元数据与 `tests/tasks.check.mjs`；跑 `node evals/verify-oracles.mjs --tasks <id>`；
8. 真机：`verify-runtime`（只读）与必要的 live e2e。

改工具描述/参数时，建议在**仓库外**跑一次性工具面 JSON dump（描述/参数/输出 schema/render/execute arity），改前存基线、改后 diff；工具面是模型看到的全部接口，漂移即回归。

## 9. 排障

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERR_MODULE_NOT_FOUND @deepseek-ai/schemastery` | `node_modules/@deepseek-ai` 为空 | `npm install`（peer/dev 依赖已声明） |
| `npm test` 输出全绿但退出码非 0 | 只看了前面套件输出 | `npm test; echo $?`；用 `set -e` |
| schema 测试报 `undeclared property` | 输出多返回了字段 | 补 schema 或删字段；保持 `additionalProperties:false` |
| 真机 native 整次失败 | 宿主严格输出校验 + 降级字段漏声明 | 跑 `schema.conformance` 的降级场景 |
| live e2e 选错窗口 | 桌面有同名/残留记事本 | 用唯一命名临时文件；按标题精确匹配，不按进程名 |
| 截图断言 0B | 选中 `0×0` shell 弹窗 | 选择窗口要求 `bounds > 0` |
| `verify-runtime` 失败 | 驱动自身/0 元素 shell 表面被选中 | 排除 `cua-driver`、CmdPal/输入法等 shell 表面与 `0×0` 窗口；优先选有可定位 AX 元素的窗口 |
| evals 某个任务超时 | 残留窗口/驱动 daemon 挂死 | 先 `maintain.mjs`/`stop-stale.mjs`；清理残留后复跑 |
| Windows 动态 import 报绝对路径 | ESM 需要 URL | 用 `pathToFileURL()` |
| `docs:check` 报链接/数字不一致 | 文档漂移 | 按 file:line 修；数字以 `tests/docs.facts.json` 为准 |

## 10. 当前基线

| 项 | 值 |
|---|---|
| 离线 | 31 套 / 774 ✅ / 0 ❌ |
| 语法 | 57/57 JS + `bash -n` 两脚本 + 文档/任务检查 |
| 运行时 | `verify-runtime` 18/18（Windows 11；0.23.2 基线 + 0.52.13 canary） |
| dsh 真机 | headless 1 轮 5 步（2 可见/21 隐藏；2026-11-12 当时 20 隐藏）；eval smoke 两轮 7/8（Round 2 4/4）；t01 新题面 5/5；t05 3/3 |
| S4 真机 | 最新：t11 70 步 pass、t12 100 步 pass（2026-11-18，0.52.13 + opencode-go）；t14/t15/t17 见 EVIDENCE |
| 真桌面 | `live-action.e2e` 23/23（2026-09-17） |
| 评测 | 41 条任务：S1 10 / S2 5 / S3 26 / S4 17（成员 58）；t12/t14/t17/t18/p01-p03/t19/t20/t21/t22/t23/w01/w02/sec01–sec04/rec01/rec02/rec03/combo01/combo02/b01/term01/a11y01 均有 simulate；仅 t13 仍 `ac2:none`，其 SKIP 不是 PASS |
| AC2 全量 | 2026-11-20 基线 **22/23 PASS + t13 SKIP**（0 FAIL/ENV/dirty）；2026-11-21 P0/P1 新增 **19/19 模式运行 PASS**（t21/t22/t23 clean+dirty/w01/w02/sec01–sec04/rec01/rec02/combo01/combo02/rec03/dpi01/term01/b01/a11y01）；**variant 1-3 回归 9/9 PASS**（t21/t22/a11y01 各 3 个 variant，2026-11-21） |
| oracle 变异 | 2026-11-20 基线 **19/19**；2026-11-21 P0/P1 抽样 **13/13 PASS**（t22/w01/sec01/sec02/rec01/rec02/rec03/combo01/combo02/b01/term01/a11y01/dpi01；其余新增待补跑）；参数化回归 t22/a11y01 **2/2 PASS**（mutation 固定 variant 1；t21 无产物按原因 SKIP） |
| 真机探针 | 2026-11-20：probe-ops **11 PASS + 1 BLOCKED**（WinForms menu，当时）；probe-launch **7/7**（子进程 Medium 实测）；probe-modifier-drop **5/5**；safety **13/13**；scroll **3/3**；modal-timeout **10 PASS / 13 BLOCKED**、modal-escapes **6 PASS / 4 BLOCKED**；native-dialog **9 PASS / 0 BLOCKED**（根因见 EVIDENCE §18/§17）。probe-ops 最新为 2026-11-21 的 **13 PASS / 0 BLOCKED**（见 §2 表） |
| 模型真跑（最新） | 2026-11-20：opencode t19 **2/2 pass**（inner 70/48）、t20 **2/2 pass**（inner 27/25）、t05 **2/2 pass**（inner 10/15）；0 timeout/dirty；t20 30s 超时仍多但候选 window_id 已出现；t19 `win+r` 归零、r1 回归；t05 无 `type`/无 src 残留；见 EVIDENCE §19 |
| 模型真跑（上一轮/修复前） | 上一轮 t19 40/56、t20 27/25、t05 21/13；修复前 t19/t20 各 1 pass/1 预算耗尽（35/56、17/33），p01/p02/p03 6/11/8；保留为历史 |
| AC6 | 2026-11-20：t01/t05 各 5 轮（opencode）全 pass；t01 steps 中位 12 / p90 15（p90Unstable，n=5<8）、billable 10,731；t05 steps 24 / p90 47（p90Unstable）、billable 24,993；t11/t14/t15 未跑 |
| P0 基线 | t03/t04/t05/t07/x1 于 2026-11-19 变更判定/题面；旧结果只作历史，不与新结果混比 |
| P0/P1 新增模型 smoke | 2026-11-21：t21 **1/1 pass**（16 步，19753）；sec02 **1 次 12min timeout**（模型在 Notepad/fixture 间反复观察）；term01 **1 次 8min timeout**（模型打开 Notepad 而非控制台）；两者 AC2 均 PASS，cleanup 恢复 TabState |
| 跨屏模型跑 | 2026-11-22：dpi01 **1/1 pass**（3 步，inner 3，oracle clicks=1，0 dirty；plugin 0.5.8 + dsh 0.2.2-rc.5 + opencode-go/deepseek-v4.1-flash；wall 70s，total 33,038 tokens） |
| 常见对话框 | 2026-11-22：probe-common-dialogs **6/6 PASS**（Open/Save/Font/Color/Print；标准 `#32770`、`modal=owner-disabled`、Cancel `BM_CLICK`） |
| gesture truth | 2026-11-22：private **PASS**（down/move/up + Control）；driver 原生只有 down/up、无 move → **BLOCKED** |
| WPF 模态 | 2026-11-22：probe-wpf-dialog **7/7 PASS**（HwndWrapper、owner-disabled、UIA 5 元素、capture-only 可用、native scan=null） |
| Chromium 对话框 | 2026-11-22：页面加载 PASS；file chooser/print preview **2 BLOCKED**（合成 click 未弹出、Ctrl+P 无可识别窗口） |
| 跨 IL / UIPI | 2026-11-22：只读分类器 PASS；一次授权 UAC 返回 `uipi`/0 events；`IntegrityRank` off-by-one 修正后复跑 **7 PASS / 0 BLOCKED / 0 FAIL**（sink RID 12288/rank 2；helper medium/rank 1） |
| 打包 | 以 `npm pack --dry-run --json` 为准；当前值见 `tests/docs.facts.json` |

## 11. P2 设计与未闭合

- **参数化（已实现，3 条任务）**：`variants: N` + `evals/variants/<id>.json` 是唯一数据源；runner 通过 `S4_VARIANT` 传给 setup/oracle/simulate/cleanup，prompt 用 `{{key}}` 渲染。`headless-run --variants N` 与 `verify-oracles --variants N` 对声明任务跑 1..N；未声明任务只跑 variant 1。当前 t21（Calculator 除法）、t22（PPT 标题/副标题）、a11y01（键盘-only 文本）各 3 个 variant；mutation 固定 variant 1（case 按 variant 1 编写）。仍以 41 条任务为分母，variant 用于统计功效而非新增任务数。
- **可访问性**：`a11y01` 已实现键盘-only + UIA 名称 + 3 个输入 variant；高对比度/Narrator 全量验收仍未做。
- **Linux**：仅 Ubuntu CI 跑 `npm run check` / `npm test`；`probe-platform.mjs` 在非 Windows 只报 BLOCKED。无 Linux 任务套件，`verify-runtime` 可选；Linux 不作为发布门禁，文档不写“已支持”。
- **Windows 专项**：`probe-display` 已记录 2 屏/混合 DPI；`dpi01` AC2 已过，**真实模型跨屏点击 2026-11-22 PASS**（3 步，oracle clicks=1，0 dirty，plugin 0.5.8 + dsh 0.2.2-rc.5 + opencode-go）；`probe-common-dialogs` 对 Open/Save/Font/Color/Print 标准 `#32770` **6/6 PASS**；`probe-wpf-dialog` WPF 模态 **7/7 PASS**（UIA 可读、native scan=null）；`probe-gesture-truth` private PASS、driver 中间 move BLOCKED；Chromium file chooser/print preview 仍 BLOCKED；虚拟桌面无驱动原语且 `win` 组合键 fail-closed → BLOCKED；UAC/安装器、Protected View、IME、Electron、Settings、VLC 仍在 [BLOCKED](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/evals/BLOCKED.md)。

> 逐轮时间线、工具计数、失败模式见 [EVIDENCE](EVIDENCE.md)；模型行为分析见 [TRAJECTORY-ANALYSIS](TRAJECTORY-ANALYSIS.md)；当前矩阵见 [VERIFICATION](../VERIFICATION.md)。
