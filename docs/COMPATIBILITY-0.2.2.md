# COMPATIBILITY — dsh 0.2.2 兼容性升级报告

> 范围：本插件在 **dsh 0.2.2-rc.1** 上的清单/加载、工具契约、宿主服务、执行上下文、PTC 工具面与评测工具链。
> 环境：Windows 11 x64 · dsh `0.2.2-rc.1` · `@deepseek-ai/dsh-tools 0.2.2-rc.1` · `schemastery 3.19.0` · cua-driver 0.23.2。
> 状态：**P0/P1/P2 均已实施**；检查方法 = 静态 API 对照 + 真机 headless/native/vision/PTC 探针 + 22 套 457 断言 + S4 数据。

## 1. 结论

**核心桌面能力与 0.2.2 兼容；委派/视觉/PTC 的缺口已修复并真机验证。**

| 原级别 | 问题 | 当前状态 |
|---|---|---|
| **P0** | `computer_task` 只认 `ctx.subagents.start()`，0.2.2 只有 `startActivation()` | ✅ 已改为 `startActivation`；真机成功拉起子 agent 并返回结构化结果 |
| **P1** | 默认 `visionModel` 不在 0.2.2 模型目录 | ✅ 默认 `deepseek-flash`；真机 vision 成功 |
| **P1** | `nativeImage:auto` 未覆盖 `maxImageDimension`/`maxImagePixels` | ✅ 已纳入超限判定；驱动 0.23.2 不能整窗 zoom，超限明确失败；单测覆盖 |
| **P1** | PTC 工具面未验证 | ✅ `run_code` 内 `computer_do` 与 native 图片均真机通过 |
| **P2** | `toolFilter` 文案/工具描述仍暗示可限制 | ✅ 已改为“宿主能力相关”，0.2.2 明确无此参数 |
| **P2** | `dsh.compatibility.dsh` 无上限 | ✅ 改为 `>=0.2.2-rc.1 <0.3.0` |

## 2. 契约矩阵（0.2.2）

| 契约 | 0.2.2 事实 | 插件处理 | 状态 |
|---|---|---|---|
| 包清单 / bundle patch | `dsh.bundle.patch`、`--patch` 正常合成 | `cordis.patch.yml` + install | ✅ |
| `defineTool` | 作者面 schema 投影；新增 `timeoutMs` / `deferLoading` / `presentationMeta` 可选 | 使用必需字段，不依赖新增字段 | ✅ 向后兼容 |
| 工具输出 schema | `assertSupportedJsonSchema` + 严格输出校验 | 所有工具声明 output；降级字段齐全 | ✅ 真机 status/native 通过 |
| 参数校验 | `defineTool` 先校验参数再执行 | `wrap()` 另拒绝未知参数 | ✅ 双重校验 |
| 工具注册 | 全局/作用域；`run_code` 为保留名 | 只注册全局可见面 2 个 | ✅ |
| 工具限制 | `tools.restrict` 只认全局名 | 0.2.2 不再使用 `toolFilter` | ✅ 语义已改写 |
| `ToolRunContext` | 新增 `deferContext`/`concludeTurn`；保留 `agent`/`signal` | 只读 `agent`/`signal` | ✅ |
| attachments | 新增 `maxImageDimension` / `maxImagePixels`；返回归一化 ref | 已纳入 compact 判定 | ✅ |
| llm | `resolveModelInfo`/`stream` 契约保留 | native + vision 均真机通过 | ✅ |
| subagents | `startActivation(spec)`；`SubagentStartRequest` 无 `toolFilter` | `startActivation` + `delivery:'caller'` | ✅ P0 已修 |
| Agent 上下文 | `agent.options` / `session.requestHeader()` 保留 | provider/model、`exec.agent` | ✅ |
| PTC | web 默认 `agentPreset: ptc`；只直接暴露 `run_code` | 工具经 SDK 调用；`computer_do`/native 图片真机通过 | ✅ |
| Web runner | dsh 0.2.2 DOM/发送路径变化 | `evals/run.mjs` 已退役；默认拒绝，指向 `headless-run.mjs` | ⛔ 退役（非插件） |
| Node/peer | dsh-tools 0.2.2 / schemastery 3.19 | peer `>=0.2.2-rc.1 <0.3.0` / `>=3.19.0 <4` | ✅ |
| 兼容上限 | 0.3 可能再变 | `dsh.compatibility.dsh` 补 `<0.3.0` | ✅ |

## 3. 已实施改动

### P0 — `computer_task` 迁移到 `startActivation`

`lib/task.js` 现在只走 0.2.2 基线：

- `svc.startActivation({ provider, label, prompt, parent, signal, delivery:'caller', maxDepth, outputSchema, agentOptions })`；读 `activation.result`，结束 `activation.dispose()`。
- **运行时形状与类型声明不一致**：`dsh-subagent` 0.2.2-rc.2 的类型写嵌套 `request`，运行时 `startActivation` 读扁平 `spec.parent/prompt/...`；以运行时为准（真机踩坑）。
- 服务探测：只认 `startActivation`；provider 优先 `list()`（若存在），否则 `getProvider('spawn'/'in-process'/'fork')`，最后按 `spawn` 尝试。
- 成功路径写明：“本宿主不支持按调用限制子 agent 工具集；子 agent 拥有与父会话同级的能力；结构化输出仍生效。”
- `outputSchema` 被拒时自动去掉后重试，并标注“结果未结构化”；保留预算、超时、`maxDepth`。

测试：

- `tests/task.tool.mjs` T1：扁平 spec（provider/label/prompt/parent/signal/delivery）、无 `request`/`toolFilter`、结果映射、dispose。
- T6：`outputSchema` 被拒 → 第二次无 schema，回执如实标注。
- T8：只有 `list`、无 `startActivation` → 配方。

真机：

```text
computer_task(goal="只回复 OK，不要操作桌面", timeout_min=2)
→ ✅ computer_task 完成：OK
（说明：本宿主不支持按调用限制子 agent 工具集；子 agent 拥有与父会话同级的能力；结构化输出仍生效。）
```

### P1 — 视觉默认

- `index.js`：`visionModel` 默认改为 `deepseek-flash`；配置/工具描述同步。
- `lib/vision.js`：只接受配置的视觉模型；不再维护 legacy 模型兼容分支。
- 真机 `screen_observe(mode="vision")`：`（观察者 deepseek-official/deepseek-flash）` 返回界面描述，不再落到 GLM 无 key。

### P1 — 附件 dimension/pixels

- `lib/observe.js` `commitScreenshot` 的判定现在覆盖：字节数、单边 `maxImageDimension`、总像素 `maxImagePixels`。
- cua-driver 0.23.2 的 `zoom` 只能裁 ≤500px 宽区域，无法整窗缩放；`nativeImage:auto/compact` 超限时明确失败并提示 ax/vision 或 `screen_zoom`，不再假装 compact。
- 单测 N1：4000×3000 截图 + `maxImageDimension=1000` → 明确失败、零 `zoom` 调用。

### P1 — PTC 真机验证

隔离 headless overlay 启用 `tool-executor-ptc`（禁用 native）：

```text
run_code: const result = await tools.computer_do({ action: "status" }); return result;
→ ok=true / dispatcher / 20 hidden
```

PTC native：

```text
run_code: const r = await tools.screen_observe({ mode:"native" }); return r;
→ ok=true / image 附件 screen-11148.png / 349×229 / 85943B，主模型收到图
```

### P2 — 文案与上限

- README / ARCHITECTURE / MAINTAINING / VERIFICATION / 工具描述统一为“工具集限制取决于宿主”；0.2.2 没有 `toolFilter`。
- `package.json` `dsh.compatibility.dsh` 补 `<0.3.0`。
- `lib/task.js` 顶部注释与委派说明改为 0.2.2 `startActivation` 语义。

## 4. 真机证据

| 检查 | 结果 |
|---|---|
| headless 插件加载 + dispatcher | 5 步完成 `status` / `screen_observe` / `catalog` / 隐藏 `computer_wait`；2 可见/20 隐藏；`cacheReadTokens` 6528→7296 |
| native 图片链路 | 真实 `screen_observe(mode="native")` 返回截图附件（`screen-11148.png`，349×229，85943B）；主模型能看到图 |
| vision 默认 | `deepseek-flash` 观察者真实返回“视觉理解”段（界面元素列表） |
| PTC `run_code` | `tools.computer_do({action:'status'})` 返回 dispatcher/20 hidden |
| PTC native | `tools.screen_observe({mode:'native'})` 图片作为 deferred context 被主模型看到 |
| PTC + `computer_task` | `tools.computer_do({action:'call',tool:'computer_task',...})` 成功拉起子 agent；直接 `tools.computer_task` 为 `undefined`（SDK 只绑定可见工具，预期行为） |
| `computer_task` | 0.2.2 `startActivation` 真机拉起子 agent，返回结构化 `OK`，dispose 正常 |
| 桌面动作 smoke | 两轮 **7/8**（Round 2 4/4；`wa2` 对时间预算敏感） |
| 离线契约 | 22 套 **457** 断言；schema 22 工具 / 44 场景 |
| S4 oracle | 10/10（含 `x1`） |
| 打包 | 37 文件（新增 compat 报告 + keyFallback + loopGuard + RUNTIME-PIPELINE + trajectory + windowMap） |

## 5. 剩余风险 / 未覆盖

- **0.2.2 没有 `toolFilter`**：插件无法按调用限制子 agent 工具集；只由 Agent Preset/宿主组合决定。回执会明确写同级能力。
- **PTC 的 SDK 只绑定可见工具**：隐藏工具（如 `computer_task`）不会出现在 SDK；必须 `tools.computer_do({action:'call',...})`。已验证组合路径；直接 `tools.computer_task` 为 undefined 是预期行为。
- **Web runner（evals/run.mjs）已退役**：dsh 0.2.2 下会创建空会话；默认拒绝运行并指向 `headless-run.mjs`（`--allow-legacy-web` 仅旧 UI 调试）。
- macOS/Linux 的 0.2.2 未验证。
- `nativeImage:'full'` 仍可能因超大截图被宿主附件层拒绝——这是用户显式选择原图的预期语义，不是 auto 降级缺口。

## 6. 复现命令

```bash
npm test; echo "test=$?"                 # 457 断言
npm run check; echo "check=$?"           # 20/20
node verify-runtime.mjs                  # 17/17
node evals/headless-run.mjs --tier smoke --timeout-min 10
node evals/verify-oracles.mjs            # 10/10

# dsh 0.2.2 真机（headless + credentials + 当前插件）
dsh --profile headless --patch "<工作区>/_probe-win-cu-deepseek.yml" \
  --permission-mode read-only --approval-policy never \
  "调用 run_code：await tools.computer_do({action:'status'})"

# PTC（隔离 overlay 启用 tool-executor-ptc）
dsh --profile headless --patch "<工作区>/_probe-ptc.yml" \
  --permission-mode read-only --approval-policy never \
  "用 run_code 调用 tools.computer_do({action:'call',tool:'computer_task',args:{goal:'只回复 OK'}})"
```

探针 overlay 在仓库外；仓库内 `evals/headless-patch.yml` 是 headless S4 的可复用版本。
