# Changelog

> **版本状态（2026-11-19）**：最新发布 tag 为 `v0.5.6`；`main` 为 `0.5.7-dev`（未发布），dsh 兼容基线为 **0.2.2-rc.1**。`package.json` 版本仍在 0.5.6，发布时统一 bump。npm 未发布；web profile 仍部署旧名 `dsh-computer-use` v0.5.3。
> 逐轮步数、探针输出与失败样本见 [docs/EVIDENCE.md](docs/EVIDENCE.md)；当前契约见 [docs/TOOLS.md](docs/TOOLS.md)、[docs/CONFIGURATION.md](docs/CONFIGURATION.md)、[docs/ERRORS.md](docs/ERRORS.md)。

## 0.5.7 (未发布)

**主题**：Windows-first 更名、dispatcher 默认、P0/P1 安全边界、dsh 0.2.2 兼容、驱动兼容层、手势与输入真实性、观察回执状态、文档体系重写。

### Added

- **dispatcher 工具面**：默认只注册 `computer_do` + `screen_observe`，其余 21 个工具经 `computer_do({action:"call",tool,args})` 路由；`catalog` 返回紧凑签名（最多 24 条），`status` 查看模式。`hybrid` 额外直接暴露 click/type/key/scroll/verify（7 可见/16 隐藏）。`dynamic` enter/exit 因 prompt cache 实测（稳定 dispatcher 85–99.5% vs 工具变化首击 0–18%）删除。
- **`computer_set_value`**：UIA `ValuePattern` 直连设值；进入 `OPERATION_TOOLS` 与密码硬拒。
- **`computer_activate`**：按 `window_id`（可带 pid）前置已存在窗口；不启动/关闭、不恢复原前台；脏桌面多窗口切换原语。
- **`computer_task` 迁移到 dsh 0.2.2 `startActivation`**：扁平 spec、`delivery:'caller'`、`outputSchema` 降级、`maxDepth:1`、每会话 `maxTaskCalls`；回执明确“子 agent 拥有与父会话同级能力”（0.2.2 无 `toolFilter`）。
- **驱动兼容层 `lib/driver/`**：`transport`（唯一 spawn/超时/退出码/JSON/contract/session/结构化拒绝）、`capabilities`（版本/能力/请求映射/学习）、`normalize`（0.23.2/0.52/0.53 → 内部规范）、`info`（进程级缓存）。`cuaCall` 保留 facade，45 个调用点不改。
- **0.52+ 形态适配**：总是显式 `tree_format:"elements"`；`get_window_state` 注入 `CUA_SESSION`；像素 click/drag/scroll/zoom 前补 capture-only（保留 token）；原生 modifier drag（0.39+）；`driverProfile: auto|legacy|latest`、`dragEngine: auto|private`。
- **手势**：click 家族 `modifier`（ctrl/shift/alt/win，Windows 自动前台）；drag `from_zoom`、`steps`（1–200）、`button`（left/right/middle）、`dwell_ms`（0–2000）、`modifier`。`modifier`/`dwell_ms` 走持久 PowerShell + C# SendInput helper（原子手势、modifier 持有到 drop、失败路径释放、恢复前台）；0.39+ 原生可用。
- **XAML/WinUI 回退**：`xamlKeyFallback: auto` 对白名单组合自动“点唯一菜单栏项 → 点唯一菜单项”；`xamlPressFallback: auto` 对 `ctrl+a`/`alt+f` 允许一次前台 `press_key`；`lib/menu.js` 统一菜单角色/状态判定；歧义/缺失即停，不自动处理另存为/覆盖对话框。
- **输入真实性**：`computer_type`/`computer_set_value` 在失败/未验证时逐字回读（只报长度与一致/不一致/无法回读）；`inputUnconfirmed` 保存门禁只拦保存意图；无 Document/TextArea 的聚焦输入保留快照，避免每格 observe；Document/TextArea 不展示正文，不要求星号置脏。
- **观察状态**：`query` 改为只读过滤视图（清除旧动作快照、`snapshotId:null`）；快照明确全局单例；native/vision 文本回显当前 `snapshot_id`；`snapshot_mismatch` 带当前 app/title/pid/window_id；数字 `window`/`window_id` 提示按来源区分；密码框点击回执输出 `值（已隐藏）`。
- **动作回执**：目标回显（编号/角色/标签/当前值/最近元素）、紧凑回执、`verboseReceipts`、`verifyAfterAction`（实验性，默认 off）、`actionGuard` 5s 重复抑制、`cursorMotion`（auto 单次/human 5 段/off）、`windowMap` 恢复原前台、`trajectoryFile` JSONL 脱敏轨迹。
- **评测**：dirty 套件 t11–t17（Paint/PPT/论文/Excel/Explorer/表单/PDF）；TabState 备份/恢复、ExpectedTabs 标签校验、owned 模态对话框关闭、dirty/leftover 语义；`headless-run.mjs` 取代退役的 Web runner；`verify-oracles` AC2 双向验证；`analyze-trajectory`/`ab-summary` 指标。
- **文档体系**：新增 [docs/README](docs/README.md) 索引、[INSTALL](docs/INSTALL.md)、[TOOLS](docs/TOOLS.md)、[CONFIGURATION](docs/CONFIGURATION.md)、[ERRORS](docs/ERRORS.md)、[TROUBLESHOOTING](docs/TROUBLESHOOTING.md)、[SECURITY](docs/SECURITY.md)、[COMPATIBILITY](docs/COMPATIBILITY.md)、[EVIDENCE](docs/EVIDENCE.md)；新增 `npm run docs:check` 防漂移。

### Changed

- **默认工具面**：`surfaceMode: dispatcher`；工具总数 22 → 23；默认 `ttlMs: 60000`、`maxElements: 120`；`deliveryMode: auto`。
- **dsh 基线**：`>=0.2.2-rc.1 <0.3.0`；peer 依赖同步；不再维护 0.1.5 兼容层；`computer_task` 只走 `startActivation`。
- **视觉默认**：`visionModel` 改为 `deepseek-flash`（0.2.2 目录）；删除 legacy 模型分支。
- **回执语义**：结构化拒绝/投递失败/`suspected_noop` 一律 `ok:false`；`unverifiable` 保持“已送达但未验证”；`unknown` 永不算成功；`background_delivery_failed` 是升级建议而非硬失败。
- **坐标/缩放**：`screen_observe` 文本、结构化 elements、快照条目、点击输入统一 window-screenshot-px；`screen_zoom` 输出 `zoom-image-px` + `fromZoom`，不再手算 `crop.scale`；`nativeImage: compact` 明确失败。
- **更名**：包名/仓库名 `dsh-computer-use` → `dsh-win-computer-use`；旧 GitHub URL redirect；npm 尚未发布。
- **测试阶段 S1-S4**：S1 基础功能、S2 像素定位、S3 覆盖面任务集、S4 Dirty 能力任务集；任务用 `stages` 多标签（t11=S2+S4，t12-t17=S3+S4）。runner 新增 `--stage`；`--tasks`/`--tier` 保持兼容。旧系统级 `S4` 全局改称 `eval`；`S3a/S3b` 改为视觉断言协议/独立观察者。
- **P0 判定绑定**：t04/t07 按 setup 记录的 HWND 判定；t05 payload 加非 ASCII `é`；t03 加 `keep.txt` 与无多余文件检查；x1 改为必须 `computer_task` 并由 runner 校验调用。

### Fixed

- **P0 盲发/错窗口**：`type`/`key` 不再在无快照时退回 desktop；`scroll`/`drag` 透传 `window_id`；指定窗口未匹配 fail-closed；`suspected_noop` 终态失败；`scroll`/`drag` 校验 `snapshot_id`。
- **观察/坐标**：`renderLine` 与结构化 elements 同空间；`cacheSnapshot` 存点击空间；`resolveClickTarget` 检查 TTL；滑行起点减窗口原点；缺 bounds 显式 `screen-physical-px`；overlay 过滤；同 pid 多窗口 `window_id` 优先。
- **投递**：`deliveryFailure` 统一 `ok:false`；L3 重试失败不写“完成”；`ok:true + effect:"refused"` 按拒绝；恢复原前台查 pid；强制前台指针动作前置单次，避免重复点/画。
- **输入**：另存为文件名盲区（`label || value`）修复；部分输入/错字不再被当成功；`inputUnconfirmed` 只拦保存；`set_value` 不暗示已持久化；XAML 对话框不再误导 `foreground`。
- **驱动 0.52**：裸 `screenshot_context_missing` 不再写成“点击完成”；native 截图不再冒充 click capture；capture-only 保留 token；`stale_element_token` 清快照；结构化非零退出当回执值。
- **观察回执**：native/vision 文本补 snapshot id；query 明确“旧动作快照已清除”；跨窗口旧 id 的 mismatch 从 2 次降到 0；密码框值不回显。
- **评测安全**：删除按进程名杀 Notepad/Paint/Office/浏览器；`Open/Close-TestNotepad` 精确标签集/ExpectedTabs/owned 对话框；TabState 隔离；`app_launch`/dirty leftover 如实报告；t04/t06 环境阻塞收敛。
- **其他**：`computer_do` 透传 `data`；`app_launch` 前置失败不再当启动失败；`computer_menu` 只有 confirmed 成功；`clipboard/hover/stop/resume` 不再假成功；轨迹计数不再翻倍；`check_permissions` 30s 缓存。

### Security

- 凭据硬保护是唯一内容级硬拒绝：密码框（结构位 `IsPassword` ∨ `ES_PASSWORD` + 启发式）拒绝 `computer_type`/`computer_set_value`；坐标输入无法预知目标，回执注记。
- 密码框点击回执不再回显明文；观察文本只显示 `值=•••`；Document/AXTextArea 不展示正文。
- 只从环境变量读取 GLM key，不读密钥文件；核心无网络，GLM 兜底会把截图外发到配置端点。
- `PERMISSIONS.md` 补充 `DSH_CU_TRAJECTORY_FILE`/`DSH_POWERSHELL`/`S4_TEMP`/`DSH_TEMP` 与轨迹写文件的例外。

### Verification

- 离线 **26 套 / 634 项检查**；语法 **29/29**；`verify-runtime` **18/18**（0.23.2 + 0.52.13）；`tests/tasks.check.mjs` **245 项**（S1-S4 阶段/脚本/计数/P0 绑定）。
- 0.52.13 canary：`live-action` 33/33；driver-shape/modifier/combo/private-drag/from-zoom/native-freshness 全通过；t17 capture-only **29 步 pass**。
- 观察回执修复后：t11 **70 步 pass**（oracle 22/22，`snapshot_mismatch` 0）、t12 **100 步 pass**（oracle 13/13，`snapshot_mismatch` 0）。
- 逐轮详情、失败样本与原始 run id 见 [docs/EVIDENCE.md](docs/EVIDENCE.md)。

## 0.5.6 (2026-09-17)

### Fixed

- **委派的能力降级阶梯（0.5.5 引入的安全相关回归）**：`toolFilter` 在宿主内部是 scoped `tools.restrict()`，其名字校验**只认全局层**；0.5.5 的动态工具面把 19 个工具注册进会话作用域后，`toolFilter` 必然被拒（`tools.restrict() names unknown global tools`）→ 子 agent 不受限（实测它跑了 bash）。旧实现一次丢掉 toolFilter+outputSchema 并只说“已降级”，既不安全也误导（结构化结果其实还能用）。改为**三级阶梯**：全量 → 只丢 toolFilter（保住结构化输出与深度限制）→ 再丢 outputSchema → 全失败则明确报错；每级把**拒绝原因与权限后果**写进回执（“子 agent 拥有与父会话同级的能力”）。README 新增“委派的能力边界”一节，去掉“只能用桌面工具”这一在本机部署上不成立的声明。

## 0.5.5 (2026-09-17)

**动态工具面**（PLAN-meta-tool，拍板 2026-09-17）：诉求不是省 token，而是**避免 20 个工具的 schema 常驻造成的注意力负担**。

### Added

- **两态工具面**：折叠态（默认）只暴露 `computer_do` + 精简版 `screen_observe`；`computer_do({action:'enter'})` 后把另外 19 个工具**注册进该会话自己的 agent 作用域**，`exit` 或“连续 2 次非桌面工具调用”自动收起。工具面重量 **18846 → 3532 字符（−81%）**；展开态的 19 个工具与 v0.5.4 完全一致（细粒度 schema、宿主严格输出校验、未知参数拒发、工具级 guard 全部保留）。机制依据与真机取证见 PLAN-meta-tool §6.2：注册表**按请求**投影，所以展开/回落都在下一请求生效（探针逐步实测：折叠→不可调用、enter→下一请求可调用、exit→unknown tool）。
- `lib/surface.js`（两态状态机 + 作用域注册/dispose + 幂等 + 清单常量）、`tests/surface.mjs`（23 断言：折叠/展开/回落/幂等/作用域隔离/能力兜底/自动回落/清单一致性/注意力预算/锁存/事件接线）。
- `screen_observe` 描述精简化（534→322 字符，参数说明 510→405）：折叠态常驻工具必须轻；**输出 schema 不动**（宿主严格校验要求实现返回的字段都已声明，砍 schema 就得砍返回值）。

### Fixed

- **注册时丢失 schema 投影（加载失败级回归）**：P1-7 结构重构把 `defineTool()` 的返回值丢了，注册的是未投影的原始字面量 → dsh 0.1.5-rc.2 的 `assertSupportedJsonSchema` 拒绝（属性级 `required:true` 不在强制子集里）→ **整棵插件树加载失败**。离线假注册表不做该校验，171 断言全绿也漏掉了；真机探针一次命中。已修，并记入 HANDOFF 硬知识。
- **误订阅 waterfall 事件导致所有工具调用失败**：非桌面活动兜底最初挂 `tools/post-execute`（cordis waterfall，末位参数是 `next`），监听器不调 `next` 返回 undefined → 注册表读 `decision.kind` 崩溃 → 每次调用都报 `Cannot read properties of undefined (reading 'kind')`（探针 6/6 步同一报错）。改用仅观测事件 `tools/result`，并在测试里禁止再订阅 waterfall 事件。

## 0.5.4 (2026-09-17)

**主题**：dsh 0.1.5 大版本适配、点击坐标契约根治（所见即所点）、观察降噪与上下文预算 A–F、eval 评测回归系统（原 S4）、测试与代码结构治理。

### Added

- **observe 降噪**（工作区 PLAN-observe-noise，拍板 2026-09-16）：同一窗口 + 同一模式，且**上次观察后无任何动作**（快照未被消费）时，重复观察回极简回执——`observeDedup: summary`（默认，含“编号:角色”摘要）/ `brief`（单行）/ `off`（每次全量）；新增 `screen_observe(force=true)` 强制全量。判定用严格哈希并忽略时间/行列类噪声（实测：真实 35 元素记事本树 1586→250 字符，**降幅 84%**；brief 单行 95%）。注意本项省的是**上下文 token**，不减少工具调用步数（步速另由提示层“同一快照内无需重复观察”引导）。`maxElements` 默认 500→120（实测常见任务 30-70 个元素）。新增专项测试 `tests/observe.dedup.mjs`（13 断言：AC1 降幅 / AC2 变化必全量 / AC3 force / AC4 动作后必全量 / AC5 off 与 brief / D2 时间噪声）。
- **上下文预算 A–F**（工作区 PLAN-context-budget，拍板 2026-09-16）：A 观察/缩放描述写入成本阶梯（ax < zoom ~200 tok < native ~3K tok）与用途对应；B schema 瘦身 **10176→9486 字符**；C 新增紧凑动作回执 + `verboseReceipts`（正常路径 click 299→~90 字符，不可验证路径仍附明细）；D 树标签 100→48 字符 + 多行折首行；E `app_list` 紧凑化 491→418 字符；F **新增第 20 个工具 `computer_task`**——把一段桌面操作委派给一次性子 agent（`ctx.subagents` + `toolFilter` 限定 19 个桌面工具 + `outputSchema` 强制 {ok,summary,evidence} + `maxDepth=1` + 超时），主上下文只吃一条 ≤400 字符回执，宿主无该能力时回委派配方。新增 `tests/task.tool.mjs`（14 断言）并入 npm test（全库 101 断言）。
- **坐标换算基准元数据**：observe/zoom 输出 `screenOrigin`（= `list_windows` 的 bounds；实测截图与该 bounds 逐像素相同）+ `coordinateSpace`，使“图内像素 × crop.scale + crop 原点 + screenOrigin = 屏幕物理像素”可算（zoom 实测为恒定 1.2× 上采样，裁剪宽 ≤500px）。
- **未知参数拒发**：宿主参数表编译后不含 additionalProperties，参数名写错会被静默忽略并可能回退“z 序最前窗口”（实测踩坑：给 screen_observe 传 `app=` 观察到了别的应用）→ `wrap()` 单点拒绝并列明可接受参数；observe 未指定 window 时结果显式注明“已取最前窗口”。
- **测试面**：`tests/schema.conformance.mjs`（把实现可能返回的每种形态——正常/守卫拒绝/观测降级/驱动错误——对着声明 schema 严格校验；本版收尾时覆盖 20 个工具 / 42 个场景）、`tests/live-action.e2e.mjs`（真桌面动作闭环 + 稳定性循环）、`tests/syntax.check.mjs`（修 `npm run check` 的 Windows glob 失效）。
- **eval 评测回归系统（原 S4）**（仓库 `evals/`）：9 条任务（冒烟 4 + 核心 5）、PS oracle 四件套（setup/oracle/cleanup/simulate）、AC2 双向独立验证、零依赖 CDP runner（`--tier/--max-steps/--pin-model/--pin-effort`）、maintain/stop-stale/hygiene 运维脚本；坐标标定与键盘通道诊断脚本一并入库。

### Fixed

- **结构化拒绝被当成功上报（同类缺陷第三、四处）**：`scroll`/`drag` 此前未识别驱动的 `{refusal:{code}}` 回执，把拒绝当成功上报——与 menu 同一坑。新增 `lib/receipt.js` 把“判拒绝 → 标快照消费 → 出回执”收成唯一出口，新增工具只要走它就不会再漏（`tests/schema.conformance.mjs` 的拒绝形态场景矩阵即是该类的回归网）。
- **坐标契约不一致导致点击整体偏移（根因修复）**：可控探针逐点标定（最小二乘残差 ≤0.55px）测出 `computer_click(x,y)` 的空间是**窗口矩形相对物理像素**（= 窗口截图空间），而 `screen_observe` 元素坐标是**屏幕物理像素**——两者差一个窗口原点向量（本机可达 1906×1166），模型“看到坐标直接点”必然打偏。观察输出已换算到点击空间（截图/元素/点击三者统一），文案与 `coordinateSpace` 同步更正；密码扫描/标记仍用原始屏幕坐标。
- **dsh 0.1.5 严格输出校验下观察工具整次失败**：观测降级回执（`window/elementCount/mode/elements/visualOnly/driverAccess`）未在 output schema 声明 → `screen_zoom`/`screen_observe` 的降级路径报 invalid output（工具等于不可用）。抽出 `DESKTOP_FALLBACK_FIELDS` 供两者共用。
- **驱动结构化拒绝被当成功上报**：`{"refusal":{code,message}}` 回执此前未识别 → `computer_menu` 对 `menu_path_unavailable` 仍回“已调用菜单路径”，模型据此继续下一步。抽出 `lib/engine.js` 统一识别四种拒绝形态（refusal/effect/error/code）。
- **zoom 的脆弱点与比例错误**：zoom 曾为取窗口尺寸做带 UIA 扫描的 `get_window_state`（WinUI 应用 4s 超时会把整次 zoom 拖进桌面降级）→ 改用 `list_windows` 的 bounds（实测其与截图逐像素相同）；scale 曾用 attachments 归一化后的尺寸（会算出错误比例）→ 改用驱动返回的图尺寸，并输出非等比缩放提示。
- **hotkey 的 UIA 加速器超时**不再抛原始引擎错误，改为可执行指引（改用控件点击/稍后重试）——上游 [trycua/cua#3908](https://github.com/trycua/cua/issues/3908)。
- verify-runtime 三处测试脆弱点：Windows 动态 import 需 `file://` URL、驱动自身窗口排除用了不存在的进程名（实际是 `cua-driver.exe`）、工具数断言写死 12-13（现改为下限 + 关键工具在册）。

### Changed（结构治理 P0/P1，2026-09-17）

代码屎山审计后的落地，全部以机械证据收口（parity 逐字节比对或测试断言），不含行为猜测。

- **测试脚手架去重（P0-1）**：新增 `tests/lib/harness.mjs`（临时工作副本 / 可编程驱动桩 / 假 ctx·exec / 与 dsh 严格语义对齐的 schema 校验器 / 断言记录器），`schema.conformance`、`observe.dedup`、`task.tool` 三套测试改为引用，删掉各自复制的 ~90 行脚手架。
- **schema 覆盖 13/20 → 20/20 工具（P0-3）**：22 → 42 场景，补齐 `computer_double_click`/`right_click`/`wait_for`/`hover`/`stop`/`resume`/`computer_task`（后者含结构化成功 / 无结构化 / 宿主无服务三形态），并按驱动真实形态补全“结构化拒绝”（`{refusal:{code}}`）场景矩阵——该矩阵直接暴露并修掉了 Fixed 节里那条 scroll/drag 缺陷。
- **配置接线测试（P0-2）**：新增 `tests/config.plumbing.mjs`——schema 键 ↔ `apply()` 组装的 cfg ↔ 实际读取点三向比对（含 `extremePatterns→extremeRes` 重命名白名单），外加 11 组行为哨兵（maxElements/observeDedup/verboseReceipts/supersession/ttlMs/deliveryMode/allowedApps/extremePatterns/cursorTheme/maxTaskCalls/visionProvider+nativeImage）；观测成本过高的 `passwordScan`/`taskTimeoutMin` 显式登记为静态兜底，不假装测过。
- **删死代码（P0-4）**：`dedupInvalidate`（降噪失效已由“快照消费”闸门覆盖）、`taskCallCount`、`runAction`（被 humanAction 取代后无人调用）。
- **拆超大函数（P1-5）**：`screenObserve`（194 行）→ 目标选择 / 抓树（含补抓与桌面降级短路）/ 结构性密码标记 / 元素映射 / 文本渲染 / 结果封装六个阶段函数；`screenZoom`（106 行）→ 目标解析 / 裁剪钳制 / 整窗回退。单函数 ≤66 行。**29 场景受控桩 parity 逐字节一致**。
- **回执统一（P1-6）**：新增 `lib/receipt.js`（`receipt` / `refusalReceipt` / `settleAction`），点击/双击/右键/输入/按键/滚动/拖拽/菜单全部走同一出口——`scroll`/`drag` 从 JSON 内联改为紧凑回执（与 click 同形），“引擎拒绝”判断从 6 处收敛到 1 处（该类缺陷已在 menu/scroll/drag 三处实际发生过）。
- **注册结构数据化（P1-7）**：四组工具改为返回定义数组的纯数据函数，注册与参数名登记收敛到 `apply()` 单处循环。**20 个工具的工具面 JSON 快照（描述/参数表/输出 schema/render/execute arity）逐字节一致**。如实说明：工具描述与 schema 是内容而非样板，`index.js` 体积基本未变（726→738 行），本项收益是“新增工具 = 加一项数据” + 工具面可机械校验。
- **测试量**：`npm test` 148 断言（原 103）；真桌面闭环 `tests/live-action.e2e.mjs` 3 轮 30/30。

## 0.5.3 (2026-09-06)

**结构性密码检测（Windows）**——PLAN-credential-guard 第二期：凭据硬保护从启发式升级为读取系统真实属性（结构位），补齐“无标签 + 空值”密码框盲区。探针实证关键前提：经典 Win32 `ES_PASSWORD` 样式位在两种 UIA 客户端均映射 `IsPassword=false`，样式位才是系统真值（已作为 follow-up 反馈上游 [#3576](https://github.com/trycua/cua/issues/3576#issuecomment-5554919425)）。

### Added

- **快照新鲜度语义**（PLAN-snapshot-freshness Phase A；REVERSE 逆向三点合流）：失效原因三分类 `[snapshot_expired]`（带快照 id）/`[snapshot_mismatch]`/`[snapshot_consumed]`；`supersession` 配置 off/note/enforce（默认 note：同快照连击附一致性注记不阻断）；动作工具新增可选 `snapshot_id` 显式证据基线参数（7 个 mutate 工具 + observe 输出 schema 增 snapshotId）；unverifiable 动作触发状态可疑注记（干预 P0 降级版，只注记不阻断）。上游需求已提：trycua/cua #3586（树版本+条件请求）、#3587（干预信号）。
- **视觉断言协议（原 S3a）**（PLAN-s3-model-verifier）：A5 实证（可读 PNG 证据上 dsv4fv 数字转述噪声≈0、zoom JPEG 对小字号不可读、模型证据不足时 2/2 诚实拒答、同会话历史回声风险）落为工具描述协议——数字断言逐字双向校验不做编辑距离放宽、文字模糊子串+同义对照、只认本轮新鲜证据、不可读=unknown 不得编造；注入 `screen_observe`/`screen_zoom`/`computer_verify` 描述。零新工具零新权限；独立观察者（原 S3b；screen_assert 工具/裁决）待观察者条件成熟。
- **UIA sidecar**（`tools/uia-password-scan.ps1` + `lib/passwordScan.js`）：`screen_observe` 时遍历目标窗口元素，密码 = `IsPassword`（现代框架 provider）∨ `ES_PASSWORD` 样式位（经典 Win32，`NativeWindowHandle` + `GetWindowLongW` 实测）→ 标记快照 entry → guard **结构位优先**硬拒。失败/超时（3s）自动降级启发式并在结果注记；误差方向安全（坐标错配只会漏标不会误标）。
- `tools/password-probe.ps1` 自包含探针（A6）：WinForms 密码框 + UIA 自扫 + Win32 样式真值三重交叉验证；出货版 sidecar 已对活体探针窗口端到端命中（无标签空值密码框，count=1）。

### Changed

- Config 新增 `passwordScan: 'auto' | 'off'`（默认 auto；off = 零 spawn，凭据保护退回启发式）。权限面新增 powershell 固定 argv spawn（随包脚本、只读、无网络），PERMISSIONS/summary/命令清单如实更新；承诺矩阵 Windows 凭据行升级为「结构位」。

### Fixed

- **结构密码标记坐标系错误**（A6 运行时端到端发现，2026-09-06）：`markElementsFromScan` 按“元素中心=窗口本地 + 原点换算”旧假设设计，而 cua-driver 0.23.2 的 frame 与 sidecar rect 同为**屏幕锚定物理像素**（同一密码框两套独立系统读数逐像素相等，探针 E2E 实证）——原点换算使标记整体偏移一个窗口原点向量，实测**标错相邻元素**（真密码框漏标 → guard 放行；上方普通框误标 → 误拒）。改为屏幕坐标直配，废弃双原点候选。sidecar 由 node 派生继承 DPI 感知返回物理 px（bash 直跑探针得逻辑 px，仅影响独立实验，部署路径一致）。E2E 9/9：注记/guard 硬拒/零误拒/sidecar 时延 1.4-1.6s/crop 元数据全通过。

## 0.5.2 (2026-09-06)

**Windows 凭据硬保护静默失效根治**（规格 PLAN-credential-guard；发现于 dsv4fv 定位实验真值交叉检查）。

### Fixed

- **凭据硬保护在 Windows 上静默失效**：cua-driver 元素投影按平台原生命名 role（Windows = UIA 原生 `Edit/Button/…`，无 AX 前缀）且无密码标志位，guard 匹配 macOS AX 命名（`AXSecureTextField`）在 Windows 上永假——密码框检测整体失效且无任何注记。
- 新增 `lib/roles.js` 跨平台角色语义层（单一出口）：密码**三态判定** `isPasswordCandidate`（结构化 AX 角色 ∪ Windows 启发式：文本输入类角色 × 密码词/掩码值，'显示密码'按钮等非输入类仅注记不硬拒）、`isActionableRole` 跨平台集合（**Windows 纯图标无标签按钮恢复编号**；AXSecureTextField 原遗漏补齐）。

### Changed

- 快照 entry 增加 `value` 字段（掩码判定数据源；`label` 不再合并 value）；`ROLE_SHORT` 补 Windows UIA 中文映射（Button→按钮 等）。

### Security

- PERMISSIONS.md 新增**「承诺验证矩阵」**（承诺 × 平台 × 验证载体 × 状态）——安全承诺自此按平台实测，杜绝“代码看起来对”式声明。
- 上游契约缺口已提回：[trycua/cua#3576](https://github.com/trycua/cua/issues/3576)（请求元素投影增加 `is_password`）；补齐前 Windows 保护以启发式运行，误报面与语义见 PLAN-credential-guard §5/§6。

## 0.5.1 (2026-09-06)

结构与复杂度优化（纯结构重构，**零行为变化**——19 工具注册面经 parity 脚本逐字段验证一致）。

### Changed

- **index.js `apply()` 384 → 44 行**：19 个工具注册拆为模块级三组工厂 `registerObserveTools` / `registerActionTools` / `registerOpsTools`（apply 只剩配置装配 + 会话初始化 + wrap + 三次调用）。
- **observe.js `screenObserve` 188 → 117 行**：抽出 `missingTreeFallback`（补抓判定）、`cacheSnapshot`（快照缓存）、`resolveObserveMode`（native/vision/ax 模式决策与降级链）三个纯函数。
- **图片持久化收敛**：新增 `lib/attach.js saveImageAttachment` 统一出口，5 处 `attachments.saveImage` + 输出块装配调用点归一（尺寸回退语义逐点保留）。

### Security

- **权限面修正**：`vision.js loadKey` 移除家目录密钥文件扫描（`~/.zhipu-key` 等，上游继承的死代码），仅保留 `ZHIPU_API_KEY` / `GLM_API_KEY` 环境变量；PERMISSIONS.md / package.json / docs/store-evidence.md 如实声明（凭据信号从“未命中”改为“轻微命中（可选）”）。

## 0.5.0 (2026-09-06)

工具改进包（规格 PLAN-tools-v0.5，拍板：D1 独立工具 / D2 锁存+resume / D3 hover 入包）。12 → **19 工具**。

### Added

- **`computer_verify`**：确定性验证——driver `verify_state` 包装，1-8 条结构化谓词（element: role/label_contains × exists/enabled/selected/value_equals；window: exists/bounds±tolerance）AND 求值；satisfied / unsatisfied / **unknown**（unknown 永不视为成功，fail-closed）；可选截图证据。
- **`computer_wait_for`**：谓词轮询等待，满足即返回（含等待时长/次数），超时结构化失败（不伪装成功）——替代盲等。
- **`computer_clipboard`**：剪贴板读写；`write` + `ctrl+v` 组成可靠“粘贴流”。
- **`computer_menu`**：菜单路径直调（driver `invoke_menu`，fail-closed，绝不回退像素）。
- **`computer_hover`**（实验性）：移动虚拟光标；`real=true` 移动真实 OS 指针（scope=desktop）。真实 hover 效果取决于应用，未验证。
- **`computer_stop` / `computer_resume`**：强杀开关——stop 结束驱动会话 + 清观察快照 + **锁存全部桌面操作**（观察/动作/应用一律拒绝）；resume 唯一解锁路径并预热会话。验证工作流（原 S3）的确定性半边就此补齐。

### Security

- 锁存闸门位于守卫之前（锁存优先级最高）；stop/resume 均带审计注记；凭据硬保护与极危注记不受影响。

## 0.4.1 (2026-09-05)

依据 dsv4fv 像素定位实验（SURVEY 附录A：整窗裸定位 median>300px、先验驱动的布局重建、目标主导小裁剪 13-80px）落地像素定位修订（原 S2）。

### Added

- **`screen_zoom` 定位原语**：结果新增结构化 `crop` 元数据（原点 x/y、尺寸 w/h、换算比例 scale），结果文本给出换算公式（图内坐标 × scale + crop.x/y = 整窗截图像素）——支撑树空/像素目标的“裁剪 → 语义确认 → 换算 → 点击”定位环。

### Changed

- `screen_zoom` 工具描述改写为双用法（放大细看 / 定位环），并写明“整窗裸定位不可依赖、裁剪务必让目标占画面主导”的实验结论。

## 0.4.0 (2026-09-05)

**安全立场切换：无感自治**——不追求极致安全；在“后台优先 + 升级链 + 恢复原前台 + 审计注记”底座上做到“易用无感、自动提权、极危敏感警告、仅作基本兜底”（规格见 PLAN-usability-first）。

### Removed

- **危险词审批网关**：`computer_*` 动作不再向用户征询（零打断）；`guard()` 不再依赖 approval 服务，插件 `inject` 移除 `approval`。密码框 `click` 由“审批”改为“放行 + 凭据注记”。
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
