# PTC 对象桥接（L1/L2，实验性）

> 状态：`ptcBridge` 默认 `off`。开启后只对 PTC preset 的 Agent 注册 `computer_cua`，默认 23 工具面不变。
> 本页描述的是 **PTC 对象层/协议子集**，不是 `computerUse` provider；不提供官方 `cuaAccess` 或逐应用同意 UI。

## 1. 定位

[官方 dsh-cua](https://github.com/deepseek-ai) 的 0.2.x 把 Computer Use 拆成：

- 单槽位 `computerUse` provider 注册；
- 应用级同意与 `cuaAccess` 权限 UI；
- `cua` 工具与 `connectCua` 对象层；
- PTC preset 作用域。

本插件采用其中的**契约纪律**，但坚持“用户无感、自动作用、基本安全”：

| 借鉴 | 不照搬 |
|---|---|
| app/window 对象模型 | 每应用逐次同意 |
| 元素 ID 绑定最新快照 | `cuaAccess` 持久授权 UI |
| `{method, params}` 原始协议子集 | 官方 provider 单槽位注册 |
| `dispatched` 结果语义 | 真实指针的隐式放行 |
| 能力声明与替代路径 | 用近似动作冒充缺口方法 |

PTC 程序通过 `tools.computer_cua` 使用桥接；普通 Agent 看不到它。

## 2. 配置

```js
ptcBridge: 'off'   // 默认；23 工具、2 可见
ptcBridge: 'on'    // PTC preset Agent 额外声明 computer_cua；工具数 23 + 1
```

- `apply()` 仍构建 23 个静态定义；`computer_cua` 只在 `on` 时追加，因此默认 `toolDefinitions()` 仍是 23。
- `on` 时通过 `agentPresets.composedPreset(agent.ctx) === 'ptc'` 过滤；没有 `agentPresets` 服务的 standalone 组合会全局注册（便于测试/嵌入式）。
- `computer_cua` 不进入 dispatcher catalog；`computer_do({action:'call'})` 不能路由它。
- `computer_do({action:'status'})` 会显示 `PTC: on/off`。

## 3. 使用

PTC 程序内：

```ts
var { connectCua } = await import("<plugin>/lib/ptc/facade.js");
var cua = connectCua(() => tools.computer_cua, { onText: t => console.log(t) });

var app = await cua.getApp("Notepad");
var windows = await app.getWindows({ emit: false });
var win = await app.getWindow(windows[0].windowId);
await win.getAccessibilityTree({ emit: true });
await win.click([120, 80]);
await win.typeText("hello");
var shot = await win.getScreenshot({ emit: false });
console.log(shot.pixelWidth, shot.pixelHeight, shot.bytes.length);
```

- `getWindows()` 返回窗口元数据数组，不是窗口对象；元素/动作方法在 `getWindow(windowId)` 返回的对象上。
- `getAccessibilityTree()` 建立/替换当前快照；元素 ID 为 `<snapshotId>:<index>`，其中 `snapshotId` 在树头 `快照 <id>` 中，`index` 是行首 `[index]`。
- 切换应用/窗口后旧 ID 失效；重新 `getAccessibilityTree()`。
- `emit:false` 只抑制 `onText`/`onImage`，返回值不变。
- 截图需要当前模型路由声明 `image` 输入；否则 `IMAGE_UNSUPPORTED`。

## 4. 核心方法

| raw 方法 | 对象层 | 说明 |
|---|---|---|
| `getCapabilities` | `cua.getCapabilities()` | 平台/权限/methods/`methodSupport` |
| `listApps` | `cua.listApps()` | 仅运行中应用 |
| `findApps` | `cua.findApps(query)` | 运行中 + 已安装 |
| `getApp` | `cua.getApp(selector)` | 精确 name/pid/bundle/path；stopped 可 `app_launch` |
| `listWindows` | `app.getWindows()` | bounds / isOnScreen |
| `getState` | `app/window.getAccessibilityTree()` | 树文本 + snapshotId + windows |
| `activate` | `app.activate()` | 明确前置 |
| `listActions` | `surface.listActions(id)` | 快照里保存的 actions（≤64） |
| `invoke` | `surface.invoke(id)` | 映射到 `computer_click(element)` |
| `setValue` | `surface.setValue(id, value)` | 字符串/数字/布尔 |
| `typeText` | `surface.typeText(text)` | 无快照时自动观察绑定窗口 |
| `pressKey` | `surface.pressKey(key, mods)` | `control→ctrl`、`option→alt`；`command/fn` 诊断 |
| `mouseMove` | `window.mouseMove(target)` | 仅虚拟覆盖层；`systemPointerMoved:false` |
| `click` | `window.click(target, opts)` | 左/右/双击；relative/modifier 透传 |
| `drag` | `window.drag(from, to, opts)` | 坐标/relative/button/modifier |
| `screenshot` | `window.getScreenshot()` | base64 + attachment + bytes |
| `show` | `app/window.show()` | Win32 `SW_SHOWNOACTIVATE` 非激活恢复；返回 `foregroundChanged` |
| `scroll` | `window.scroll(opts)` | UIA `ScrollPattern` 点滚动；返回 `moved/percentBefore/percentAfter/axisMoved`；无 pattern → `CAPABILITY_UNAVAILABLE` + 替代 |
| `performAction` | `surface.performAction(id, action, arg)` | 仅 `Invoke` / `ValuePattern.SetValue`；其他 action 诊断 |

所有输入动作经现有 hidden 工具执行，因此 `autonomy`、`computer_stop` 锁存、重复点击抑制、UIPI/投递阶梯、密码保护全部继承。`show`/`scroll` 是 direct native 动作，使用同一 `evaluatePolicy` 重新授权（show 套 `computer_activate` 规则，scroll 套 `computer_scroll` 规则）。

## 5. 剩余缺口与部分能力

`selectText` / `paste` / `sendKeyEvent` 仍**不近似**，返回 `CAPABILITY_UNAVAILABLE`，`details` 含 `status/reason/alternatives/probe`：

| 方法 | 原因（摘要） | 替代 |
|---|---|---|
| `selectText` | 需要 UIA TextPattern；当前驱动无 select_text | `setValue()` / `click()+ctrl+a` |
| `paste` | 需要剪贴板保存/恢复；typeText 语义不同 | `typeText()` / `computer_clipboard` |
| `sendKeyEvent` | 需要单次 key-down/up；现有 key 成对发送 | `pressKey()` |

部分能力：

- `performAction` 只支持 `Invoke` 与 `ValuePattern.SetValue`；`Expand/Collapse/SelectionItem/Toggle/Focus` 返回 `CAPABILITY_UNAVAILABLE` + `availableActions`。
- `scroll` 依赖目标点可命中的 UIA `ScrollPattern`；Web/自绘/无 pattern 区域会诊断，不会退化为“滚焦点区域”。实现按请求轴分别执行 `Small` 步进，并在前后读取 `Vertical/HorizontalScrollPercent`：`moved:true` 才算实际移动；`moved:false` 返回 `OPERATION_FAILED [scroll_no_effect]`；百分比不支持时返回 `dispatched:true, moved:null, effect:'unverified'`，不当作 pass。WinForms/PowerShell 托管目标可能对 PowerShell UIA 不暴露 pattern，此时是目标能力限制；WPF `ScrollViewer` 已实测可滚。
- `show` 对少数应用可能仍触发前台变化，如实返回 `foregroundChanged`；`effect` 与 `warningCode`（如 `show_incomplete`）直接透传 native 结果。

选项级诊断（`CAPABILITY_OPTION_UNAVAILABLE`）：

- `click.holdMs > 0`
- `click.mouseButton: 'middle'`
- `mouseMove.useSystemPointer: true`
- `getState.maxDepth/includeMenus/details`
- `pressKey/click/drag` 的 `command`/`fn` 修饰键

`CAPABILITY_UNAVAILABLE` 不是“工具坏了”，而是能力契约明确拒绝；错误文本带替代路径，模型/程序可以分支。

## 6. 快照与坐标

- 单会话单快照：任何新的 `getAccessibilityTree()`（含其它窗口）替换当前 `snapshotId`。
- 元素 ID 必须带 snapshot 前缀；旧 ID → `STALE_SNAPSHOT`。
- 坐标默认为窗口截图原图像素；`relative:true` 使用 0–999 千分比。
- 元素中心坐标来自当前观察；没有 frame/bounds 时不能可靠坐标操作。
- 应用级 AX 不支持：`app.getAccessibilityTree()` 会选择该应用的一个窗口。
- `getScreenshot()` 使用 capture-only 读取，不替换 AX token；会更新 relative 的截图尺寸基准。

## 7. 错误码

| 代码 | 含义 |
|---|---|
| `OBSERVE_REQUIRED` | 没有快照；先 `getAccessibilityTree()` |
| `STALE_SNAPSHOT` | 快照过期/被替换/元素不在快照 |
| `SCREENSHOT_REQUIRED` | 需要同窗口截图上下文 |
| `IMAGE_UNSUPPORTED` | 模型路由未声明 image |
| `ATTACHMENTS_UNAVAILABLE` | 组合未挂载 attachments |
| `APP_ACCESS_REQUIRED` | `appHandle` 缺失/无效 |
| `APP_NOT_FOUND` / `APP_AMBIGUOUS` / `APP_LAUNCH_FAILED` | 应用解析/启动失败 |
| `WINDOW_NOT_FOUND` | 窗口不属于应用或已关闭 |
| `POLICY_DENIED` / `APPROVAL_DENIED` / `APPROVAL_UNAVAILABLE` | autonomy 策略 |
| `OPERATION_LOCKED` | `computer_stop` 锁存 |
| `CAPABILITY_UNAVAILABLE` / `CAPABILITY_OPTION_UNAVAILABLE` | 缺口方法/选项 |
| `OPERATION_FAILED` / `OPERATION_TIMEOUT` / `DELIVERY_FAILED` | 执行失败/结果未知 |

facade 把这些包装成 `CuaError`（`code`、`details`）。

`scroll` 的细分原因在 `details.code`：`no_scroll_pattern` / `no_scroll_pattern_in_subtree` / `not_scrollable` / `point_not_in_target`（`CAPABILITY_UNAVAILABLE`）、`scroll_no_effect`（`OPERATION_FAILED`）、`scroll_partial`（`OPERATION_FAILED`）、`scroll_unverified`（成功返回 `dispatched:true, moved:null, effect:'unverified'`）。

## 8. 只读 UIA pattern 探针

本轮先做只读探针，不注入输入：

```bash
node evals/probe-uia-patterns.mjs --window Notepad
node evals/probe-uia-patterns.mjs --pid 4242 --window-id 77 --max 300 --json
```

脚本：[probe-uia-patterns.mjs](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/evals/probe-uia-patterns.mjs)、
[probe-uia-patterns.ps1](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/evals/probe-uia-patterns.ps1)。

读取 ScrollPattern/TextPattern/Invoke/ExpandCollapse/SelectionItem/Toggle/Value 覆盖；不截图、不点击、不写仓库。
本轮只读样本（元素数 / Scroll / Text / Invoke / ExpandCollapse / SelectionItem / Toggle / Value）：

| 目标 | 元素 | Scroll | Text | Invoke | Expand | Selection | Toggle | Value |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ZCode | 120 | 1 | 12 | 53 | 22 | 0 | 2 | 1 |
| Explorer | 80 | 1 | 0 | 22 | 8 | 12 | 0 | 71 |
| Firefox | 250 | 0 | 6 | 168 | 19 | 70 | 0 | 2 |

结论：ScrollPattern 覆盖窄但存在于 Document/List；TextPattern 存在于 Document/Combo/Text；Invoke/Expand 覆盖较好，SelectionItem 在浏览器覆盖较好。据此第一轮已实现 `show`（Win32 非激活恢复）、`scroll`（UIA ScrollPattern 点滚动，无 pattern 诊断）、`performAction`（Invoke/SetValue 窄子集）；第二轮再评估 `selectText`、`paste` 与 Expand/Collapse/SelectionItem/Toggle 映射。原始窗口内容未记录。

第二轮根据结果决定：

- TextPattern 覆盖足够 → 实现 `selectText`；
- `paste` 单独评估文本剪贴板保存/恢复；
- `performAction` 扩展到 Expand/Collapse/SelectionItem/Toggle/Focus（UIA helper 或驱动能力）；
- 覆盖不足则只增强 `methodSupport` 诊断，不强行近似。

## 9. 安全与边界

- `ptcBridge` 默认 off；普通 Agent 的工具面/prompt 不变。
- `computer_cua` 不直接调驱动做输入；输入经现有工具与 guard/policy。
- 子 Agent 默认不能移动真实指针；`useSystemPointer` 在桥接层直接诊断。
- 截图经 attachments 限额检查；render 不输出 base64。
- 没有新增可执行文件；`show` 复用 `tools/background-input.ps1`，`scroll` 新增 `tools/uia-scroll.ps1`（固定 argv、无 shell、无文件/网络）。探针在 `evals/`，不入 npm 包。
- 不是官方 provider：不注册 `computerUse`，不提供 `cuaAccess`/权限页/持久授权。
- 单快照、无应用级 AX、缺口方法诊断均为已知限制。

## 10. 验证

```bash
npm run check
npm test
node verify-runtime.mjs
node tests/live-action.e2e.mjs 3
node evals/probe-uia-patterns.mjs --window <benign>
npm pack --dry-run --json
```

PTC dogfood：`ptcBridge:on` + image-capable 模型；运行 §3 示例；确认工具面 3 个、无 `userQuestions`、`computer_stop` 后 `OPERATION_LOCKED`。

### 10.1 2026-11-23 真机结果

- **Headless `run_code`**（dsh 0.2.2-rc.5，`tool-executor-ptc`，driver 0.52.13）：WinForms fixture 上 **38/38**；WPF `ScrollViewer` 上 scroll 专项 **7/7**（down/up `moved:true`、percent 0→1.98→0、fixture offset 80/hOffset 16、at-limit `scroll_no_effect`、多轴 attempted 6）；覆盖 `setValue`/`performAction`/`typeText`/`invoke(Submit)`/截图/`show`/`stop+resume`。
- **Web `agentPreset: ptc`**：gating 通过（Standard header 不含 `computer_cua`/`run_code`）；`evals/probe-ptc-web.mjs` 四阶段 **25/25**：截图 `onImage` + image block/attachment、实际滚动（percent/offset 双 oracle）、宿主最小化后 `show` 恢复、stop→`OPERATION_LOCKED`→resume、缺口诊断；驱动 `--version` 首次超时后 15s 重试恢复 `0.52.13 (modern)`。
- **目标限制**：WinForms/PowerShell 托管窗口对 PowerShell UIA 不暴露 ScrollPattern，该目标只记 capability；WPF 目标已证实际滚动。详见 [EVIDENCE](EVIDENCE.md) §38。
