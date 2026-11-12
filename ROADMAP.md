# ROADMAP — dsh-win-computer-use

> 状态基线：`v0.5.6` 已发布（2026-09-17）；`main` 为 `0.5.7-dev`（未发布，含更名、dispatcher 默认、P0/P1 边界修复）。
> 这是个人项目路线图，不是承诺清单。**触发条件**决定何时解冻；没有触发条件的事项不排期。
> 历史细节见 [CHANGELOG](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/CHANGELOG.md)；验证证据见 [VERIFICATION](VERIFICATION.md)。

## 1. 已交付（摘要）

| 版本 | 主题 | 关键结果 |
|---|---|---|
| 0.5.7-dev | 工具面收敛 + 安全边界 + 更名 | `dispatcher` 默认（2 可见/20 隐藏）；`dynamic` 删除；P0 无快照/窗口绑定/`suspected_noop`；`computer_set_value`；窗口未匹配 fail-closed；Windows-first 更名 |
| 0.5.6 | 委派降级阶梯 | `toolFilter` 被拒时只丢该约束，保住结构化输出；回执写明权限后果 |
| 0.5.5 | 动态工具面（已废弃） | 折叠 2 / 展开 21；工具面 −81%；因 cache 实测被 0.5.7 删除 |
| 0.5.4 | dsh 0.1.5 适配 + 坐标契约 + 上下文预算 | 点击坐标空间根治；观察降噪；紧凑回执；`computer_task`；S4 评测系统；结构治理 |
| 0.5.3 | 结构密码检测 | Windows UIA sidecar；结构位优先；快照新鲜度语义；S3a 视觉断言协议 |
| 0.5.2 | Windows 凭据保护 | `roles.js` 跨平台三态；修复 Windows 静默失效 |
| 0.5.1 | 结构重构 | `apply()` 384→44 行；图片持久化统一出口；移除家目录密钥扫描 |
| 0.5.0 | 工具改进包 | verify / wait_for / clipboard / menu / hover / stop / resume；12→19 工具 |
| 0.4.x | 无感自治 + zoom | 删除审批网关；三级投递链；`screen_zoom` 定位原语；虚拟光标主题 |

## 2. 当前优先（0.5.7 收尾）

| # | 事项 | 状态 | 说明 |
|---|---|---|---|
| C1 | 文档体系重写 | ✅ 2026-11-10 | README/ARCHITECTURE/WINDOWS/TESTING/VERIFICATION/PERMISSIONS/ROADMAP/PUBLISH/MAINTAINING |
| C2 | install.sh 配置同步 | ✅ 2026-11-10 | 生成 `surfaceMode: dispatcher / ttlMs: 60000 / maxElements: 120` |
| C3 | `computer_task` 描述默认值 | ✅ 2026-11-10 | 描述改为“默认取 taskTimeoutMin（默认 5）” |
| C4 | `GUI_ONLY_TOOLS` 补 `computer_set_value` | ✅ 2026-11-10 | 白名单 20 个桌面工具（仍不含 `computer_task`） |
| C5 | `scroll`/`drag` 的 `snapshot_id` 校验 | 待做 | schema 接受但实现未 `validateSnapshotId` |
| C6 | npm 发布 / web profile 部署 | 待授权 | npm 未发布；web profile 仍旧名 v0.5.3 |
| C7 | 真机 headless 加载 | ✅ 2026-11-12 | dsh 0.2.2-rc.1 headless + 启用 credentials 的隔离 patch；5 步完成 status/observe/catalog/隐藏 computer_wait |
| C8 | `screen_zoom` 的 `coordinateSpace` 语义 | 待做 | 字段标 `screen-physical-px`，点击输入是 window-screenshot-px；统一字段或改名 |
| C9 | S4 Web runner 的 dsh 0.2.2 UI 兼容 | 待做 | 新会话只写 session 头、无消息；`steps` 从旧会话误读；Web `0/4` 无效。CRLF prompt 解析已修 |
| C10 | `wa2` 失败归因 | 🔶 初查 | 8min fail / 10min pass（72 次工具调用）；Round 2 的 12 次工具错误含 snapshot_mismatch、Explorer 前台确认失败、menu path 非 JSON；先做轨迹/提示层优化 |
| C11 | dsh 0.2.2 全面兼容性检查 | 🔶 报告完成 | `docs/COMPATIBILITY-0.2.2.md`：P0 `computer_task` subagents API；P1 vision 默认模型 / 附件 dimension / PTC 未验；P2 toolFilter 文案/上限 |

## 3. 事实澄清 / 实验（冻结，按触发条件解冻）

| # | 事项 | 状态/结论 | 触发条件 |
|---|---|---|---|
| A1 | dsv4fv 真实通道 native/vision | ✅ 2026-09-06：ax ✓、native ✓（attachments 端到端，首 token 0.9s/116 tok/s/缓存 74%）、vision 观察者半通（只出思考）；GLM 无 key 优雅降级 | — |
| A2 | GLM agent 跨 run 漂移 + SoM 标号绑定 | 未闭环；SoM 方案已因数据否决暂缓 | 像素路径要升级为常规路径时 |
| A3 | qwen3-vl 坐标帧错位根因 | 未闭环（代理缩图 vs 模型不确定） | 本地代理账号池稳定时 |
| A4 | 运行时验证（用户层覆盖退役/driverAccess/L3 恢复/crop 换算） | ✅ 2026-09-06：dump-config + E2E | — |
| A5 | dsv4fv OCR 数字噪声 | ✅ 可读 PNG 上 93 位零错误；zoom JPEG 对 ~13px 小字不可读；模型 2/2 诚实拒答 | S3b 设计输入 |
| A6 | Windows 密码框投影探针 | ✅ 9/9（结构标记/硬拒/零误拒/时延/crop）；发现并修复标记坐标错误 | — |
| A7 | 坐标语义落点实验 | ✅ 六轮完成；驱动 0.23.2 混合 DPI 下三种语义假设均有反例 → 像素路径 best-effort；element 路径可靠 | 上游修复或换驱动版本时重测 |
| S3b | 独立观察者裁决 / screen_assert | 未做；S3a 协议已注入描述 | ZHIPU_API_KEY 或 dsv4fv 观察者文本输出修复 |

## 4. 驱动与上游

| 项 | 状态 | 影响/下一步 |
|---|---|---|
| [#3576](https://github.com/trycua/cua/issues/3576) 元素投影 `is_password` | 已提 | 插件用 sidecar 结构位兜底；上游落地后可简化 |
| [#3586](https://github.com/trycua/cua/issues/3586) 树 revision + 条件请求 | 已提 | 落地后快照 TTL 可退役为上限保险，`supersession` 可升 enforce |
| [#3587](https://github.com/trycua/cua/issues/3587) 结构化干预信号 | 已提 | 落地后可疑状态由真实干预驱动，而非时间/回执推断 |
| [#3607](https://github.com/trycua/cua/issues/3607) 驱动高完整性/清理 | 已提 | daemon 提权导致 `app_launch` 窗口非提权侧清不掉；先试非提权重启 daemon |
| [#3908](https://github.com/trycua/cua/issues/3908) WinUI3 hotkey 超时 | 已提 | 插件翻译为“改点控件”；观察实战影响面 |
| 像素点击落点（A7） | 素材已备，未单独提 | 文档定性 best-effort；等上游或换版本重测 |

## 5. 驱动库存候补（未暴露）

已确认 cua-driver 0.23.2 存在，插件未包装；按价值排序：

- `browser_*` 全家桶（navigate/click/type/hover/set_input_files/dialog/download，CDP）——浏览器域动作面；与 ZCode/Browser Use 的边界需要先想清楚。
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
| S4 任务集 10 条 | ✅ 已落地 | 冒烟 4 + 核心 6（含 x1 委派通道）；oracle 双向 10/10；2026-11-12 headless smoke 3/4（wa2 fail） |
| 任务级复跑 | 待排期 | harness UI 空闲、daemon 纯净时跑 `--tier smoke --max-steps 40 --timeout-min 8` |
| AC6（A–F 的 per-task token/步数对比） | 未做 | 降噪/预算的收益需要任务级数据 |
| observe:action 比例 | 已知瓶颈 | S4 基线约 2–3:1，单回合输入曾达 8.5M tok |
| 降噪收益 | ✅ 离线 | summary 958→187 字符（80%）、brief 958→81（92%） |

## 7. 平台

| 平台 | 目标 | 状态 |
|---|---|---|
| Windows | 深度实测、Windows 专属行为闭环 | ✅ 主目标 |
| macOS | 基础可用，不阻塞 | 历史验证；近期未回归 |
| Linux | 不在承诺范围 | 未验证 |

## 8. 明确不做 / 已否决

| 方向 | 结论 | 原因 |
|---|---|---|
| 动态工具面（enter/exit） | 已删除 | tools 变化使 cache 首击 0–18%；稳定 dispatcher 85–99% |
| 审批网关 / 危险词确认 | 已删除（0.4.0） | 与“无感自治”冲突；归因靠注记 + 日志 |
| observe delta / 批量动作 | 暂缓 | 动作消费快照后必全量；驱动索引是位置编号，结构变化时复用旧索引不安全 |
| 兼容层 / 双实现 | 禁止 | 结构直接简洁；行为变更用测试与 CHANGELOG 收口 |
| 按进程名清理测试窗口 | 禁止 | Win11 记事本单进程多标签，会误杀用户文档 |
| 跨平台行为对齐 | 不作为目标 | Windows 是深度实测目标；macOS 基础可用，Linux 未验证 |
| 把 22 工具收成一个元工具 | 不做 | 细粒度工具是模型选择能力的基础；dispatcher 已解决可见面问题 |

## 9. 决策记录

| 日期 | 决策 | 依据 |
|---|---|---|
| 2026-09-16 | 坐标统一为窗口截图物理像素；observe 输出时换算 | 探针残差 ≤0.55px；元素 frame 与 click 空间差窗口原点 |
| 2026-09-16 | 观察降噪默认 `summary`；`force=true` 全量 | 真实树 1586→250 字符（84%）；避免重复观察撑爆上下文 |
| 2026-09-16 | 默认 `maxElements` 500→120 | 常见任务 30–70 个元素 |
| 2026-09-17 | 上下文预算 A–F；新增 `computer_task` | 单回合输入曾达 8.5M tok；委派买的是主上下文隔离 |
| 2026-09-17 | `toolFilter` 降级阶梯 | 宿主能力独立；不能一次全丢 |
| 2026-11-09 | P0 边界修复（快照/窗口绑定/`suspected_noop`/fail-closed） | 五条风险可串成“观察错窗口→输入错窗口→假成功” |
| 2026-11-10 | `dispatcher` 默认；`dynamic` 删除 | 真实渠道 cache 99.5% vs 0–18% |
| 2026-11-10 | 更名 `dsh-win-computer-use` | 与同名插件区分；Windows-first 定位 |
| 2026-11-10 | 文档体系重写 | 版本/平台/审批/网络等旧表述与实现不一致 |

## 10. 触发条件速查

- **像素路径要常规化** → 先解 A2/A3/A7；否则保持 element 优先。
- **上游 #3586/#3587 落地** → 重评快照 TTL/supersession/suspect。
- **要严格限制子 agent** → 先确认宿主 `tools.restrict()` 是否接受作用域工具名；否则用宿主自己的子 agent 配置。
- **要发布 npm** → 先完成 §2 的 C5（`scroll`/`drag` 的 `snapshot_id` 校验），跑 PUBLISH 全量检查，并取得用户“发布”授权。
- **要扩到 macOS/Linux** → 先补目标平台的真机验证与承诺矩阵，不要直接改 README 状态。
