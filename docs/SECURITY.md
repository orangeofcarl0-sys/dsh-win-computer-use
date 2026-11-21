# SECURITY — 安全模型与威胁模型

> 目的：说明插件信任谁、能做什么、明确不承诺什么，以及部署时如何收紧。
> 读者：安全审查者、部署者、集成者。
> 状态：当前实现（最后核对 2026-11-22）。
> 相关：[PERMISSIONS](../PERMISSIONS.md)（权限声明）· [ERRORS](ERRORS.md)（拒绝行为）· [WINDOWS](WINDOWS.md)（OS 边界）。

## 1. 安全姿态

本插件的方向是**可观察、可回滚底座上的无感自治**，不是“极致安全沙箱”：

- 动作**零审批、零打断**；不弹确认框，不做危险词拦截。
- 唯一的内容级硬拒绝是**密码框自动输入**（`computer_type`/`computer_set_value`）。
- `extremePatterns` 命中只附警告注记，**不阻断**。
- 其余兜底是快照 TTL、无快照拒绝、`allowedApps` 白名单（默认关）、`computer_stop` 锁存。

因此，**模型被信任可以发起桌面动作**。插件负责把动作说清楚、把失败说清楚、把可回滚的边界做出来；它不负责判断“模型该不该做这件事”。

## 2. 信任边界

```text
用户
  │ 授权/监督
  ▼
对话模型 ── tool call ──► dsh 宿主（tools/attachments/llm/subagents）
                              │
                              ▼
                        本插件（index.js + lib/*）
                          │            │
                          │            └─ 宿主服务：图片持久化、视觉观察者、子 agent
                          ▼
                    cua-driver（本地进程，Windows 上 High IL）
                          │
                          ▼
                 Windows：UIA / SendInput / PostMessage / 剪贴板
```

| 边界 | 信任关系 | 含义 |
|---|---|---|
| 模型 → 宿主 | 宿主信任模型生成 tool call | 模型可能被界面文本/网页内容诱导（prompt injection） |
| 宿主 → 插件 | 插件信任宿主传入的 `ctx`/`exec` | 插件不验证宿主身份；按宿主 API 契约工作 |
| 插件 → 驱动 | 插件信任驱动返回的 UIA/截图/回执 | 驱动是本地高权限进程；插件只做分类，不伪造成功 |
| 驱动 → OS | OS 决定 UIPI/TCC/前台锁 | 插件不绕过 OS 权限边界 |
| 父 agent → 子 agent | 子 agent 可能继承父级能力 | `computer_task` 不是沙箱 |

## 3. 资产

| 资产 | 风险 |
|---|---|
| 桌面内容 | 截图/AX 树可能包含密码、聊天记录、邮件、文档正文 |
| 剪贴板 | `computer_clipboard(read)` 返回真实文本，可能含凭据 |
| 凭据 | 密码框、API key、令牌；插件只硬拒 element 模式的自动输入 |
| 用户文件 | 插件不直接读写；驱动/应用动作可能修改文件 |
| 前台焦点 | 强制前台会短暂切换焦点；可能干扰用户 |
| 审计数据 | 轨迹 JSONL 含工具名/参数摘要/长度/哈希；默认关闭 |

## 4. 插件实际强制

| 机制 | 范围 | 绕过/例外 |
|---|---|---|
| 密码硬拒 | `computer_type`/`computer_set_value` 且目标元素被标记为密码 | 坐标输入/未指定 element 无法预知目标；只在 element 模式生效 |
| 结构密码扫描 | Windows，`passwordScan: auto` | 失败/超时降级启发式；经典 Win32 `ES_PASSWORD` 依赖 sidecar |
| 原生对话框点击 | Windows，`nativeDialogs: auto`；只对同 pid 标准 `#32770` 模态对话框的 Button | 只发 `BM_CLICK`；不自动选择 Yes/No；坐标/输入/双击/右键不走该路径；`off` 禁用 |
| 原生菜单命令 | Windows，`nativeMenus: auto`（默认 off）；只对同 pid 顶层窗口标准 HMENU 的精确叶子路径 | 只发一次 `PostMessage(WM_COMMAND)`；不自动选择/不模糊匹配；MenuStrip/WPF/WinUI 不支持；超时可能已发送，不重试；`off` 零 spawn |
| 原生 Button 触发 | Windows，`nativeButtonTrigger: auto`（默认 off）；只对同 pid 标准 Win32/WinForms Button 的单次左键 | 只发一次 `PostMessage(BM_CLICK)`；class/style/label/屏幕点唯一匹配；不自动选择 Yes/No；明确未匹配回退 driver；owner_disabled/超时不回退；10s latch |
| 实验性后台输入 | `backgroundInput`/`syntheticPointer`/`anchoredInput` 默认 `off`；只对无交互 UIA 的目标；B1/B2/B3 需 `allowedApps` 非空；B1 遮挡失败关闭；B2 `cursor` 先 `BlockInput` 成功才移光标；B3 只移 `allowedApps` 窗口 | B0 可对任意无交互 UIA 目标发消息；helper 仍受 UIPI/安全桌面/完整性限制；B2 会短暂动光标、B3 会短暂移窗口；`off` 零 spawn。通道矩阵、错误码与安全边界统一见 [BACKGROUND-INPUT](BACKGROUND-INPUT.md) |
| 快照 TTL / 无快照拒绝 | 操作类工具（click/type/key/scroll/drag/set_value） | 菜单/悬停/应用列表/激活不要求快照 |
| `allowedApps` | 操作类工具；精确 `appName` | 观察/启动/激活不受限；空 = 关闭 |
| `computer_stop` 锁存 | 全部桌面操作 | `computer_resume` 是唯一解锁路径 |
| 重复点击抑制 | click/right_click，5s | `double_click` 不拦；`actionGuard: off` 可关 |
| 输入未确认保存门禁 | 保存意图（Ctrl+S、保存/另存为元素/菜单） | 其它输入/点击仍可用；回读一致/native/zoom 可解除 |
| 回执目标回显 | 点击/输入 | 坐标点击按 24px 最近元素；不是安全边界，是可见性 |

### 4.1 测试语义：保证、非保证与偏置（2026-11-21）

本项目的安全语义是“可观察、可回滚底座上的无感自治”，不是“拒绝危险动作”。因此安全测试分三类：

| 类别 | 内容 | 测试方式 |
|---|---|---|
| **硬保证** | 密码 element 拒绝、`allowedApps` 生效时拒绝、`stop/resume` 锁存、快照 TTL/stale 拒绝、分类器/helper 对安全桌面/UIPI 拒绝、原生对话框同 pid/不自动 Yes-No、后台输入 fail-closed、eval 只关 owned HWND/PID | 离线/真机探针 + `sec01`–`sec04` 任务级契约；`require_tools` 强制实际尝试。UIPI 跨 IL 已有一次授权 UAC 真机证据（sink RID 12288、helper `uipi`、0 events；修正后 UAC 复跑待做）；UAC 安全桌面不可自动化 |
| **非承诺** | prompt injection、危险词拦截、剪贴板/截图脱敏、沙箱、UAC 自动化 | **不作为插件 pass/fail**；需要时另做模型记分卡，且不得把“模型未拒绝”记成插件缺陷 |
| **偏置** | `allowedApps` 内破坏性动作可能成功；`allowedApps` 默认关闭；`stop` 是唯一硬停止 | 断言回执真实、`stop` 可阻止、文档不宣称“插件会拦截危险动作”；不断言“必须拒绝” |

安全任务（`sec01`–`sec04`）使用自建 WinForms fixture；`sec02/sec04` 还使用 Notepad 正向控制，确保空跑不会因“没有副作用”而误判通过。通用 OS-Harm/Agent-SafetyBench 类基准不直接搬进插件回归。

## 5. 明确不承诺

1. **不是沙箱**：`computer_task` 在 dsh 0.2.2 没有 `toolFilter`，子 agent 可能拥有与父会话同级能力；回执会写明。
2. **不防 prompt injection**：界面文本、网页、文件名、聊天内容都可能包含诱导模型的指令；插件不做内容隔离/清洗。
3. **不防剪贴板外泄**：`read` 返回真实内容；模型可能把它写进回执/下一步动作。
4. **不防截图敏感信息**：`native`/`vision`/GLM 兜底会把截图交给模型或外部端点；截图可能包含屏幕上的任何内容。
5. **不承诺绕过 UIPI/TCC/管理员窗口**：High IL 目标、系统对话框、受保护内容仍由 OS 决定。
6. **不保证像素点击落点**：驱动 0.23.2 在混合 DPI 下有实测偏差；element 路径是可靠主路径。
7. **不保证“零审批 = 零风险”**：零审批是产品选择；风险由部署者通过白名单、模型选择、任务边界承担。
8. **不保证驱动自身可信**：驱动是高权限本地进程；插件只消费其输出，不审计驱动内部。
9. **不保证后台注入被目标接受**：B0/B1 只证明消息/触控已投递；目标可能忽略，或反作弊/EDR 拦截。插件不规避检测。
10. **不做 UAC/安全桌面自动化**：B0-B3 遇到非 Default 输入桌面直接拒绝。

## 6. 数据外发

| 路径 | 外发内容 | 触发条件 | 控制 |
|---|---|---|---|
| 核心观察/动作 | 无网络 | 默认 | 只经本地驱动 |
| `vision` 观察者 | 截图 + 问题交给配置的 provider | `mode:"vision"` | `visionProvider`/`visionModel`；宿主 `ctx.llm` |
| GLM 兜底 | 截图 base64 + 问题 POST 到 `GLM_API_BASE` | `vision` 路径且配置 `ZHIPU_API_KEY`/`GLM_API_KEY` | 不配置 key 即停用；端点可配 |
| `native` | 截图作为图片块交给当前对话模型 | `mode:"native"` | 模型/provider 由宿主决定 |
| 子 agent | 目标/上下文交给子会话 | `computer_task` | 宿主 subagent 配置 |
| 轨迹 JSONL | 工具名、参数摘要、长度/哈希、驱动摘要 | `trajectoryFile`/`DSH_CU_TRAJECTORY_FILE` | 默认关闭；本地文件 |

**部署时须知**：启用 GLM 兜底 = 把截图内容发送到智谱端点；启用 native/vision = 把截图交给模型 provider。两者都可能在截图中包含敏感信息。

## 7. 委派权限

- `computer_task` 走宿主 `subagents.startActivation`；dsh 0.2.2 的 `SubagentStartRequest` 没有 `toolFilter`。
- 插件会写“子 agent 拥有与父会话同级的能力”，不假装已限制。
- 需要严格限制时，用宿主自己的 Agent Preset/子 agent 机制；不要依赖插件参数。
- `maxDepth: 1` 阻止子 agent 再派生；`maxTaskCalls` 限制次数；`timeout_min` 限制时长。

## 8. 审计与证据

- `trajectoryFile` 写 JSONL：`session_start`/`tool_start`/`tool_end`/`driver`/`loop`/`session_end`；文本只记长度+哈希，驱动只记摘要，AX 树不落盘。
- 会话日志在宿主侧：`~/.dsh/sessions/.../session.v4.jsonl.zstd`；插件不额外上传。
- 回执/日志不应包含密码值；密码框回执显示“值（已隐藏）”。
- 证据报告 [VERIFICATION](../VERIFICATION.md)；按日期证据 [EVIDENCE](EVIDENCE.md)。

## 9. 部署建议

| 场景 | 建议 |
|---|---|
| 生产/共享桌面 | 设 `allowedApps` 限定应用；关闭不必要的 `vision`/GLM；`passwordScan: auto`；`deliveryMode: background` 或 `auto` |
| 高安全任务 | 不给模型 `computer_task`；用宿主 Agent Preset 限制工具；关闭轨迹或把轨迹写到受控目录 |
| 演示 | `cursorMotion: human` 可见滑行；`foreground` 按需；注意截图外发 |
| 评测 | 用隔离 profile；dirty 任务复用用户桌面时严格遵守清理规则（[WINDOWS](WINDOWS.md) §7） |
| 不希望任何文件写入 | 保持 `trajectoryFile: ''` 且不设 `DSH_CU_TRAJECTORY_FILE` |
| 实验性后台输入 | 默认全关；确需启用时先设 `allowedApps`，只在干净桌面验证；B2 会短暂抢光标、B3 会短暂移窗口；B1 遮挡失败关闭。见 [BACKGROUND-INPUT](BACKGROUND-INPUT.md) |

## 10. 漏洞报告

本项目是个人 MIT 项目，没有正式安全响应 SLA。发现权限面/数据外发/凭据处理问题时：

1. 不要在公开 issue 里贴 key、用户文档、截图；
2. 用最小复现描述：工具、参数、平台、驱动版本、回执；
3. 如果是权限声明与实现不一致，附 `PERMISSIONS.md` 对应段落与代码路径；
4. 修复后补测试与 `docs:check` 覆盖。

## 11. 与 PERMISSIONS 的关系

- [PERMISSIONS.md](../PERMISSIONS.md) 是**声明**：spawn 什么、读什么环境变量、是否联网、写不写文件。
- 本文是**威胁模型**：这些能力在什么条件下会出问题、插件不承诺什么。
- 两者冲突时，以代码与 `package.json dsh.permissions` 为准；修代码后同步两份文档。
