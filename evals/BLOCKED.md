# BLOCKED — 未覆盖 / 无法证明的能力

> 目的：把“测不了”和“测了但失败”分开。这里列出的项**不计入 pass**，也不写成“已支持”。
> 状态：2026-11-20。证据日期与命令内联；完整运行记录见 `docs/EVIDENCE.md`。

## 1. 真实运行时阻塞

| 项 | 证据 | 影响 | 解除条件 |
|---|---|---|---|
| WinForms MessageBox 模态期间的 UIA/动作 | `evals/probe-modal-timeout.mjs` / `probe-modal-escapes.mjs`（2026-11-20）：AX 树在 1s/5s/15s 预算下均为 0 元素；同 pid 主窗口也为 0；capture-only 1.5s 成功；`bring_to_front`/`press_key`/坐标 click 均阻塞。私有实现 `nativeDialogs:auto` 已对同 pid 标准 `#32770` 模态对话框提供 Win32 子控件扫描 + `BM_CLICK`（`evals/probe-native-dialog.mjs` 9/9 PASS）；`nativeButtonTrigger:auto` 对标准 WinForms Button 自建探针 4/4（1.2s 触发，默认 off）。WPF/WinUI/自定义 Button 未覆盖 | 默认配置下触发模态的 UIA click 仍可能 30s；`get_window_state` 调大 `timeout_ms` 不是修复 | 上游 #5012（`#5046` 是 closed-unmerged PR）；需要时显式开启 `nativeButtonTrigger` 并用 t20 overlay 复跑 |
| Excel modifier drop | `evals/probe-modifier-drop.mjs` 默认只覆盖 Explorer；Excel 分支未实现（需要 UIA 网格几何 + 保存/关闭路径） | Explorer Ctrl+drop 已回归；Excel/PPT 的 modifier drop 仍无自动证据 | 在专用桌面跑通 Excel A2→E2 Ctrl+drag、保存到临时副本并关闭；否则保持 BLOCKED |
| 独立观察者 / `screen_assert` | 无任务；需要 ZHIPU key 或 dsv4fv 文本输出修复 | 自绘/canvas 的“独立裁决”仍靠 oracle 文件，不是第二观察者 | 提供可用视觉 key 或修复文本输出 |
| `selectText` / key hold / mouse down-up / drag-from-element | 工具面不存在这些原语 | 复杂文本选择/形状拖拽仍靠坐标 | 驱动/插件新增原语后再测 |
| B2 cursor 锚定（`BlockInput`） | `evals/probe-background-input.mjs`（2026-11-20）：当前会话 `BlockInput(TRUE)` 返回 false（`block_input_failed`）；实现失败关闭，未移动光标 | B2 在能阻塞输入的普通交互会话才可用；当前不记 PASS | 在可 `BlockInput` 的会话复测；否则保持 BLOCKED |
| B1 目标处理 `WM_POINTER`/`WM_TOUCH` | 同探针（2026-11-20 硬化后）：`RegisterTouchWindow` 的 pointer 窗口收到 `TOUCHDOWN/UP`；只处理 `WM_TOUCH` 的窗口收到 `WMTOUCH`（合成 pointer 被系统转换）。普通 WinForms/自绘窗口未必处理 | B1 只对触控感知目标有端到端证据；不能外推到普通应用 | 对目标应用单独确认 `WM_POINTER`/`WM_TOUCH` 处理后再声明支持 |
| 多显示器 | `get_screen_size` 只暴露主屏 | 跨屏坐标/落点未验证 | 驱动暴露多屏枚举 |
| macOS 近期回归 / Linux | 近期测试都在 Windows；Linux 未验证 | 不能把“能加载”当“已验收” | 有环境时跑离线 + `verify-runtime` |

## 2. 已知边界（不是阻塞，但不计入 pass）

- **state 文件被信任**：`state.json`/`seedHash` 由 setup 写入；oracle 不证明模型没有改过它。mutation 只针对模型可达的产物，不测 state 篡改。
- **`app_launch` 子进程 IL**：2026-11-20 实测 daemon High、`powershell.exe` 子进程 Medium；alt+F4 可关闭，无残留。不同驱动/启动路径仍可能是 High；按实际 IL 判断，不把它写成“一律 High”。
- **p01-p03**：opencode image 路由 3/3 pass；text-only 路由未验证，失败时按模型能力失败处理，不记 ENV。
- **t13**：真实网络下载保留 `ac2:none`；SKIP 不是 PASS。t18 的本地 HTTP 下载补 AC2 覆盖。
- **ENV**：应用缺失、TabState 无法备份、网络不可达、模型凭据 401/402 一律记 ENV，不混入通过率。
- **AC6**：n<8 时 p90 不稳定；`totalTokens` 含 cacheRead，成本对比需同时看 `billable`。
- **`app_launch` 残留**：即使本次 alt+F4 成功，仍保留“驱动侧关闭失败→LEFT_OVER + 精确 HWND/PID”策略；不按进程名杀。
- **实验性后台输入**：B0/B1 只证明消息/触控已投递；目标可能忽略；B2/B3 会动光标/窗口；三键默认 off。B1 只左单击，B2/B3 只左单击；拖拽/滚轮/IME/右键/双击不在本功能内（B0 双击/右键除外）。脏桌面外部移动真实鼠标时，B1 的“光标未动”检查可能记 BLOCKED；最终干净轮次 0px 漂移通过，不把 BLOCKED 当 PASS。
- **`win`/`super`/`meta` 组合键**：本机旧实现会把 `win+r` 降级成单键 `win`（打开 Start/SearchHost），不可靠。2026-11-20 起 fail-closed，回执明确“不支持，用 app_launch/开始菜单”；不做原生 win 发送的承诺。

## 3. 规则

1. 新任务/探针遇到上述阻塞时，记录 `BLOCKED` 或 `ENV`，不要写 `PASS`。
2. 解除阻塞后，先在本文删除对应行，再把结果写进 `VERIFICATION.md` 与 `docs/EVIDENCE.md`。
3. 不要用“手工跑过一次”替代可复现命令；命令必须留在 `docs/TESTING.md` 或 `evals/README.md`。
