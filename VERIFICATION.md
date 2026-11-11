# VERIFICATION — 验证报告

> 目的：把“声称支持”变成可复现的证据。本文按**当前矩阵 → 历史证据 → 代表性缺陷 → 未验证项 → 复现方式**组织。
> 代码快照：`main` @ 2026-11-10（`0.5.7-dev`）。最近完整运行环境：Windows 11 x64 · DPI 150% · cua-driver 0.23.2 · dsh 0.2.2-rc.1。2026-11-12 追加 dsh headless 真机加载证据（§2.1）。
> 测试方法见 [docs/TESTING.md](docs/TESTING.md)；Windows 专项见 [docs/WINDOWS.md](docs/WINDOWS.md)。

## 1. 当前验证矩阵

| 验证面 | 结果 | 平台 | 证据 |
|---|---|---|---|
| 离线测试 | **10 套 / 231 ✅ / 0 ❌** | Windows（跨平台 Node 可跑） | `npm test; echo $?` |
| 语法/安装脚本 | **16/16 JS + 2 个 bash -n** | Windows | `npm run check` |
| 真驱动运行时 | **16/16** | Windows 11 / cua-driver 0.23.2 | `node verify-runtime.mjs` |
| 真桌面动作闭环 | **23/23**（2026-09-17 重设计后） | Windows 11 | `node tests/live-action.e2e.mjs 3` |
| S4 oracle 双向验证 | **10/10** | Windows 11 | `node evals/verify-oracles.mjs` |
| 打包面 | **31 文件**（新增 docs/WINDOWS、docs/TESTING） | — | `npm pack --dry-run` |
| 真机 headless 加载 | **✅ 2026-11-12**（5 步；2 可见/20 隐藏；真实 `screen_observe`；dispatcher 路由 `computer_wait`） | Windows / dsh 0.2.2-rc.1 | 见 §2.1 |
| npm / 部署 | **未发布 / web profile 仍旧版** | — | 见 [PUBLISH.md](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) |

### 1.1 安全承诺矩阵

| 承诺 | Windows | macOS | Linux | 验证载体 |
|---|---|---|---|---|
| 凭据硬保护（密码框拒自动输入） | ✅ 结构位（UIA sidecar `IsPassword` ∨ `ES_PASSWORD`）+ 启发式降级 | ✅ AX 结构化角色（0.1–0.2 时期） | 未验证 | `posture.smoke` G/H 系列 + A6 探针 |
| 极危注记（不阻断） | ✅ | ✅ | ✅ 离线 | `posture.smoke` |
| `allowedApps` 白名单 | ✅ | ✅ 离线 | ✅ 离线 | `posture.smoke` / `config.plumbing` |
| 快照 TTL / 无快照拒绝 | ✅ | ✅ 离线 | ✅ 离线 | `posture.smoke` / `action-bounds` |
| 三级投递链 + 恢复原前台 | ✅ 真机 | 仅离线覆盖 | 仅离线覆盖 | `delivery-chain.smoke`（真实 `cuaDeliver`） |
| 强杀锁存（stop/resume） | ✅ 离线 | ✅ 离线 | ✅ 离线 | `tools.smoke` / `dispatcher.test` |
| `unknown ≠ 成功` | ✅ | ✅ 离线 | ✅ 离线 | `tools.smoke` / `schema.conformance` |
| 结构密码扫描 | ✅ 真机 9/9 | 不适用 | 不适用 | A6 探针 + `posture.smoke` |
| WinUI3 输入通道 | ✅ 已定性（hotkey 不可达，改点控件） | 不适用 | 不适用 | 受控窗口实验 + #3908 |
| 像素点击落点 | ⚠️ best-effort（A7） | 未标定 | 未标定 | 六轮实验，见 ROADMAP A7 |

### 1.2 提示缓存 A/B（真实渠道）

2026-11-09，opencode / deepseek-v4.1-flash，重复请求同一前缀：

| 工具面 | 结果 |
|---|---|
| `dispatcher` 稳定 tools | 重复 **99.5%**；首次 tool_call 后 **92.1%**；第二次后 **85.4%** |
| 旧 `dynamic` / lazy search 工具层变化 | 首击 **0%–18%**（+1 工具 0%，+4 工具 17.7%） |

结论：**tools 列表必须稳定**。这是 `dispatcher` 成为默认、`dynamic` 被删除的直接依据。测试脚本在仓库外，key 只从本地配置读取、未打印。

### 1.3 模型可发现性（同渠道）

在不执行真实桌面动作的前提下，验证模型能否正确生成 dispatcher 调用：

- `computer_click` / `computer_type`（带观察上下文）、`computer_key`、`computer_verify`（带 `expect` 示例）、`computer_clipboard`、`computer_task`、`catalog`：均能生成 `computer_do({action:'call',...})`。
- 无上下文时倾向先 `screen_observe`；`scroll` 与“无示例的 verify”需要多一轮或更大 `max_tokens`。
- 结论：复杂参数建议先 `catalog`，必要时在 system prompt 给一个示例。

## 2. 历史证据

### 2.1 2026-11-12 — dsh 0.2.2-rc.1 headless 真机加载

隔离 patch 启用 `credentials` + 本插件，模型走 dsh 默认 `deepseek-official/deepseek-flash`，只做只读调用：

```bash
dsh --profile headless --patch "<工作区>/_probe-win-cu-deepseek.yml" \
  --permission-mode read-only --approval-policy never \
  "只做只读验证：status / screen_observe / catalog / 隐藏 computer_wait"
```

| 检查 | 结果 |
|---|---|
| 会话 | `session-e1d8a603-9225-4755-b1ad-78f766dbf42e`，1 轮 5 步，`turn_end: completed` |
| 插件加载 | `computer_do(action="status")` → “当前：dispatcher 模式（直接可见：computer_do, screen_observe；隐藏 20 个）” |
| 真实观察 | `screen_observe()` → `Arknights.exe · 明日方舟`，pid 47912 / window 14354214，4 个元素，快照 `s0000001f` |
| catalog | 20 个隐藏工具签名；`screen_zoom`、`computer_click`、`double_click`、`right_click` 等 |
| 隐藏路由 | `computer_do({action:"call",tool:"computer_wait",args:{ms:50}})` → `[computer_wait] 已等待 50ms。` |
| prompt cache | 每步 `cacheReadTokens`：6528 → 6656 → 6912 → 7296；tools 列表全程稳定 |
| 安全边界 | 只读 observe + 纯等待；未调用 bash/文件工具，未点击/输入 |

环境说明：

- headless profile **默认禁用 `credentials`**（`id: credentials disabled: true`）；探针 patch 显式启用后，才能解析 `~/.dsh/.credentials.yaml` 的 provider key。默认 headless 配置下 `MISSING_CREDENTIAL` 不是插件加载错误。
- 本机 `OPENCODE_GO_API_KEY` 已过期（401 `api_key_expired`），因此本次使用默认 DeepSeek 通道；这不影响插件证据。
- 探针 patch 在仓库外（`_probe-win-cu-deepseek.yml`），未入库。

### 2.2 2026-11-09/10 — P0/P1 安全边界、dispatcher、更名（0.5.7-dev）

| 项 | 结果 |
|---|---|
| 离线 | 10 套 **231** 断言；新增 `action-bounds`、`dispatcher.test`、`package-manifest`；`delivery-chain` 改为直接执行真实 `cuaDeliver` |
| 语法 | 16/16 JS + `bash -n` |
| 运行时 | `verify-runtime` **16/16**（dispatcher 2 可见 / catalog 20 / 隐藏 click 无快照拒绝 / native 图片落盘 / zoom 图片透传 / 坐标字段） |
| 打包 | 31 文件；更名后包名 `dsh-win-computer-use` |
| P0 修复 | `type`/`key` 不再盲发 desktop；`scroll`/`drag` 透传 `window_id`；`suspected_noop` 终态失败；指定窗口未匹配 fail-closed；观察降噪完整指纹 |
| 工具面 | `dispatcher` 默认（2 可见/20 隐藏）；`hybrid` 可选（7/15）；`dynamic` 删除 |
| 缓存 | 见 §1.2 |

### 2.3 2026-09-17 — 结构治理与发布前复跑（0.5.4/0.5.6）

| 项 | 结果 |
|---|---|
| 离线 | 7 套 **148** 断言；schema 20 个工具 / 42 个场景；config.plumbing 25 |
| 真桌面 | `live-action.e2e` **23/23**（重设计：唯一命名临时文件 + 标题匹配，不杀进程） |
| parity | observe/zoom 29 场景 `{value,render}` 逐字节一致；20 工具工具面 JSON 逐字节一致 |
| S4 oracle | `verify-oracles` **10/10**（首次 t04 因遗留计算器窗口失败，清理后通过——环境态问题，非退归） |
| 发现并修复 | `scroll`/`drag` 把结构化拒绝当成功；`runAction`/`dedupInvalidate`/`taskCallCount` 死代码；schema 覆盖 13/20 → 20/20 |
| 发布 | v0.5.6 注解 tag；`main` 单分支 |

### 2.4 2026-09-16 — dsh 0.1.5 适配、坐标契约、上下文预算

| 项 | 结果 |
|---|---|
| 离线 | 4 套 **74** 断言；19 个工具 / 22 个场景 |
| 真桌面 | `live-action.e2e` 3 轮 **30/30**（旧版设计） |
| 坐标标定 | 可控探针逐点最小二乘 **残差 ≤0.55px**：`computer_click(x,y)` = 窗口矩形相对物理像素；observe 元素坐标已换算到同一空间；截图 == `list_windows.bounds` 1:1 |
| 输入通道 | 经典 Win32（regedit `ctrl+f`）**3/3**；WinUI3（记事本）`hotkey` **5/5 失败**（UIA 加速器 4s 超时，上游 #3908） |
| 驱动完整性 | `cua-driver.exe` 清单 `requireAdministrator` → daemon 与 `app_launch` 子进程 High IL；非提权客户端清不掉（#3607） |
| S4 | 9 任务 + AC2 双向验证 **9/9**（连跑 3 次一致）；冒烟 t07 pass |
| 客户端适配 | 严格输出校验、composer `Input.insertText`、页脚格式、新会话视图钉住 |

### 2.5 2026-09-06/07 — A6/A7、快照新鲜度、原生视觉

| 项 | 结果 |
|---|---|
| A6 密码窗口 | **9/9**：结构标记注记 / guard 硬拒 / 普通框零误拒 / sidecar 时延 1.4–1.6s / zoom crop 元数据；发现并修复标记坐标系错误 |
| 快照新鲜度 | **4/4**：快照 id / 首写 confirmed+readback / 同快照二写一致性注记 / 密码框硬拒 |
| A7 坐标语义 | 六轮实验：驱动 0.23.2 文档契约与实测矛盾，三种语义假设均有反例 → 插件层定性 best-effort；element 路径可靠 |
| dsv4fv 通道 | ax ✓；native ✓（attachments 端到端，首 token 0.9s / 116 tok/s / 缓存 74%）；vision 观察者半通（只出思考），GLM 无 key 优雅降级 |
| 上游反馈 | #3576（密码投影）、#3586（树版本/条件请求）、#3587（干预信号）已提 |

### 2.6 2026-08-25 — 原生视觉接入

`verify-runtime` **12/12**：12 工具注册（新增 `screen_zoom`）；`screen_observe(ax)` 真实树；native text-only 拒绝；native image route PNG（1.06MB）attachments 落盘 + `{type:"image"}` 内容块；zoom 区域 JPEG；vision 降级链；坐标语义；安全回归；结构化拒绝透传。

### 2.7 2026-08-15 — macOS 初始验证

cua-driver headless / MCP 链路 / dsh-mcp-client 桥接；11 工具注册；备忘录“打开→点击→输入”闭环；TTL/白名单/危险词/密码保护；home 级 patch 安装与 HMR 热生效。此阶段的安全姿态（危险词审批）已在 0.4.0 删除，相关结论仅作历史。

## 3. 代表性缺陷与守门测试

| # | 缺陷 | 根因 | 守门 |
|---|---|---|---|
| 1 | 插件整棵树加载失败 | P1-7 重构丢了 `defineTool()` 返回值；原始字面量被 `assertSupportedJsonSchema` 拒 | 真机 headless 探针（离线假注册表无校验） |
| 2 | 所有工具调用报 `reading 'kind'` | 订阅了 `tools/post-execute` waterfall 却不调 `next()` | 真机探针 + 约定：只订阅 `tools/result` |
| 3 | 观测降级整次 `invalid output` | 降级回执字段未在 output schema 声明（dsh 严格校验） | `schema.conformance` 降级场景 |
| 4 | 结构化拒绝被当成功 | `{refusal:{code}}` / `effect:refused` 分散判断，menu/scroll/drag 各漏一次 | `lib/receipt.js` 单一出口 + schema 拒绝场景 |
| 5 | 坐标点击整体偏移 | 元素 frame 是屏幕 px，点击是窗口截图 px，差一个窗口原点 | 坐标标定 + observe 输出换算 |
| 6 | Windows 密码框保护静默失效 | guard 只匹配 macOS `AXSecureTextField`；Windows UIA 角色不同且无密码位 | `roles.js` 跨平台三态 + sidecar 结构位 |
| 7 | 结构密码标记标错相邻元素 | 旧假设“元素中心=窗口本地+原点换算”，实际 frame/sidecar 都是屏幕 px | A6 端到端 + 屏幕坐标直配 |
| 8 | `type`/`key` 盲发到当前前台 | 无 element/无快照时退回 `scope:'desktop'` | `action-bounds` P0-1/2 |
| 9 | `suspected_noop` 报成功 | `engineRefusal` 未识别该 effect | `action-bounds` P0-4 + `receipt` |
| 10 | 指定窗口未匹配却观察最前窗口 | 静默回退 | `action-bounds` P0-5 |
| 11 | 观察降噪误判“未变” | 旧哈希只看 label（label 非空时 value 不参与） | `observe.dedup` 值/enabled/selected/actions 变化 |
| 12 | 投递链测试测的是复刻 | 测试替换了整个 `lib/cua.js` | `delivery-chain` 直接执行真实函数 + `opts.call` |

## 4. 未验证 / 未完成

| 项 | 状态 | 原因/影响 | 下一步 |
|---|---|---|---|
| 部署 | 旧版 | web profile 仍是旧名 `dsh-computer-use` v0.5.3 | 按 [PUBLISH.md](https://github.com/orangeofcarl0-sys/dsh-win-computer-use/blob/main/PUBLISH.md) 重新安装并重启 |
| npm 发布 | 未做 | 包名 `dsh-win-computer-use` 可用，账号已登录 | `npm publish --access public`（需用户明确授权） |
| macOS 近期回归 | 未做 | 近期测试都在 Windows；macOS 证据多为 0.1–0.2 时期 | 有 macOS 环境时跑离线 + verify-runtime |
| Linux | 未验证 | 桌面环境/accessibility 栈差异大 | 不在当前承诺范围 |
| 像素点击 A7 | best-effort | 驱动 0.23.2 混合 DPI 落点缺陷；插件层不可判定 | 等上游；element 路径优先 |
| WinUI3 hotkey/menu | 不可达 | UIA 加速器 4s 超时（#3908）；`invoke_menu` 可能不可用 | 改点控件；上游跟踪 |
| `app_launch` 清理 | 需人工 | 子进程 High IL，非提权侧 UIPI 拒绝关闭 | 任务产出接受人工收尾 |
| 委派工具约束 | 宿主相关 | `toolFilter` 只认全局工具名；默认 dispatcher 下很可能被拒 | 插件如实降级；严格限制用宿主机制 |
| `computer_task` 工具面 | 真实但有限 | 默认超时 5 分钟、每会话 3 次；子 agent 可能拥有父级能力 | 见 README“委派的能力边界” |

## 5. 复现方式

```bash
npm install
npm run check; echo "check=$?"
npm test; echo "test=$?"
node verify-runtime.mjs
node tests/live-action.e2e.mjs 3
node evals/verify-oracles.mjs
npm pack --dry-run

# dsh 0.2.2-rc.1 真机加载（隔离 patch 需启用 credentials；headless 默认关闭）
dsh --profile headless --patch "<工作区>/_probe-win-cu-deepseek.yml" \
  --permission-mode read-only --approval-policy never \
  "调用 computer_do(action='status')，把返回原文贴出来"
```

判据：

- `npm test` 退出码 0，且最后每套都打印“全部通过”；
- `verify-runtime` 的 `结果：16/16 通过`；
- `live-action` 的 `23/23`（会打开临时记事本窗口；不杀进程，残留标签人工关闭）；
- `verify-oracles` 的 `10/10`；
- `npm pack --dry-run` 的 total files = 31；
- headless 探针的 `status` 返回 `dispatcher` / 2 可见 / 20 隐藏（本次实测见 §2.1）。

## 6. 证据约定

- **真值/实验产物不进仓库**：`evals/report-last.json`、`dsv4fv-exp/`、工作区 `_*.mjs` 探针均不入库；仓库只进可复现脚本与文档。
- **测量驱动**：被数据否决的方案要记录（SoM、双原点、坐标三假设、动态工具面）；不要凭直觉复活。
- **平台分列**：安全承诺按平台实测；`unverified` 不写成 `supported`。
- **失败也记录**：超时、环境态失败、驱动缺陷都写进报告；修复后保留根因与守门测试。
