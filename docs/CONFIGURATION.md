# CONFIGURATION — 配置与环境变量

> 目的：28 个配置键、环境变量、优先级、交互与已知陷阱。
> 读者：部署者、集成者、排障者。
> 状态：当前实现（最后核对 2026-11-20；由 `npm run docs:check` 校验键数）。
> 相关：[INSTALL](INSTALL.md) · [TOOLS](TOOLS.md) · [ERRORS](ERRORS.md) · [DRIVER-SDK](DRIVER-SDK.md)。

## 1. 加载与优先级

配置来自 `apply(ctx, config)`，按 dsh 的 patch 层序合成：

```text
插件包 cordis.patch.yml（默认值）
  → profile cordis.patch.yml
  → $DSH_HOME/cordis.patch.yml（install.sh 写这里）
  → --patch <file>（评测/探针 overlay，最高）
```

同一键以后加载的层为准。`apply()` 会把配置归一化成内部 `cfg`；`extremePatterns` 在这一步编译成正则，非法正则会让 `apply` 抛错（插件加载失败）。

## 2. 配置键总表

### 2.1 观察与工具面

| 键 | 类型 | 默认 | 枚举/范围 | 作用 |
|---|---|---|---|---|
| `ttlMs` | number | `60000` | 任意毫秒 | 观察快照有效期；过期动作 `[snapshot_expired]`。过大增加陈旧风险，`0` 会立即过期 |
| `maxElements` | number | `120` | 任意正整数 | 单次观察最多编号元素数；调用级 `maxElements` 可覆盖。过大增加上下文成本 |
| `observeDedup` | string | `summary` | `brief`/`summary`/`off` | 同窗口未变时的降噪：`summary` 带关键控件与编号摘要，`brief` 只回一行，`off` 每次全量 |
| `nativeDialogs` | string | `auto` | `auto`/`off` | Windows 标准 Win32 模态对话框（`#32770`）的原生子控件后端：UIA 树为空时返回原生按钮，点击走 `BM_CLICK`（异步/未验证）；`off` = 零 PowerShell spawn，仅 UIA |
| `surfaceMode` | string | `dispatcher` | `dispatcher`/`hybrid` | 工具面：2 可见/21 隐藏，或 2+5 热工具/16 隐藏。会话内稳定 |
| `verboseReceipts` | boolean | `false` | 只有 `true` 生效 | 动作回执附原始 JSON，排障用 |

### 2.2 动作与投递

| 键 | 类型 | 默认 | 枚举/范围 | 作用 |
|---|---|---|---|---|
| `deliveryMode` | string | `auto` | `background`/`auto`/`foreground` | 后台优先；`auto` 命中 `background_unavailable` 自动前台，必要时 L3 绕锁并恢复原前台 |
| `actionGuard` | string | `on` | `on`/`off` | 同窗口+同目标+同投递模式 5s 内重复且观察未变 → `[repeat_suppressed]`；只作用于 click/right_click |
| `verifyAfterAction` | string | `off` | `off`/`auto` | 实验性：click 家族/key 的 unverifiable/suspected_noop 后抓一次无截图状态，把差分写进回执；每次约 +2s，会刷新快照 token/TTL |
| `supersession` | string | `note` | `off`/`note`/`enforce` | 同快照连击：`note` 附一致性注记，`enforce` 第二次动作拒绝 `[snapshot_consumed]`，`off` 全关 |
| `cursorTheme` | string | `cua.default` | 主题 id | 虚拟光标主题；设置失败回退 `cua.default` |
| `cursorMotion` | string | `auto` | `off`/`auto`/`human` | `auto` 前台最多 1 次移动；`human` 保留 5 段弧线；`off` 不滑行。后台投递始终不滑行 |

### 2.3 委派与安全

| 键 | 类型 | 默认 | 枚举/范围 | 作用 |
|---|---|---|---|---|
| `taskTimeoutMin` | number | `5` | 调用级 1–60 | `computer_task` 默认超时；调用方 `timeout_min` 覆盖 |
| `maxTaskCalls` | number | `3` | 正整数 | 每会话委派次数上限；`0`/非正数仍回退 3 |
| `allowedApps` | string[] | `[]` | 应用名精确匹配 | 只约束操作类工具（click/type/key/scroll/drag/set_value）；空 = 不限制 |
| `passwordScan` | string | `auto` | `auto`/`off` | Windows UIA 结构密码扫描；`off` = 零 spawn，退回启发式 |
| `extremePatterns` | string[] | `[]` | 正则源字符串 | 命中元素标签时附警告注记，**不阻断**；非法正则会在 `apply` 抛错 |

### 2.4 输入回退与驱动

| 键 | 类型 | 默认 | 枚举/范围 | 作用 |
|---|---|---|---|---|
| `xamlKeyFallback` | string | `off` | `off`/`auto` | 实验性：XAML 组合键失败时自动“点菜单栏项 → 点唯一菜单项”；歧义/缺失即停 |
| `xamlPressFallback` | string | `off` | `off`/`auto` | 实验性：`ctrl+a`/`alt+f` 允许一次前台 `press_key`；不含 Alt+Tab |
| `driverProfile` | string | `auto` | `auto`/`legacy`/`latest` | `auto` 按版本推断并自适应；`legacy` 强制旧形态；`latest` 强制新形态。排障/回退用 |
| `dragEngine` | string | `auto` | `auto`/`private` | `auto` 驱动 ≥0.39 且探测可用走原生 modifier drag；`private` 强制私有 helper；`dwell_ms` 始终私有 |

### 2.5 视觉与诊断

| 键 | 类型 | 默认 | 枚举/范围 | 作用 |
|---|---|---|---|---|
| `nativeImage` | string | `auto` | `auto`/`full`/`compact` | `auto` 超附件限额回退 ax/vision；`full` 始终原图；`compact` 当前驱动必然报错（不能整窗缩放） |
| `visionProvider` | string | `deepseek-official` | provider id | `vision` 观察者 provider |
| `visionModel` | string | `deepseek-flash` | 模型 id | `vision` 观察者模型；必须声明 image 输入 |
| `trajectoryFile` | string | `''` | 文件路径 | 非空时写 CU 轨迹 JSONL；`DSH_CU_TRAJECTORY_FILE` 可覆盖。开启后插件会写本地文件 |

### 2.6 实验性后台输入

| 键 | 类型 | 默认 | 枚举/范围 | 作用 |
|---|---|---|---|---|
| `backgroundInput` | string | `off` | `off`/`auto` | B0：快照没有可交互 UIA 元素时，click 走 `WM_*`/`BM_CLICK`，plain key/text 走 `WM_KEY*`/`WM_CHAR`；不移动光标/前台，未验证 |
| `syntheticPointer` | string | `off` | `off`/`auto` | B1：对无 UIA 的 pointer/触控目标注入合成触控左单击；不移动光标/前台；遮挡失败关闭；需要 `allowedApps` 非空 |
| `anchoredInput` | string | `off` | `off`/`cursor`/`window` | B2/B3：`cursor` 临时移光标 + `BlockInput`；`window` 临时移窗口。只左单击；需要 `allowedApps` 非空；会动光标/窗口 |

三键全 `off` 时零 PowerShell spawn，行为与 0.5.8 一致。B1/B2/B3 只对“没有可交互 UIA 元素”的快照生效；有 Button/Edit/MenuItem 等仍走 driver/UIA。组合键/modifier/`foreground=true`/`deliveryMode=foreground`/`from_zoom` 一律跳过本功能。详见 [BACKGROUND-INPUT](BACKGROUND-INPUT.md)。

## 3. 环境变量

| 变量 | 默认 | 作用 | 优先级 |
|---|---|---|---|
| `CUA_DRIVER_BIN` | — | 显式指定 `cua-driver` 路径 | 高于 PATH/常见路径 |
| `CUA_DRIVER_VERSION` | — | 覆盖版本探测（离线测试/排障） | 高于 `--version` |
| `CUA_DRIVER_PROFILE` | — | 覆盖兼容档 `auto/legacy/latest` | **低于**配置 `driverProfile` |
| `CUA_CALL_TIMEOUT_MS` | `30000` | 单次驱动调用超时（最小 1000） | — |
| `CUA_SESSION` | `dsh-win-computer-use` | 驱动会话 id；element_token/zoom 快照按 session 归属 | — |
| `DSH_CU_TRAJECTORY_FILE` | — | 轨迹 JSONL 路径 | **高于**配置 `trajectoryFile` |
| `DSH_POWERSHELL` | `powershell.exe` | 指定 PowerShell 可执行文件 | — |
| `S4_TEMP` / `DSH_TEMP` | 用户 TEMP | 私有拖拽 `Add-Type` 编译临时目录；`S4_TEMP` 是历史命名，保留兼容 | — |
| `ZHIPU_API_KEY` / `GLM_API_KEY` | — | GLM 视觉兜底；未配置则该路径停用 | — |
| `GLM_API_BASE` | 智谱官方端点 | GLM 端点 | — |
| `GLM_VISION_MODEL` | `glm-4.6v-flash` | GLM 首选模型 | — |

不读取任何密钥文件；key 只从环境变量读取，不写入日志/回执。

## 4. 交互矩阵

| 组合 | 行为 |
|---|---|
| `supersession: enforce` × `verifyAfterAction: auto` | 复核会刷新快照并换新 token，但 `markConsumed` 仍在；同一快照的下一步可能 `[snapshot_consumed]`。A/B 用默认 `note` |
| `xamlKeyFallback: auto` × `xamlPressFallback: auto` | `ctrl+a` 仍菜单优先，菜单不可用才 press；`alt+f` 直接 press。想让 press 优先可把 `xamlKeyFallback` 设为 `off` |
| `nativeImage: auto` × 模型 image 能力 | 当前 route 不声明 image：`native` 直接拒绝；`screen_zoom` 也不可用。`vision` 可作替代 |
| `driverProfile: legacy` × `dragEngine: auto` | legacy 清空现代能力标志，drag modifier 默认走私有 helper |
| `dragEngine: private` × `from_zoom` | 私有拖拽不支持 `from_zoom`，明确报 `[private_drag_zoom_unsupported]` |
| `allowedApps` × 观察/启动 | 只约束操作类工具；`screen_observe`/`app_list`/`app_launch` 不受限 |
| `nativeDialogs: auto` × 标准 MessageBox | 空 AX + 同 pid `#32770` modal → `native-dialog` 按钮；点击走 `BM_CLICK`（异步/未验证）；触发模态的 UIA click 仍可能 30s |
| `nativeDialogs: off` × 模态 | 不 spawn Win32 对话框 helper；UIA 树为 0 时回到原有 30s/桌面降级路径 |
| `backgroundInput: auto` × 有可交互 UIA | 不接管；继续 driver/UIA。只有快照没有 Button/Edit/MenuItem 等可交互角色时才走插件消息通道 |
| `syntheticPointer: auto` × `allowedApps: []` | 不接管（B1/B2/B3 的强制安全闸）；B0 不受此限制 |
| `anchoredInput: cursor/window` × 脏桌面 | 光标/窗口被外部改动时失败关闭（`background_input_cursor_changed` / 还原失败），不抢回用户改动 |
| `backgroundInput: auto` × 组合键/modifier/foreground | 一律跳过插件通道；组合键继续前台，modifier 继续前台 |
| `passwordScan: off` × `computer_type` | 结构位扫描关闭，只剩角色/标签/掩码启发式；经典 Win32 `ES_PASSWORD` 可能漏标 |

## 5. 示例

### 5.1 最小（默认）

```yaml
- id: dsh-win-computer-use
  name: dsh-win-computer-use
  config:
    surfaceMode: dispatcher
    ttlMs: 60000
    maxElements: 120
    deliveryMode: auto
```

### 5.2 `hybrid` 工具面

```yaml
- id: dsh-win-computer-use
  name: dsh-win-computer-use
  config:
    surfaceMode: hybrid      # 2 + click/type/key/scroll/verify 直接可见
    ttlMs: 60000
    maxElements: 120
```

### 5.3 排障/回退

```yaml
- id: dsh-win-computer-use
  name: dsh-win-computer-use
  config:
    driverProfile: legacy    # 不发 tree_format；modifier drag 走私有
    dragEngine: private      # 原生 modifier 异常时
    deliveryMode: foreground # 目标必须真实前台时（更慢）
    observeDedup: off        # 怀疑降噪掩藏变化时
    verboseReceipts: true    # 看原始回执
```

### 5.4 评测/诊断

```yaml
- id: dsh-win-computer-use
  name: dsh-win-computer-use
  config:
    surfaceMode: dispatcher
    observeDedup: off        # 避免降噪影响逐轮对比
    passwordScan: off        # 离线/无 PowerShell 环境零 spawn
    trajectoryFile: <path>/run.trajectory.jsonl
```

## 6. 已知陷阱

1. **`nativeImage: compact` 当前必然失败**：驱动 zoom 不能整窗缩放（宽 ≤500px）。需要整窗图用 `full`，或改 ax/vision/`screen_zoom`。
2. **`maxTaskCalls: 0` 不禁用委派**：非正数回退 3。
3. **`taskTimeoutMin` 有两层默认**：schema 默认 5；若 `cfg` 缺失，`task.js` 内部回退 10。正常 `apply` 不会走到 10。
4. **`ttlMs` 不做上限**：设得过大不会报错，但界面变化后旧快照仍可用，风险由调用方承担。
5. **`trajectoryFile` 会写本地文件**：`PERMISSIONS.md` 的“无文件写入”指默认路径；开启轨迹是显式 opt-in。
6. **`extremePatterns` 非法正则会让 `apply` 失败**：整棵插件树不加载；先在本地验证正则。
7. **`verboseReceipts` 只有严格 `true` 才生效**：字符串 `"true"` 不算。
8. **`cursorTheme` 失败静默回退**：回执/状态里可能只看到 `cua.default`；自定义主题先用 `cua-driver cursor-theme` 安装。
9. **`actionGuard` 不拦 `double_click`**：双击有明确语义；重复抑制只覆盖 click/right_click。
10. **`verifyAfterAction` 会延长 TTL**：复核刷新 `at`；长流程中可能让快照“看起来没过期”，但界面可能已经变了。
11. **`allowedApps` 是精确匹配 `appName`**：不是标题子串；别名不生效。
12. **`driverProfile: latest` 不保证驱动真的支持**：它强制新请求形态；不支持时由错误学习/回执暴露。
13. **`backgroundInput` 不是“所有后台通道”总开关**：它只覆盖 B0；B1/B2/B3 由 `syntheticPointer`/`anchoredInput` 单独控制。
14. **B0 文本/按键是同步 `SendMessageTimeout`**：目标窗口过程卡住时每个字符最多等 1s；鼠标仍是异步 `PostMessage`。超时/未知不要重复输入。

## 7. 配置变更检查

改配置键时：

1. 更新 `index.js` 的 `Config` 与 `apply()` 归一化；
2. 更新本文件、`tests/docs.facts.json` 的 `configKeys`；
3. 在 `tests/config.plumbing.mjs` 补 schema ↔ `cfg` ↔ 读取点三向断言；
4. 跑 `npm test; echo $?`、`npm run check`；
5. 有真机时跑 `node verify-runtime.mjs`。
