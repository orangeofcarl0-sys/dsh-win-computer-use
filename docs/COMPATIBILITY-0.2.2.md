# COMPATIBILITY — dsh 0.2.2 全面兼容性检查

> 范围：本插件在 **dsh 0.2.2-rc.1** 上的清单/加载、工具契约、宿主服务、执行上下文、PTC 工具面与评测工具链。
> 环境：Windows 11 x64 · dsh `0.2.2-rc.1` · `@deepseek-ai/dsh-tools 0.2.2-rc.1` · `schemastery 3.19.0` · cua-driver 0.23.2。
> 方法：静态 API 对照 + 真机 headless/native/vision 探针 + 现有 231 断言与 S4 数据。
> 本轮**只做检查，不改变插件行为**；修复建议按 P0/P1/P2 排列。

## 1. 结论

**核心桌面能力已兼容；委派与默认视觉配置尚未兼容。**

| 级别 | 问题 | 影响 |
|---|---|---|
| **P0** | `computer_task` 仍要求 `ctx.subagents.start(provider, request)`，0.2.2 只有 `startActivation(spec)` | 在挂载了 subagents 的 0.2.2 宿主上，委派功能不可用；当前会返回“本宿主未提供 subagents 服务”的配方，而不是真正委派 |
| **P1** | 默认 `visionModel = deepseek-v4-flash-vision-exp` 不在 0.2.2 的 DeepSeek 模型目录 | `mode="vision"` 必然先报模型未声明 image，再因无 `ZHIPU_API_KEY` 失败；`native` 不受影响 |
| **P1** | `nativeImage:auto` 只检查 `maxImageBytes` | 0.2.2 新增 `maxImageDimension`/`maxImagePixels`；超大截图会被附件层拒绝，而不是自动降级 compact |
| **P1** | Web profile 默认 `agentPreset: ptc`，PTC 只直接暴露 `run_code` | 插件工具预计经 SDK 调用，但尚未做真实 PTC 会话验证；不能宣称已验证 |
| **P2** | `toolFilter` 在 0.2.2 已从 subagent API 移除 | README/工具描述/注释仍暗示“子 agent 只用桌面工具”，需要改成“宿主能力相关” |
| **P2** | `dsh.compatibility.dsh` 只有下限，没有上限 | 0.3 若再改 API，不会被清单显式挡住 |

**可以确认兼容的部分**：包清单/bundle 加载、22 个 `defineTool` 注册、参数/输出 schema、图片 render、dispatcher、native 观察、真实工具调用、prompt cache 行为。

## 2. 契约矩阵

| 契约 | dsh 0.2.2 事实 | 插件用法 | 结论 |
|---|---|---|---|
| 包清单 / bundle patch | `dsh.bundle.patch`、`--patch` 正常合成 | `cordis.patch.yml` + install | ✅ |
| `defineTool` | 支持作者面 schema 投影；新增 `timeoutMs` / `deferLoading` / `presentationMeta` 可选字段 | 使用必需字段；未用新增字段 | ✅ 向后兼容 |
| 工具输出 schema | `assertSupportedJsonSchema` + 严格输出校验 | 所有工具声明 output；降级字段齐全 | ✅ 真机 native/status/catalog 通过 |
| 参数校验 | `defineTool` 现在会先按参数 schema 校验，再调用 `execute` | `wrap()` 另做未知参数拒绝 | ✅ 双重校验，行为一致 |
| 工具注册 | `tools.register` 全局/作用域；`run_code` 为保留名 | 只注册全局可见面 2 个 | ✅ |
| 工具限制 | `tools.restrict` 只认全局名；scope-local 名会报错 | 旧 `toolFilter` 依赖此机制 | ❌ 见 P0/P2 |
| `ToolRunContext` | 新增 `deferContext` / `concludeTurn`；保留 `agent` / `signal` | 只读 `agent` / `signal` | ✅ |
| attachments | 新增 `imageLimits.maxImageDimension` / `maxImagePixels`；`saveImage` 返回归一化 ref | 只检查 `maxImageBytes`；使用 `attachmentId/mediaType/bytes/width/height` | ⚠️ 见 P1 |
| llm | `resolveModelInfo` 仍返回 `inputModalities`；`stream` chunk 仍含 `text-delta`/`reasoning-delta`/`error` | `vision` 观察者与 native route 探测 | ✅ 接口；⚠️ 默认模型见 P1 |
| subagents | `startActivation(spec)`；`SubagentStartRequest` 无 `toolFilter`；`list()` 仍在 | `svc.start(provider, base)` + `toolFilter` | ❌ P0 |
| Agent 上下文 | `agent.options` / `session.requestHeader()` 仍在 | 取 provider/model、`exec.agent` | ✅ |
| PTC | web profile `selectedDefault: ptc`；只直接暴露 `run_code` | 未做真实 PTC 会话 | ⚠️ 未验证 |
| Web runner | dsh 0.2.2 DOM/发送路径变化 | `evals/run.mjs`（0.1.5 UI 选择器） | ❌ 工具链，不是插件 |
| Node/peer 依赖 | dsh-tools 0.2.2 / schemastery 3.19.0 | peer `>=0.1.5-rc.2 <0.3.0` / `>=3.18.2 <4` | ✅ |

## 3. 关键发现

### P0 — `computer_task` 的 subagents 契约已变

插件位置：

- `lib/task.js:97`：`if (!svc || typeof svc.start !== 'function' || typeof svc.list !== 'function')` → 直接返回委派配方。
- `lib/task.js:131`：`svc.start(provider, base)`。
- `lib/task.js:115`：`toolFilter: { allow: GUI_ONLY_TOOLS }`。

0.2.2 事实：

- `@deepseek-ai/dsh-subagent` 的 `SubagentRuntime` 公开方法为 `startActivation(spec)`（`lib/types/index.d.ts:136/146`）；没有 `start(provider, request)`。
- `SubagentActivationSpec`：`{ provider, label, childId?, request, signal, delivery: 'parent'|'caller' }`。
- `SubagentStartRequest` 支持 `prompt` / `parent` / `signal` / `agentOptions` / `outputSchema` / `maxDepth` / `cwd` / `agentPreset`；**没有 `toolFilter`**。
- 返回 `SubagentActivation`：`{ childId, messageId?, result: Promise<SubagentResult>, dispose() }`；`SubagentResult` 有 `output` / `structured?` / `stopReason` / `diagnostic?`。
- 宿主自带的 `@deepseek-ai/dsh-tool-subagent` 也明确在配置层拒绝 `toolFilter`（“configure persona and tool plugins in an Agent Preset”）。

实际后果：在 0.2.2 上，`svc.start` 不存在 → `lib/task.js:97` 直接返回“本宿主未提供 subagents 服务”的配方；即使宿主已经挂载 subagents，也不会委派。headless 探针因为本身没有 subagents，看到的是同一个配方，无法区分“没服务”和“API 变了”。

建议修复（P0）：

1. 服务探测改为 `typeof svc.startActivation === 'function' || typeof svc.start === 'function'`。
2. 新路径构造：
   ```js
   await svc.startActivation({
     provider,
     label,
     request: { prompt, parent: exec.agent, outputSchema, maxDepth: 1, agentOptions },
     signal: exec.signal,
     delivery: 'caller',
   })
   ```
   结果读 `activation.result`，结束 `activation.dispose()`；不要再传 `toolFilter`。
3. 保留旧 `svc.start` 分支给 0.1.5；两条路径用同一套结果映射。
4. 0.2.2 无法按调用限制子 agent 工具集；回执必须明确“子 agent 拥有与父会话同级的能力”，除非宿主用 Agent Preset 预置了 GUI-only 组合。
5. 增加 `tests/task.tool.mjs` 的 0.2.2-like fake（只有 `startActivation`）和旧 API fake 两套断言。

### P1 — 默认 `visionModel` 不在 0.2.2 目录

插件位置：`index.js:96`、`index.js:790` 默认 `deepseek-v4-flash-vision-exp`。

0.2.2 事实：`@deepseek-ai/dsh-llm-deepseek` 的 `DEFAULT_MODELS` 只有：

- `deepseek-flash`（`inputModalities: ['text','image']`）
- `deepseek-v4-pro`

真机证据：`screen_observe(mode="vision")` 返回：

```text
（DeepSeek 观察者不可用：视觉观察模型 deepseek-official/deepseek-v4-flash-vision-exp 未声明 image 输入…）
（视觉理解失败：视觉兜底需要 ZHIPU_API_KEY…）
```

建议：

- 0.2.2 的默认 `visionModel` 改为 `deepseek-flash`；
- 或保留旧默认但在 `deepseekVisionDescribe` 中检测“配置模型不可用 + 存在 `deepseek-flash`”时做一次显式回退；
- 更新 README/配置表/`cordis.patch.yml` 示例；在 0.1.5 上仍允许用户显式指定旧模型。

### P1 — `nativeImage:auto` 未覆盖 0.2.2 的新附件限额

插件位置：`lib/observe.js:257` 只取 `maxImageBytes`。

0.2.2 `ImageAttachmentLimits` 新增：

- `maxImageDimension`（默认 65535）
- `maxImagePixels`（默认 64,000,000）

建议在 `commitScreenshot` 的 compact 判定中加入：

```js
const limits = attachments.imageLimits
const tooLarge = w > (limits.maxImageDimension ?? Infinity)
  || h > (limits.maxImageDimension ?? Infinity)
  || w * h > (limits.maxImagePixels ?? Infinity)
  || pngBuf.byteLength > (limits.maxImageBytes ?? 5 * 1024 * 1024)
```

`nativeImage:'full'` 仍保留用户显式选择原图的语义；`auto` 才自动降级。

### P1 — PTC 工具面未验证

Web profile 的 `agent-preset-registry` 配置是 `selectedDefault: ptc`。0.2.2 的 PTC executor 只直接暴露 `run_code`，其他工具通过生成的 SDK 调用。静态看插件工具会进入 `tools.schemas(...)`，但以下点尚未实测：

- `tools.computer_do({action:'call',...})` 在 PTC 嵌套调用中的参数/返回；
- `screen_observe(native)` 的图片结果在 PTC 里作为 deferred context 的表现；
- `computer_task` 在 PTC + subagents 下的行为（仍受 P0 影响）。

建议用临时 web profile + CDP（或修复后的 Web runner）跑一条只读 `run_code` 探针，再加一条 native 图片探针。不要仅凭静态推断宣称 PTC 兼容。

### P2 — `toolFilter` 文案与注释已过时

`lib/task.js` 顶部注释、工具描述、README/ARCHITECTURE 仍写“子 agent 只能使用桌面工具”或“toolFilter 可能被拒”。在 0.2.2：

- `toolFilter` **不存在**，不是“被拒”；
- 子 agent 的工具集由 Agent Preset / 宿主组合决定；
- 插件无法在单次调用里限制。

应改成：“宿主能力相关；支持时尽量限制，不支持时子 agent 与父会话同级，回执如实说明”。

### P2 — 兼容性上限与可选升级

- `package.json` 的 `dsh.compatibility.dsh` 目前只有 `>=0.1.5-rc.2`；建议在 P0/P1 修复并验证 0.2.2 后加 `<0.3.0`，与 peer 依赖上限一致。
- 0.2.2 提供 `timeoutMs`、`deferLoading`、`output.presentationMeta`；不是兼容性必需。若后续要做长动作超时或更丰富的卡片，可按需采用，不要为“用上新 API”而改。

## 4. 真机证据

| 检查 | 结果 |
|---|---|
| headless 插件加载 + dispatcher | 5 步完成 `status` / `screen_observe` / `catalog` / 隐藏 `computer_wait`；2 可见/20 隐藏；`cacheReadTokens` 6528→7296 |
| native 图片链路 | 真实 `screen_observe(mode="native")` 返回截图附件 `screen-11148.png`（sha256…），主模型能看到图 |
| vision 默认配置 | 失败：`deepseek-v4-flash-vision-exp` 未声明 image；GLM 无 key |
| 桌面动作 smoke | 两轮 **7/8**（Round 2 4/4；`wa2` 对时间预算敏感） |
| 离线契约 | 10 套 **231** 断言；schema 22 工具 / 44 场景 |
| S4 oracle | 10/10（含 `x1`） |
| Web runner | dsh 0.2.2 下无效（空会话/步数误读；工具链问题，见 ROADMAP C9） |

## 5. 建议升级顺序

1. **P0**：`computer_task` 双 API 适配（`startActivation` + 旧 `start`）+ 0.2.2-like fake 测试；同步去掉 `toolFilter` 的成功承诺。
2. **P1**：`visionModel` 默认/回退；`nativeImage:auto` 纳入 dimension/pixels。
3. **P1**：PTC 只读探针 + native 图片探针；确认 `run_code` 下的 `computer_do`。
4. **P2**：文档/工具描述/兼容上限；Web runner C9 另列。
5. 全部通过后更新 `VERIFICATION` 与 `CHANGELOG`，再考虑版本号/tag。

## 6. 未覆盖

- 0.2.2 真实 subagents 宿主的 `computer_task` 运行（需要 web/temp profile + 委派服务；静态契约已确认 P0）。
- PTC 真实会话（web 默认 preset 是 `ptc`；本轮未驱动 UI）。
- 0.1.5 与 0.2.2 双版本回归矩阵（当前离线测试只跑当前 devDeps 0.2.2；旧版本行为依赖 peer 范围，未实机复跑）。
- macOS/Linux 的 0.2.2 行为。
