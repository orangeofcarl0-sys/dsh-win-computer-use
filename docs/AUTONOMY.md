# AUTONOMY — 自治策略与 auto 语义

> 目的：说明 `autonomy` 契约如何在不改变“用户无感、自动作用、基本安全”的前提下，提供可判定、可审计、可撤销的应用级策略。
> 读者：部署者、集成者、要改 `lib/policy.js` / `lib/guard.js` / `lib/task.js` 的维护者。
> 状态：当前实现（最后核对 2026-11-23；`lib/policy.js` + `autonomy` 配置）。
> 相关：[CONFIGURATION](CONFIGURATION.md) · [TOOLS](TOOLS.md) · [ERRORS](ERRORS.md) · [ARCHITECTURE](ARCHITECTURE.md) · [SECURITY](SECURITY.md)。

## 1. 立场

官方 CUA 的授权模型是“每次应用操作前问用户”。本插件保留它的**语义契约**（应用身份、作用域、撤销、审计），但把判定权交给确定性策略引擎：

- **auto（默认）**：零 `userQuestions`；`blockedApps` 拒绝，`sensitiveApps` 只读，子 Agent 默认不能移动真实指针；
- **locked**：只允许 `allowedApps` 内的应用；禁真实指针/委派；`allowedApps` 为空时 fail-closed；
- **guarded（显式 opt-in）**：只对 `sensitiveApps` 操作与真实指针做会话级询问；子 Agent 不能询问。

因此 auto 不是“没有契约”，而是“契约由配置 + 硬边界 + 回执/轨迹审计执行”，不需要逐步请求用户。

## 2. 模式

| 模式 | 是否询问用户 | 应用操作 | 真实指针 | 委派 |
|---|---|---|---|---|
| `auto` | 否 | `blockedApps` 拒绝；`sensitiveApps` 只读；`allowedApps` 非空时白名单 | 主 Agent 允许；子 Agent 默认拒绝 | 按 `subagents.delegation` |
| `locked` | 否 | 只允许 `allowedApps`；为空则全部拒绝（观察仍可用） | 一律拒绝 | 一律拒绝 |
| `guarded` | 仅敏感应用/真实指针，每会话一次 | `blockedApps` 拒绝；`sensitiveApps` 询问 | 主 Agent 询问；子 Agent 拒绝 | 按 `subagents.delegation` |

`locked` 是预设：`normalizeAutonomy` 会强制 `realPointer=deny`、`subagents.realPointer=deny`、`subagents.delegation=deny`。

## 3. 配置

```yaml
autonomy:
  mode: auto              # auto | locked | guarded
  blockedApps: []         # 永久拒绝操作（观察仍可用）
  sensitiveApps: []       # auto 只读；guarded 询问；locked 拒绝
  realPointer: auto       # auto | deny（主 Agent 的真实指针）
  subagents:
    realPointer: deny     # deny | inherit（默认 deny）
    delegation: allow     # allow | deny
```

- `blockedApps` / `sensitiveApps` 按快照 `appName` 精确匹配；`app_launch` 按 `name`。
- `allowedApps` 仍是既有白名单；非空时对 `computer_menu` / `computer_hover` / `computer_activate` / `app_launch` 也生效。
- 子 Agent 真实指针默认 deny 是有意的安全收紧；`inherit` 才恢复旧行为。
- 未配置 `autonomy` 时等价于 `mode:auto`、空名单、`realPointer:auto`、`subagents.realPointer:deny`、`delegation:allow`。

## 4. 规则表

| 优先级 | 规则 | 结果 |
|---:|---|---|
| 1 | `locked` + 无 `allowedApps` | 拒绝应用操作（`policy_locked_no_allowlist`） |
| 2 | `locked` + 应用不在 `allowedApps` | 拒绝（`policy_locked`） |
| 3 | `locked` + 剪贴板 | 拒绝（`policy_locked`） |
| 4 | `blockedApps` 命中 | 拒绝（`policy_blocked_app`） |
| 5 | `allowedApps` 非空 + 应用不在列表 | 拒绝（`policy_not_allowlisted`） |
| 6 | `sensitiveApps` 命中 + auto/locked | 拒绝操作（`policy_sensitive_app`；观察仍可用） |
| 7 | `sensitiveApps` 命中 + guarded | 会话级询问（`policy_sensitive_app`） |
| 8 | 子 Agent + 真实指针 + `subagents.realPointer=deny` | 拒绝（`policy_subagent_pointer`） |
| 9 | 主 Agent + `realPointer=deny` | 拒绝（`policy_real_pointer_denied`） |
| 10 | guarded + 真实指针 + 主 Agent | 会话级询问（`policy_real_pointer`） |
| 11 | 子 Agent + `computer_task` | 拒绝（`policy_delegation_denied`） |
| 12 | `subagents.delegation=deny` / locked | 拒绝（`policy_delegation_denied`） |
| 13 | 其他 | 允许 |

策略拒绝发生在动作前：**不消费快照、不进入重复抑制、不调用驱动**。

## 5. 决策顺序

```text
opsGate（stop 锁存）
  → 未知参数拒绝
  → guard（快照/白名单/密码/保存门禁/极危注记）
  → evaluatePolicy（本文件）
      deny → 直接返回策略拒绝
      ask  → resolvePolicyDecision（仅 guarded）
  → checkRepeat
  → 工具实现
  → 合并 guard/policy 注记
```

`computer_do` 外壳跳过策略；被路由的内层工具在各自的 `wrap` 中重新判定。这样 dispatcher 不能绕过策略。

## 6. guarded 询问

- 仅 `sensitiveApps` 首次操作与真实指针首次移动询问；普通应用不询问。
- 会话缓存：`app:<appName>`、`pointer:real`；允许/拒绝后本会话不再问。
- 子 Agent 不能询问：`policy_approval_unavailable` / `policy_subagent_pointer`。
- `ctx.get('userQuestions')` 缺失、无 agent、取消、异常 → fail-closed。
- 不持久化、不提供“Always allow”；`computer_stop` 与插件重新 `apply` 清空缓存。

## 7. 回执与审计

- 默认允许不加注记，避免污染成功回执。
- 策略拒绝回执以 `[policy_*]` 开头，并给出下一步（观察仍可用、如何放行/切换模式）。
- `computer_do({action:'status'})` 显示模式、名单数量、真实指针/委派设置；若检测到官方 CU provider，附“共享桌面，建议只启用一套”。
- 轨迹开启时，每次决策写 `policy_decision` 事件（tool/decision/rule/code/app/origin）；不新增 tool 事件，`summary.tools` 不变。

## 8. 坐标契约（relative）

- `computer_click` / `computer_double_click` / `computer_right_click` / `computer_drag` / `computer_hover(real=false)` 支持 `relative: true`。
- 坐标取 0–999 整数，按当前快照的 `screenshotWidth/Height`（缺失时回退窗口 bounds）换算为窗口截图像素并 clamp。
- `relative` 与 `from_zoom` 互斥；`real=true` 不支持 relative；需要快照带窗口截图尺寸。
- 错误码：`relative_coordinate_invalid`、`relative_coordinate_unavailable`、`relative_from_zoom_conflict`。

## 9. 图像契约

`screen_observe(mode="native")` 与 `screen_zoom` 在保存附件前检查当前模型是否声明 `image` 输入；不满足时返回 `[model_image_unsupported]` 并建议 `mode="ax"` 或切换视觉模型。截图仍走 `lib/attach.js` 的 attachments 管线。

## 10. 限制与不变量

- 应用身份按名称精确匹配，不是防仿冒的强身份；需要更强身份时后续扩展路径/哈希。
- 无快照的 `computer_menu` / `computer_activate` / `computer_hover` 无法套用应用级规则；`allowedApps` 非空时会因无法确认而拒绝。
- 坐标模式的密码框/敏感输入仍无法在元素级预判；`sensitiveApps` 是应用级兜底，密码硬保护仍是元素级。
- `locked` 不改变 `deliveryMode` 的自动前台升级；它只拒绝显式应用操作/真实指针/委派。

### 10.1 PTC 对象层

`ptcBridge:on` 时，PTC 程序通过 `computer_cua`/`connectCua` 调用同一批动作；**没有第二套授权**：

- 每个动作仍进入现有工具的 `guard → evaluatePolicy → checkRepeat`；`show`/`scroll` 是 direct native 动作，用同一 `evaluatePolicy` 重新授权（show 套 `computer_activate`、scroll 套 `computer_scroll` 规则）。
- `blockedApps` 观察允许、动作拒绝；`sensitiveApps` auto 只读；`locked` 只允许 `allowedApps`；
- `computer_stop` 锁存对 `computer_cua` 同样生效（`OPERATION_LOCKED`）；
- 子 Agent 默认不能移动真实指针；`useSystemPointer` 在桥接层直接给 `CAPABILITY_OPTION_UNAVAILABLE`；
- `performAction` 仅 Invoke/ValuePattern.SetValue；`selectText/paste/sendKeyEvent` 不近似，返回能力诊断与替代路径。
- guarded 只覆盖敏感应用与真实指针，不是“每个应用都问”；默认 auto 仍零提示。
- 策略引擎是纯函数：不读全局快照、不 spawn、不网络、不询问；询问只在 `resolvePolicyDecision`。

## 11. 示例

```yaml
# 个人默认：零提示；只禁止密码管理器/银行应用
autonomy:
  mode: auto
  blockedApps: [KeePassXC, 'Bank of America']

# 共享机器：敏感应用与真实指针逐次询问
autonomy:
  mode: guarded
  sensitiveApps: [KeePassXC, Terminal]
  realPointer: auto
  subagents:
    realPointer: deny

# Kiosk：只允许 Calculator/Notepad，禁真实指针/委派
autonomy:
  mode: locked
allowedApps: [Calculator, Notepad]
```

## 12. 验证

- 离线：`npm test` 的 `tests/policy.test.mjs` 覆盖 auto/locked/guarded 矩阵、guarded 缓存、子 Agent、委派、相对坐标、图像预检。
- 机器检查：`npm run check` 校验配置键数、错误码覆盖、文档链接与计数。
- 真机：`node verify-runtime.mjs`（18/18）与 `node tests/live-action.e2e.mjs 3`（33/33 步）确认默认路径未回归。
