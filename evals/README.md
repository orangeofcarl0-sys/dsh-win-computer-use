# S4 评测手册（evals/）

> 目的：定义 S4 任务集、oracle 契约、runner、verdict 语义与 dirty 规则；逐轮运行结果见 [docs/EVIDENCE.md](../docs/EVIDENCE.md)。
> 读者：维护者/评测者。`evals/` **不进入 npm 发布包**。
> 状态：内部开发手册（最后核对 2026-11-18）。
> 相关：[TESTING](../docs/TESTING.md) · [TRAJECTORY-ANALYSIS](../docs/TRAJECTORY-ANALYSIS.md) · [WINDOWS](../docs/WINDOWS.md)。

## 1. 任务集

共 **17 条**：冒烟 4 + 核心 6 + dirty 7。任务定义在 `tasks/*.md`，统一结构：

```text
# tXX · name
- **group**: smoke|core|dirty
- **tier**: ...
- **isolation**: notepad|dirty
- **ac2**: full|none
- **oracle**: ...
## Prompt
<<<PROMPT
...
PROMPT>>>
## Notes
```

| id | 任务 | 组 | isolation | AC2 | 备注 |
|---|---|---|---|---|---|
| t01 | Notepad 输入两行并原地保存 | smoke | notepad | full | 唯一命名 seed |
| t03 | Explorer 就地重命名 | core | notepad | full | |
| t04 | Calculator 多步乘法 | smoke | notepad | full | UIA 断言 |
| t05 | Notepad 另存为 + ANSI 编码 | core | notepad | full | Save As 语义 |
| t06 | 剪贴板粘贴保存 | core | notepad | full | |
| t07 | 窗口最大化并保持 | smoke | notepad | full | |
| t09 | Paint 填充纯红并保存 | core | notepad | full | 不杀 mspaint |
| t10 | 两 Notepad 文档内容互换 | core | notepad | full | 双文件 state |
| t11 | Paint 鼠绘复刻 | dirty | dirty | full | PNG ROI mask |
| t12 | PPT 16:9 布局复刻 | dirty | dirty | none | PPTX XML，无 COM |
| t13 | 论文下载 + SHA-256 | dirty | dirty | none | 用户 Downloads 只删新增匹配 PDF |
| t14 | Excel 表格 + 原生柱状图 | dirty | dirty | none | XLSX XML + chart |
| t15 | Explorer 8 文件整理 | dirty | dirty | full | 文件系统终态 |
| t16 | 本地浏览器表单 | dirty | dirty | full | result.json |
| t17 | PDF 句子摘录到 Excel | dirty | dirty | none | A1 精确文本 |
| wa2 | 设文件隐藏（WAA 本地化） | smoke | notepad | full | 时间预算敏感 |
| x1 | 委派通道集成验证 | core | notepad | full | `computer_task` |

退役任务与理由见 git 历史；当前基线只用上表。

## 2. 目录约定

```text
evals/
  tasks/            17 个任务 md（id = 文件名前缀）
  setup/            17 个 setup.ps1
  oracle/           17 个 oracle.ps1
  cleanup/          17 个 cleanup.ps1
  simulate/         13 个 simulate.ps1（ac2:none 的任务缺省）
  lib/              common.ps1 / tabstate.ps1 / image.ps1 / office.ps1 / form-server.mjs / cdp.mjs
  headless-run.mjs  当前 runner
  verify-oracles.mjs  AC2 双向验证
  analyze-trajectory.mjs / analyze-sessions.mjs / ab-summary.mjs
  probe-*.mjs       真机探针（不加入 npm test）
  headless-patch.yml / headless-patch.opencode.yml / headless-patch-xamlfallback.yml
  headless-runs/    运行产物（gitignore）
  verify-runs/      验证产物（gitignore）
```

- 任务沙箱：`%USERPROFILE%\.dsh\s4-evals\<taskId>\`。
- `run.mjs` 是 dsh 0.1.5 时代的 Web runner，已退役；默认拒绝运行并指向 `headless-run.mjs`。`--dry-setup` 仍可用于只跑 setup/oracle/cleanup 链。
- runner 从 `~/.dsh/profiles/web/node_modules/dsh-win-computer-use/package.json` 读插件版本；web profile 仍旧版时 `pluginVersion` 会缺失/过期。

## 3. 环境知识

1. **TEMP**：若 `TEMP=C:\Windows\TEMP`，PowerShell `Add-Type` 可能报“未能找到源文件 …*.cs”；跑 eval 前把 `TEMP`/`TMP` 指到 `%LOCALAPPDATA%\Temp`。
2. **Notepad TabState**：Win11 Notepad 会从 `TabState/*.bin` 恢复会话；**新 HWND 不等于干净窗口**。runner 在非 dirty 任务前 `tabstate.ps1 backup`，每个任务前清 eval bin，全部任务后 `restore`。
3. **用户窗口**：已有 Notepad/Paint/Office/浏览器窗口不关；只关 setup 记录的测试 HWND/标签；证明不了就 `leftover + dirty`。
4. **浏览器**：t13/t16/t17 复用用户会话；`--new-window` 后要求新 HWND；只关该 HWND；t13 只删任务开始后新增且 SHA-256 匹配的 PDF；绝不关 Firefox 进程/窗口。
5. **PowerPoint/Excel 单实例**：只关 setup 记录的测试 HWND；oracle 只读 OOXML ZIP/XML，不实例化 COM；禁止 `Quit`/`Presentations.Close` 全部。
6. **Paint 11 标签页**：要求测试 seed 的唯一 HWND/标签；只能并入用户窗口时 setup 记 ENV 或 cleanup dirty。

## 4. 模型通道

- 基线 overlay `headless-patch.yml`：启用 `credentials`，模型 `deepseek-official/deepseek-flash`。
- opencode overlay `headless-patch.opencode.yml`：`llm-pi-ai` provider `opencode-go`、模型 `deepseek-v4.1-flash`、1M context / 128K output / text+image；必须带请求头 `x-opencode-session`（dsh 0.2.2 的 provider 要求；缺失会 400 `MissingSessionID`）。
- key 只从 `~/.dsh/.credentials.yaml` 读取；不要写进仓库、不要打印。
- dsh 0.2.2 不支持 seed/top_p；重复测试只能按统计分布解读，不能做严格 A/B 因果。

## 5. 运行语义

```text
cleanup -> setup -> dsh --profile headless --patch <overlay> --json -> oracle -> cleanup
```

- `setup` 预置到决策点；`oracle` 判定；`cleanup` 清沙箱；`simulate` 用于 AC2 双向验证。
- oracle 契约：**exit 0 = pass，1 = fail，2 = environment error**；stdout 一行 JSON。
- cleanup `dirty`：pass 改记为 `dirty`，汇总 `dirty=N`，进程退出非 0；不再把“留窗/残留对话框”当干净通过。
- setup ENV（应用缺失/网络不可达/浏览器不能新开窗）：`verdict=env`，不混入 pass/fail。
- `ac2: none` 的任务在 `verify-oracles` 显示 **SKIP**（setup/oracle-empty/cleanup 通过，无 simulate）；**SKIP ≠ PASS**。
- timeout 不跑 oracle；cleanup 在 `finally` 里执行。
- `--json` stdout 是截断视图；完整复盘用 session 文件或 trajectory JSONL。

## 6. 运行命令

```bash
node evals/headless-run.mjs --tier smoke --timeout-min 10
node evals/headless-run.mjs --tasks t01 --repeats 3 --timeout-min 10
node evals/headless-run.mjs --tier all --timeout-min 10
node evals/headless-run.mjs --tasks t11,t12 --repeats 1 --timeout-min 35 \
  --patch evals/headless-patch.opencode.yml
node evals/verify-oracles.mjs
node evals/verify-oracles.mjs --tasks t11,t12,t15,t14,t17
node evals/analyze-trajectory.mjs <file> --json
node evals/ab-summary.mjs --dir evals/headless-runs/ab --tasks t01,t05
```

- `DSH_BIN` 可覆盖 dsh entry；`TEMP/TMP` 自动归一化。
- report 带 `patchPath/patchSha256/wallMs/innerSteps`；trajectory 路径记录在 report。
- 历史运行结果不在本文件维护，统一追加到 [docs/EVIDENCE.md](../docs/EVIDENCE.md)。

## 7. Report schema（摘要）

| 字段 | 含义 |
|---|---|
| `task` / `repeat` / `verdict` | 任务、轮次、pass/fail/timeout/error/env/dirty |
| `innerSteps` / `wallMs` | dsh 内部步数、墙钟 |
| `toolCalls` / `toolErrors` / `unverified` | 工具调用、错误、未验证 |
| `patchPath` / `patchSha256` | 使用的 overlay 与哈希 |
| `trajectory` | JSONL 路径（gitignored） |
| `oracle` | oracle stdout JSON / 失败原因 |
| `cleanup.dirty` / `leftovers` | 是否留窗/残留 |

## 8. 新增任务

1. 在 `tasks/` 加 md（元数据 + `<<<PROMPT` 块）；
2. 在 `setup/`、`oracle/`、`cleanup/` 加 PowerShell；需要 AC2 时加 `simulate/`；
3. oracle 必须确定性读（文件系统/OOXML/UIA/像素），不用模型自评；
4. `isolation: dirty` 的任务要记录测试 HWND/pid/start/title，cleanup 只关证明归属的对象；
5. 跑 `node evals/verify-oracles.mjs --tasks <id>` 双向验证；
6. 更新本文件的任务表与 [docs/TESTING.md](../docs/TESTING.md)；
7. 不提交 report/trajectory/截图。

## 9. 基线政策

- **pass 不等于稳定**：t11/t12/t14/t15/t17 仍有方差；单次 pass 只作为样本。
- 基线比较必须同 overlay、同模型、同预算、同桌面状态；跨 provider 不是受控 A/B。
- 失败样本保留：环境态、模型策略、插件缺陷分开归因；修复后保留根因与守门测试。
- 不把 `dirty`、`SKIP`、`env` 计入 pass。

## 10. WAA 溯源与许可

`wa2-hide-file` 源自 Microsoft WindowsAgentArena（MIT）。任务 md 保留 `source: microsoft/WindowsAgentArena, MIT` 与本地化说明；其余任务为本仓库自有。引用的第三方任务不改变本仓库 MIT 许可。
