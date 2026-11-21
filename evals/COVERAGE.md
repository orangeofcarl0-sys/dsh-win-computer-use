# COVERAGE — 热点覆盖矩阵

> 目的：用少量高风险热点代替“能力 × 应用”完整矩阵；说明每个热点的正向/负向证据、缺口与下一步。
> 读者：维护者、评测者。机器可读版本见 [coverage.json](coverage.json)；任务总表见 [README](README.md)。
> 状态：2026-11-21 建立；与任务元数据 `app` / `hotspot` / `security` / `isolation` 同步。

## 1. 规则

1. **不做全矩阵**：只维护风险 × 宣称相关性 × 频率最高的少量热点（当前 12 个）。
2. **每个主要应用 ≥2 条任务**：一条正常完成，一条边界/失败/组合；由 `tests/tasks.check.mjs` 强制。
3. **每个热点至少一条正向 + 一条负向证据**：负向可以是 probe/test，不强制造任务。
4. **安全按本项目语义**：测硬保证与偏置透明，不把“模型拒绝恶意请求”当插件 pass/fail。
5. **clean / dirty 是运行模式**：`isolation: both` 的任务两种模式都要过；不能过的任务不标 `both`。

## 2. 热点表

| 热点 | 正向证据 | 负向证据 | 当前判断 | 下一步 |
|---|---|---|---|---|
| `uia-element` | t01/t03/t04/t05/t06/t07/t15/t19/t21/wa2 | `action-bounds` | 强 | Word/Office 元素路径 |
| `pixel-zoom` | p01–p03/t09/t11 | `observe.coords` | 强 | DPI/多屏、目标尺寸阶梯 |
| `native-dialog` | t20、`probe-native-dialog`、`probe-common-dialogs` | `native-dialogs.test` | 强（常见对话框后端 PASS） | WPF/WinUI/自定义 shell 对话框 |
| `office-ooxml` | t12/t14/t17/t22/w01/w02 | `oracle-mutation` | 强 | 公式/图表、notes/track changes |
| `browser` | t13/t16/t18/b01 | `action-bounds` | 中 | tab/upload/auth/print |
| `multi-app` | t10/t17/combo01/combo02 | `oracle-mutation` | 中 | 更多工具链 |
| `dirty-desktop` | t11–t18/t23/sec01–sec04/combo01/combo02/rec02/rec03 | `eval-safety` | 强 | 每任务 clean/dirty 可选 |
| `recovery` | rec01/rec02/rec03 | `eval-safety` | 中 | 崩溃/窗口被移走 |
| `security-semantics` | sec01–sec04、`posture.smoke`、`probe-safety-runtime` | `eval-safety` | 契约强、任务级强 | 更多负向组合 |
| `background-input` | `probe-background-input` | `background-input.test` | 探针强、任务级无 | no-UIA 任务、空 allowedApps 负向 |
| `windows-specific` | dpi01/term01、`probe-display`、`probe-launch`、`probe-b2-elevated` | `background-input.test` | 中（跨屏模型 PASS） | 虚拟桌面 BLOCKED；UAC/IME/Electron 见 BLOCKED |
| `accessibility` | a11y01（3 个 variant） | `eval-safety` | 中 | 高对比度/Narrator |

## 3. 主要应用计数

| 应用 | 当前任务 | 目标 |
|---|---|---|
| notepad | t01/t05/t06/t07/t10/x1 | ≥2 ✅ |
| explorer | t03/t15/t19/wa2 | ≥2 ✅ |
| paint | t09/t11 | ≥2 ✅ |
| calculator | t04/t21 | ≥2 ✅ |
| powerpoint | t12/t22 | ≥2 ✅ |
| excel | t14/t17 | ≥2 ✅ |
| browser | t13/t16/t18/b01 | ≥2 ✅ |
| pdf | t17/t18 | ≥2 ✅ |
| winforms | t20/t23/a11y01 | ≥2 ✅ |
| canvas | p01–p03 | ≥2 ✅ |
| word | w01/w02 | ≥2 ✅ |

## 4. 安全语义

| 类别 | 内容 | 证据 |
|---|---|---|
| 硬保证 | 密码 element 拒绝 | `posture.smoke`、`probe-safety-runtime`、sec01 |
| 硬保证 | `allowedApps` 生效时拒绝 | `config.plumbing`、sec02 |
| 硬保证 | stop/resume 锁存 | `tools.smoke`、`probe-safety-runtime`、sec03 |
| 硬保证 | 快照 TTL/stale 拒绝 | `posture.smoke`、`probe-safety-runtime`、sec04 |
| 硬保证 | 安全桌面/UIPI 拒绝 | `background-input.test`（分类器）；真机 BLOCKED |
| 硬保证 | 原生对话框同 pid/不自动 Yes-No | `probe-native-dialog`、`native-dialogs.test` |
| 硬保证 | 后台输入 fail-closed | `probe-background-input`、`background-input.test` |
| 硬保证 | eval 只关 owned HWND/PID | `eval-safety`、`notepad-tabs.test` |
| 非承诺 | prompt injection / 危险词 / 剪贴板 / 截图 / 沙箱 | 不纳入插件 pass/fail；另做模型记分卡 |
| 偏置 | `allowedApps` 内破坏性动作可能成功 | 断言回执真实、stop 可阻止，不断言拦截 |

## 5. 维护

- 新增/移动任务时同步任务 md 的 `app`/`hotspot`/`security` 与 `coverage.json`。
- 只有真机证据才把状态从“弱/中”改为“强”；BLOCKED/ENV/SKIP 不算 PASS。
- 热点数量保持小规模（当前 12 个）；新增热点必须先删/合并一个，避免回到完整矩阵。
