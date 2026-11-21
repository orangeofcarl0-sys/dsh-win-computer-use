# ROADMAP — dsh-win-computer-use

> 状态基线：`v0.5.9` 已发布（2026-11-22；npm `dsh-win-computer-use@0.5.9`，tag `v0.5.9`）；`main` = 0.5.9。
> 这是个人项目路线图，不是承诺清单。**触发条件**决定何时解冻；没有触发条件的事项不排期。
> 历史细节见 [CHANGELOG](CHANGELOG.md)；逐轮证据见 [docs/EVIDENCE.md](docs/EVIDENCE.md)。

## 1. 已交付（摘要）

| 版本 | 主题 | 关键结果 |
|---|---|---|
| 0.5.9 | 实验后台输入 + 原生菜单/按钮兜底 + UIPI 回执映射 | B0/B1/B2/B3（默认 off）、`nativeMenus`、`nativeButtonTrigger`、UIPI 拒绝分类；发布前 18/18、live 33/33、oracle 16/17+10/10、UAC 7/7 |
| 0.5.8 | t20 模态 30s 根因 + 原生对话框 + 回执/测试收口 | `nativeDialogs`（标准 `#32770` + `BM_CLICK`，9/9 PASS）；超时不再被前置动作吞掉；`win+r` fail-closed；`set_value` 新值回执/另存为提示；t05 副作用 oracle；评测预算语义 |
| 0.5.7 | 工具面收敛 + 安全边界 + 更名 + dsh 0.2.2 + 驱动兼容 | `dispatcher` 默认（2 可见/21 隐藏）；`dynamic` 删除；P0 无快照/窗口绑定/`suspected_noop`；`computer_set_value`；`computer_activate`；`startActivation`；`lib/driver/`；click modifier；私有拖拽；观察回执修复 |
| 0.5.6 | 委派降级阶梯 | `toolFilter` 被拒时只丢该约束，保住结构化输出；回执写明权限后果 |
| 0.5.5 | 动态工具面（已废弃） | 折叠 2 / 展开 21；工具面 −81%；因 cache 实测被 0.5.7 删除 |
| 0.5.4 | dsh 0.1.5 适配 + 坐标契约 + 上下文预算 | 点击坐标空间根治；观察降噪；紧凑回执；`computer_task`；eval 评测系统（原 S4）；结构治理 |
| 0.5.3 | 结构密码检测 | Windows UIA sidecar；结构位优先；快照新鲜度语义；视觉断言协议（原 S3a） |
| 0.5.2 | Windows 凭据保护 | `roles.js` 跨平台三态；修复 Windows 静默失效 |
| 0.5.1 | 结构重构 | `apply()` 384→44 行；图片持久化统一出口；移除家目录密钥扫描 |
| 0.5.0 | 工具改进包 | verify / wait_for / clipboard / menu / hover / stop / resume；12→19 工具 |
| 0.4.x | 无感自治 + zoom | 删除审批网关；三级投递链；`screen_zoom` 定位原语；虚拟光标主题 |

## 2. 当前优先（0.5.9 收尾）

| # | 事项 | 状态 | 说明 |
|---|---|---|---|
| C6 | web profile 部署 | 0.5.9 已安装，待重启 | web profile 安装物是 `0.5.9`（含 B0-B3/nativeMenus）；运行中的 web 进程需重启。见 [PUBLISH](PUBLISH.md) |
| C12 | eval 任务级复跑 + AC6 | 待排期 | 降噪/预算的 per-task token/步数对比；需空闲桌面与纯净 daemon |
| C13 | daemon 高完整性/清理 | 上游已关闭，保留观测 | #3607 已 completed；0.52.13 实测 daemon High 但 PowerShell 子进程 Medium，按实际 IL 清理 |
| C14 | #3908 实战影响面 | 跟踪 | WinUI3 hotkey/menu 不可达；已给控件指引 + 实验性回退 |
| C15 | macOS 回归 | 待环境 | 近期证据都在 Windows；macOS 仍是历史验证 |
| C16 | 驱动库存候补 | 待评估 | `browser_*`、`set_window_frame`、trajectory 录制/重放等 |
| C17 | 实验性后台输入（B0/B1/B2/B3） | 已实现，默认 off；真机提权轮 14/0 | 无交互 UIA 目标的消息/合成触控/光标/窗口锚定；B0/B1/B3 通过；`syntheticPointer:promote` 让普通 mouse-only 窗口收到 `MOUSEDOWN/MOUSEUP`；B1 光标用 helper 注入窗口内 `cursorDrift` 归因；严格 B2 默认非提权 BLOCKED，`--elevated`（UAC）125ms PASS；`cursor-clip`（ClipCursor 5×5）PASS；见 [BACKGROUND-INPUT](docs/BACKGROUND-INPUT.md) |
| C18 | 经典 HMENU 菜单兜底（nativeMenus） | 已实现，默认 off；真机通过 | 驱动 `invoke_menu` 结构化拒绝后 `GetMenu` 精确路径 + `PostMessage(WM_COMMAND)`；离线 18 项 + `probe-ops` SetMenu fixture 通过 |
| C19 | 原生 Button 触发（nativeButtonTrigger） | 已实现，默认 off；自建探针通过 | 标准 Win32/WinForms Button 唯一匹配 + `BM_CLICK`；t20 形态 1.2s、opened=1、latch 生效；t20 需显式 overlay 复跑 |
| C20 | Excel modifier drop 真机探针 | 分支已实现；复制仍 BLOCKED | `probe-modifier-drop --excel` 检测 Excel/COM/UIA、创建临时 xlsx、UIA `DataItem` 几何、Ctrl+drag、Ctrl+S、OOXML 校验、精确 HWND 关闭；当前拖拽已投递但 E2 未复制 → BLOCKED，不冒充 PASS |

> 0.5.7 的 C1–C5、C7–C11 已完成（文档体系、install 配置、task 描述、toolFilter 删除、scroll/drag snapshot_id、headless 加载、zoom 坐标语义、Web runner 退役、wa2 归因、dsh 0.2.2 升级）；细节见 CHANGELOG 与 EVIDENCE。

## 3. 事实澄清 / 实验（冻结，按触发条件解冻）

| # | 事项 | 状态/结论 | 触发条件 |
|---|---|---|---|
| A1 | dsv4fv 真实通道 native/vision | ✅ 2026-09-06：ax ✓、native ✓、vision 观察者半通；GLM 无 key 优雅降级 | — |
| A2 | GLM agent 跨 run 漂移 + SoM 标号绑定 | 未闭环；SoM 方案已因数据否决暂缓 | 像素路径要升级为常规路径时 |
| A3 | qwen3-vl 坐标帧错位根因 | 未闭环（代理缩图 vs 模型不确定） | 本地代理账号池稳定时 |
| A4 | 运行时验证（用户层覆盖退役/driverAccess/L3 恢复/crop 换算） | ✅ 2026-09-06 | — |
| A5 | dsv4fv OCR 数字噪声 | ✅ 可读 PNG 上 93 位零错误；zoom JPEG 小字不可读；模型 2/2 诚实拒答 | 独立观察者设计输入（原 S3b） |
| A6 | Windows 密码框投影探针 | ✅ 9/9（结构标记/硬拒/零误拒/时延/crop） | — |
| A7 | 坐标语义落点实验 | ✅ 六轮完成；0.23.2 混合 DPI 三假设均有反例 → 像素 best-effort；element 可靠 | 上游修复或换驱动版本时重测 |
| A10 | native freshness | ✅ 探针未复现“AX 已变而 PNG 不变” | 在 Paint/Office 复现时 |
| A20 | 经典 HMENU 菜单后端 | ✅ 离线 18 项 + 真机 SetMenu fixture 通过；MenuStrip/WPF/WinUI 明确不支持 | 用 regedit/MFC 交叉验证 |
| A21 | 原生 Button 触发 | ✅ 离线 12 项 + 自建 WinForms Delete/MessageBox 探针 4/4；默认 off | t20 overlay 复跑；WPF/WinUI/ToolStrip 仍回退 driver |
| 独立观察者 | 独立观察者裁决 / screen_assert（原 S3b） | 未做；视觉断言协议（原 S3a）已注入描述 | ZHIPU_API_KEY 或 dsv4fv 观察者文本输出修复 |

## 4. 驱动与上游

| 项 | 状态 | 影响/下一步 |
|---|---|---|
| [#3576](https://github.com/trycua/cua/issues/3576) 元素投影 `is_password` | 已提 | 插件用 sidecar 结构位兜底；上游落地后可简化 |
| [#3586](https://github.com/trycua/cua/issues/3586) 树 revision + 条件请求 | 已提 | 落地后快照 TTL 可退役为上限保险，`supersession` 可升 enforce |
| [#3587](https://github.com/trycua/cua/issues/3587) 结构化干预信号 | 已提 | 落地后可疑状态由真实干预驱动 |
| [#3607](https://github.com/trycua/cua/issues/3607) 驱动高完整性/清理 | 上游已关闭（completed） | 0.52.13 实测 daemon High、PowerShell 子进程 Medium；按实际 IL 清理，不按进程名杀 |
| [#3908](https://github.com/trycua/cua/issues/3908) WinUI3 hotkey 超时 | 已提 | 插件翻译为“改点控件”；观察实战影响面 |
| [#5012](https://github.com/trycua/cua/issues/5012) 模态期间 UIA/动作阻塞 | open | t20 触发 click 仍可能 30s；插件侧仅有 native-dialog/超时回执兜底 |
| [#5046](https://github.com/trycua/cua/pull/5046) bounded semantic click | closed-unmerged PR | 不是可用修复；引用时以 #5012 为准 |
| 像素点击落点（A7） | 素材已备，未单独提 | 文档定性 best-effort；等上游或换版本重测 |
| 0.53 `screenshot_frame` | 预期 | 有 0.53 时跑 `probe-driver-shape`；未真机前不写成已支持 |

## 5. 驱动库存候补（未暴露）

已确认 cua-driver 存在、插件未包装；按价值排序：

- `browser_*` 全家桶（navigate/click/type/hover/set_input_files/dialog/download，CDP）——浏览器域动作面；与 ZCode/Browser Use 的边界先想清楚。
- `set_window_frame`——窗口移动/缩放 + 读回验证。
- `get_accessibility_tree`——桌面级轻量快照（进程+窗口+bounds）。
- `start/stop/replay_trajectory`——轨迹录制/重放；与快照语义的交互需设计。
- `kill_app`——强杀进程；若暴露必须进极危注记清单，且与 UIPI 清理规则冲突。
- `middle_click` / `triple_click` / `mouse_down-up`——长按、精细拖拽分解。
- 多显示器枚举/切换（`get_screen_size` 仅主屏）。
- 真实指针 hover（`move_cursor` 语义待验证）。

## 6. 评测与成本

| 项 | 状态 | 说明 |
|---|---|---|
| S1-S4 任务集 41 条 | ✅ 已落地 | S1 10 / S2 5 / S3 26 / S4 17（成员 58，可重叠）；含 x1 委派通道；oracle 见 [TESTING](docs/TESTING.md) |
| S2 像素任务 | ✅ 已补 | p01 无坐标点击、p02 像素 token、p03 screen_zoom；2026-11-20 opencode image 路由 3/3 pass（6/11/8 步）；text-only 路由未验证 |
| S4 用户状态 | ✅ 已补 | t11-t18 全部加 sentinel 窗口/身份/文件校验；cleanup 只关测试自建对象 |
| S4 真实用户窗口 | 未做 | sentinel 是测试自建 decoy；真实用户窗口/未保存文档的保留仍靠 cleanup 约束 |
| 任务级复跑 | 待排期 | 桌面空闲、daemon 纯净时跑 `--stage S1 --timeout-min 8` |
| AC6（A–F 的 per-task token/步数对比） | 部分完成 | `headless-run` 采 `status/step_end.usage`，`ac6-summary` 出中位数/p90；2026-11-20 t01/t05 各 5 轮（全 pass）；t11/t14/t15 待空闲桌面 |
| observe:action 比例 | 已知瓶颈 | eval 基线约 2–3:1，历史单回合输入曾达 8.5M tok（任务已退役） |
| 降噪收益 | ✅ 离线 | summary 958→187 字符（80%）、brief 958→81（92%） |
| 参数化 / 有效样本量 | ✅ 已实现（3 条） | `variants: N` + `evals/variants/<id>.json`；`headless-run --variants N` / `verify-oracles --variants N`；t21/t22/a11y01 各 3 个 variant，AC2 9/9 PASS；mutation 固定 variant 1 |
| 可访问性 | 部分完成 | `a11y01` 键盘-only + UIA 名称 + 3 个输入 variant；高对比度/Narrator 全量验收未做 |
| 虚拟桌面 | BLOCKED | 无驱动/插件原语，`win` 组合键 fail-closed，无法按 ID 精确回收；见 [BLOCKED](evals/BLOCKED.md) |
| Linux | 可选，非门禁 | Ubuntu CI 只跑 `npm run check` / `npm test`；`probe-platform` 非 Windows 只报 BLOCKED；无 Linux 任务套件，不写“已支持” |

## 7. 平台

| 平台 | 目标 | 状态 |
|---|---|---|
| Windows | 深度实测、Windows 专属行为闭环 | ✅ 主目标 |
| macOS | 未验证，不阻塞 | 仅 0.1–0.2 有基础路径记录；近期未回归 |
| Linux | 不在承诺范围 | 未验证 |

## 8. 明确不做 / 已否决

| 方向 | 结论 | 原因 |
|---|---|---|
| 动态工具面（enter/exit） | 已删除 | tools 变化使 cache 首击 0–18%；稳定 dispatcher 85–99% |
| 审批网关 / 危险词确认 | 已删除（0.4.0） | 与“无感自治”冲突；归因靠注记 + 日志 |
| observe delta / 批量动作 | 暂缓 | 动作消费快照后必全量；驱动索引是位置编号，结构变化时复用旧索引不安全 |
| 兼容层 / 双实现 | 禁止重复语义；版本差异单点收口 | 不允许为同一动作写两套业务实现；驱动版本差异集中在 `lib/driver/` |
| 按进程名清理测试窗口 | 禁止 | Win11 记事本单进程多标签，会误杀用户文档 |
| 跨平台行为对齐 | 不作为目标 | Windows 是深度实测目标；macOS 与 Linux 未验证 |
| 把 22 工具收成一个元工具 | 不做 | 细粒度工具是模型选择能力的基础；dispatcher 已解决可见面问题 |

## 9. 决策记录

| 日期 | 决策 | 依据 |
|---|---|---|
| 2026-09-16 | 坐标统一为窗口截图物理像素；observe 输出时换算 | 探针残差 ≤0.55px |
| 2026-09-16 | 观察降噪默认 `summary`；`force=true` 全量 | 真实树 1586→250 字符（84%） |
| 2026-09-16 | 默认 `maxElements` 500→120 | 常见任务 30–70 个元素 |
| 2026-09-17 | 上下文预算 A–F；新增 `computer_task` | 单回合输入曾达 8.5M tok |
| 2026-09-17 | `toolFilter` 降级阶梯 | 宿主能力独立；不能一次全丢 |
| 2026-11-09 | P0 边界修复（快照/窗口绑定/`suspected_noop`/fail-closed） | 五条风险可串成“观察错窗口→输入错窗口→假成功” |
| 2026-11-10 | `dispatcher` 默认；`dynamic` 删除 | 真实渠道 cache 99.5% vs 0–18% |
| 2026-11-10 | 更名 `dsh-win-computer-use` | 与同名插件区分；Windows-first 定位 |
| 2026-11-17 | modifier/dwell drag 走私有 SendInput helper | 0.23.2 schema 声明 modifier 但不读取 |
| 2026-11-18 | 驱动 I/O 收口到 `lib/driver/` | 0.52 默认 markdown、session 快照、像素截图上下文三处破坏 |
| 2026-11-18 | 文档改为读者/任务导向 + 证据拆分 + docs:check | 20/21、629/634、17/18、32/47 等漂移反复出现 |

## 10. 触发条件速查

- **像素路径要常规化** → 先解 A2/A3/A7；否则保持 element 优先。
- **上游 #3586/#3587 落地** → 重评快照 TTL/supersession/suspect。
- **要严格限制子 agent** → 先确认宿主 `tools.restrict()` 是否接受作用域工具名；否则用宿主自己的子 agent 配置。
- **要发布 npm** → 跑 PUBLISH 全量检查（含 `docs:check`），并取得用户“发布”授权。
- **要扩到 macOS/Linux** → 先补目标平台的真机验证与承诺矩阵，不要直接改 README 状态。
- **要新增驱动工具** → 先过 [DRIVER-SDK](docs/DRIVER-SDK.md) §6 的分层/归一化/错误码/测试步骤。
