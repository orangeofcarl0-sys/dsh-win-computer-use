# 文档索引 — dsh-win-computer-use

> 目的：按“读者要做什么”组织全部文档，并明确每篇文档描述的是**当前实现**、**历史证据**还是**研究分析**。
> 状态：当前索引（最后核对 2026-11-20）。
> 入口：[README](../README.md) · [安装](INSTALL.md) · [工具](TOOLS.md) · [配置](CONFIGURATION.md) · [排障](TROUBLESHOOTING.md)。

## 1. 按读者选择

| 你是 | 先读 | 再读 |
|---|---|---|
| 第一次安装/使用 | [README](../README.md) → [INSTALL](INSTALL.md) | [TOOLS](TOOLS.md) · [CONFIGURATION](CONFIGURATION.md) · [TROUBLESHOOTING](TROUBLESHOOTING.md) |
| 把插件集成进宿主/产品 | [ARCHITECTURE](ARCHITECTURE.md) → [RUNTIME-PIPELINE](RUNTIME-PIPELINE.md) | [COMPATIBILITY](COMPATIBILITY.md) · [DRIVER-SDK](DRIVER-SDK.md) · [TOOLS](TOOLS.md) |
| 排查具体失败 | [TROUBLESHOOTING](TROUBLESHOOTING.md) | [ERRORS](ERRORS.md) · [WINDOWS](WINDOWS.md) · [DRIVER-SDK](DRIVER-SDK.md) |
| 安全/权限审查 | [SECURITY](SECURITY.md) → [PERMISSIONS](../PERMISSIONS.md) | [store-evidence](store-evidence.md) · [VERIFICATION](../VERIFICATION.md) |
| 维护/发布 | [MAINTAINING](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/MAINTAINING.md) | [ARCHITECTURE](ARCHITECTURE.md) · [TESTING](TESTING.md) · [PUBLISH](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) |
| 评测/基准 | [TESTING](TESTING.md) | [evals/README](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/evals/README.md) · [RETIRED](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/evals/RETIRED.md) · [BLOCKED](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/evals/BLOCKED.md) · [EVIDENCE](EVIDENCE.md) · [TRAJECTORY-ANALYSIS](TRAJECTORY-ANALYSIS.md) |
| 研究/方案对比 | [CU-RESEARCH](CU-RESEARCH.md) | [TRAJECTORY-ANALYSIS](TRAJECTORY-ANALYSIS.md) · [ARCHITECTURE](ARCHITECTURE.md) |

## 2. 按任务选择

| 任务 | 文档 |
|---|---|
| 安装驱动、插件，升级/卸载 | [INSTALL](INSTALL.md) |
| 查某个工具的参数、默认值、前置、示例 | [TOOLS](TOOLS.md) |
| 改配置、查环境变量、看配置交互 | [CONFIGURATION](CONFIGURATION.md) |
| 查错误码含义和下一步动作 | [ERRORS](ERRORS.md) |
| 按现象排查（驱动/窗口/快照/投递/复核） | [TROUBLESHOOTING](TROUBLESHOOTING.md) |
| 理解安全边界和外发面 | [SECURITY](SECURITY.md) · [PERMISSIONS](../PERMISSIONS.md) |
| 确认 dsh/驱动/Node/OS/模型兼容性 | [COMPATIBILITY](COMPATIBILITY.md) |
| 改代码前理解模块和管线 | [ARCHITECTURE](ARCHITECTURE.md) · [RUNTIME-PIPELINE](RUNTIME-PIPELINE.md) |
| 改驱动适配层 | [DRIVER-SDK](DRIVER-SDK.md) |
| 处理 Windows 前台锁、UIPI、坐标、清理 | [WINDOWS](WINDOWS.md) |
| 启用/排障实验性后台输入（B0/B1/B2/B3） | [BACKGROUND-INPUT](BACKGROUND-INPUT.md) |
| 跑测试、加测试、看测试分层 | [TESTING](TESTING.md) |
| 看某次运行/探针的原始结果 | [EVIDENCE](EVIDENCE.md) |
| 看模型在 t11/t12 等任务上的行为 | [TRAJECTORY-ANALYSIS](TRAJECTORY-ANALYSIS.md) |
| 看 STORE 安装/启动/卸载证据 | [store-evidence](store-evidence.md) |
| 看当前验证矩阵和未验证项 | [VERIFICATION](../VERIFICATION.md) |

## 3. 三条阅读路径

### 10 分钟上手

1. [README](../README.md)：定位、设计立场、2 个稳定入口。
2. [INSTALL](INSTALL.md)：装 `cua-driver` 与插件，跑第一次观察。
3. [TOOLS](TOOLS.md) 的“观察 → 动作 → 复核”三节：只会用 `screen_observe`、`computer_do`、`computer_click` 也能完成第一轮。

### 排障

1. [TROUBLESHOOTING](TROUBLESHOOTING.md) 的决策树，定位失败阶段。
2. 用 [ERRORS](ERRORS.md) 查具体码的 `ok`/快照影响/下一步。
3. Windows 前台锁/UIPI/坐标问题转 [WINDOWS](WINDOWS.md)；驱动形态问题转 [DRIVER-SDK](DRIVER-SDK.md)。

### 改代码

1. [ARCHITECTURE](ARCHITECTURE.md)：模块、工具面、请求/观察管线、不变量。
2. [RUNTIME-PIPELINE](RUNTIME-PIPELINE.md)：宿主到驱动的完整链路、日志、失败语义。
3. [TESTING](TESTING.md)：先加离线测试，再跑真机；[MAINTAINING](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/MAINTAINING.md) 有硬知识和检查清单。

## 4. 文档状态

| 状态 | 含义 | 文档 |
|---|---|---|
| **当前参考** | 只描述现在为真的行为；数字与代码一致；由 `npm run docs:check` 校验 | [README](../README.md)、[INSTALL](INSTALL.md)、[TOOLS](TOOLS.md)、[CONFIGURATION](CONFIGURATION.md)、[ERRORS](ERRORS.md)、[TROUBLESHOOTING](TROUBLESHOOTING.md)、[SECURITY](SECURITY.md)、[COMPATIBILITY](COMPATIBILITY.md)、[ARCHITECTURE](ARCHITECTURE.md)、[RUNTIME-PIPELINE](RUNTIME-PIPELINE.md)、[DRIVER-SDK](DRIVER-SDK.md)、[WINDOWS](WINDOWS.md)、[BACKGROUND-INPUT](BACKGROUND-INPUT.md)、[TESTING](TESTING.md)、[PERMISSIONS](../PERMISSIONS.md)、[VERIFICATION](../VERIFICATION.md)、[store-evidence](store-evidence.md) |
| **维护** | 环境、发布、路线、版本历史；部分文件不进入 npm 包 | [MAINTAINING](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/MAINTAINING.md)、[PUBLISH](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md)、[ROADMAP](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/ROADMAP.md)、[CHANGELOG](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/CHANGELOG.md) |
| **历史证据** | 按日期追加，描述当时环境与结果，不代表当前行为 | [EVIDENCE](EVIDENCE.md)、[COMPATIBILITY-0.2.2](COMPATIBILITY-0.2.2.md)（别名页） |
| **研究分析** | 对模型行为、社区方案的分析；结论可能随版本变化 | [TRAJECTORY-ANALYSIS](TRAJECTORY-ANALYSIS.md)、[CU-RESEARCH](CU-RESEARCH.md) |
| **内部** | 评测/开发手册，不进入 npm 包 | [evals/README](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/evals/README.md) |

## 5. 术语表

| 术语 | 含义 |
|---|---|
| **观察** | `screen_observe`：读取目标窗口的 AX/UIA 树、native 截图或视觉描述。 |
| **快照** | 一次成功全量观察建立的编号表 + 窗口元数据；动作依赖它。默认 TTL 60s。 |
| **全局单例** | 同一会话只有一个快照；任意窗口的新全量观察都会替换 `snapshot_id`，旧 id 失效。 |
| **编号** | `screen_observe` 输出的 `[N]`，即 `element_index`；动作里用 `element: N`。 |
| **`element_token`** | 驱动侧的稳定元素句柄；编号动作最终走它，不依赖坐标。 |
| **回执** | 工具返回给模型的文本/结构化结果；成功、拒绝、未送达、未验证都在这里表达。 |
| **投递 L1/L2/L3** | 后台 → 前台 → `bring_to_front` 绕前台锁；详见 [WINDOWS](WINDOWS.md)。 |
| **window-screenshot-px** | 窗口截图原图像素；`screen_observe` 的 `@(x,y)` 与 `computer_click(x,y)` 同空间。 |
| **screen-physical-px** | 屏幕物理像素；元素 `frame`、密码 sidecar rect、`screenOrigin` 用这个空间。 |
| **zoom-image-px** | `screen_zoom` 返回图的像素；必须配 `from_zoom=true` 使用。 |
| **降噪** | 同窗口、同模式、界面哈希未变时的极简观察回执（`summary`/`brief`）。 |
| **输入未确认** | `computer_type`/`computer_set_value` 回读不一致或无法回读时的状态；只拦保存意图。 |
| **动作后复核** | `verifyAfterAction: auto` 的 opt-in 行为；默认关闭。 |
| **dirty** | 评测 cleanup 未能证明测试窗口可安全关闭时的状态；不算干净通过。 |

## 6. 文档约定

1. **当前 vs 历史**：当前参考文档只写“现在为真”；逐轮步数、探针输出、一次性结论进 [EVIDENCE](EVIDENCE.md)。版本历史进 [CHANGELOG](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/CHANGELOG.md)。
2. **证据等级**：`已实测`（真机/真实驱动）、`仅离线`（单测/桩）、`未验证`、`预期`（按发布说明/代码路径推断）。不把“代码存在”写成“已支持”。
3. **数字来源**：工具数、配置键、测试数、runtime 数、打包文件数、评测任务数以 `tests/docs.facts.json` 为准；`npm run docs:check` 会校验。
4. **链接规则**：发布包内文档（`README.md`、`VERIFICATION.md`、`PERMISSIONS.md`、`docs/**`）只能相对链接到发布包内文件；指向 `MAINTAINING.md`、`ROADMAP.md`、`PUBLISH.md`、`CHANGELOG.md`、`evals/` 时使用 GitHub 绝对 URL。
5. **标题结构**：一篇一个 H1；H2 为 `## N. 标题`；H3 为 `### N.M 标题`；不重复编号，不用 `## 7.1`。
6. **命令**：用 `<repo>`/`<path>` 占位符，标注 bash/PowerShell；不写本机绝对路径；破坏性步骤明确写“不要”。

### 6.1 术语变更（2026-11-19）

S1-S4 现在表示**测试阶段**：S1 基础功能、S2 像素定位、S3 覆盖面任务集、S4 Dirty 能力任务集。任务可同时属于多个阶段（t11=S2+S4，t12-t17=S3+S4）。

| 旧标签 | 旧含义 | 现称呼 |
|---|---|---|
| S4 | 0.5.4 的整套评测系统 | **eval** |
| S2 | 像素定位修订 | **像素定位修订（历史）** |
| S3a | 视觉断言协议 | **视觉断言协议** |
| S3b | 独立观察者裁决 | **独立观察者** |

冻结标识：`S4_TEMP`/`S4_POWERSHELL` 等环境变量、`~/.dsh/s4-evals/`、fixture 字符串（`S4 Bar`、`S4-T01`、`S4 Sales`）是历史兼容名，不代表新 S4 阶段。历史文档（EVIDENCE/CHANGELOG）只改标签，不改日期、命令与结果。

## 7. 维护

```bash
npm run docs:check    # 工具/配置/错误码覆盖、链接、过期数字、标题结构
npm run check         # 语法 52/52 + 文档/任务一致性
```

改工具、配置键、错误码、权限面或发布文件时，按 [MAINTAINING](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/MAINTAINING.md) 的检查清单同步文档，并更新 `tests/docs.facts.json`。
