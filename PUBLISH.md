# PUBLISH — 发布与部署手册

> 适用：维护者。**push / tag / npm publish / 部署切换只在用户明确说“发布”时执行**；本地提交自主。
> 当前状态（2026-11-10）：`v0.5.6` 已发布（tag 指向 `68770fd`）；`main` 含 `0.5.7-dev` 未发布变更（文档提交以 `git log -1` 为准）；npm 未发布；web profile 仍是旧名 `dsh-computer-use` 的 v0.5.3。

## 1. 当前状态

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/orangeofcarl0-sys/dsh-win-computer-use`（public，MIT） |
| 默认分支 | `main`（单分支；旧 `v0.3` 已合并/删除） |
| 最新发布 tag | `v0.5.6` → `68770fd`（注解 tag） |
| `main` HEAD | `c29e019` + 本次文档提交（以 `git log -1` 为准） |
| `package.json` version | `0.5.6`（发布 0.5.7 时才 bump） |
| npm | 未发布；名称 `dsh-win-computer-use` 可用 |
| 部署 | web profile 仍是旧名 `dsh-computer-use` 的 v0.5.3 拷贝；0.5.5 副本保留为 `dsh-computer-use.0.5.5-kept` |
| 派生 | 由 [988hj7tczd-oss/dsh-computer-use](https://github.com/988hj7tczd-oss/dsh-computer-use) @ `07477f4`（MIT）派生，独立维护 |

## 2. 版本口径

| 项 | 约定 |
|---|---|
| 版本号 | `package.json` / `package-lock.json` 的 `version` = tag 名去掉 `v` |
| CHANGELOG | 顶部为当前版本一节；未发布时写“0.5.7 (未发布)” |
| tag | **注解 tag**：`git tag -a v0.5.7 -m "..."` |
| 分支 | 只推 `main`；不再维护发布分支 |
| 发布物 | 提交 + 注解 tag；不是工作区 |
| 授权 | push/tag/npm/部署只在用户明说“发布”时执行 |

## 3. 发布前检查（逐项跑，看退出码）

```bash
# 0. 工作树必须干净（发布物 = 提交，不是工作区）
git status --short

# 1. 语法 + 安装脚本
npm run check; echo "check=$?"

# 2. 离线测试（10 套 / 230 断言；&& 串联，必须看 $?）
npm test; echo "test=$?"

# 3. 真驱动运行时（只读观察；16/16）
node verify-runtime.mjs

# 4. 真桌面动作闭环（23/23；会打开临时记事本，残留标签人工关闭）
node tests/live-action.e2e.mjs 3

# 5. S4 oracle 双向验证（10/10）
node evals/verify-oracles.mjs

# 6. 打包面（32 文件；确认没有 node_modules/.dsh-test/tests）
npm pack --dry-run

# 7. 真机加载（必做；唯一能发现“整棵插件树加载失败”的检查）
#    headless 默认禁用 credentials；用探针 patch 显式启用 + insert 插件。
#    2026-11-12 实测：默认 DeepSeek 通道，1 轮 5 步，2 可见/20 隐藏。
dsh --profile headless --patch "<工作区>/_probe-win-cu-deepseek.yml" \
  --permission-mode read-only --approval-policy never \
  "调用 computer_do(action='status')，把返回原文贴出来"

# 8. 文档一致性（版本/工具数/配置键三处对齐）
grep -n '"version"' package.json package-lock.json
grep -rn "230\|22 个工具\|20 个隐藏\|surfaceMode" README.md docs/TESTING.md VERIFICATION.md
```

历史上真正抓出过问题的检查：

- **schema 严格校验**：抓过输出 schema 缺口、结构化拒绝误报成功；
- **真机 live e2e**：抓过 Windows 前台锁与 XAML 输入通道；
- **真机 headless 探针**：抓过 `defineTool` 投影丢失导致整棵树加载失败；
- **退出码**：只 grep 输出会把“某套中途崩溃、前面全绿”误判为通过（实际踩过）。

## 4. 发布步骤

```bash
# 1. 版本号与 CHANGELOG（0.5.6 -> 0.5.7；package-lock 同步）
#    手动编辑 package.json / package-lock.json / CHANGELOG.md

# 2. 收尾提交（中文一句话：版本 + 主题）
git add -A
git commit -m "0.5.7 文档体系重写 + P0/P1 边界 + dispatcher 默认 + Windows-first 更名"

# 3. 注解 tag（标题即发布说明首行）
git tag -a v0.5.7 -m "0.5.7：Windows-first 更名 + dispatcher 默认 + P0/P1 安全边界 + 文档体系重写"

# 4. 推送 main 与 tag
git push origin main
git push origin v0.5.7

# 5. 复核
git ls-remote --tags origin | grep v0.5.7
git log --oneline -1
```

不要：

- 不要推 `v0.3`（分支已不存在）；
- 不要在未 bump 版本时打 tag；
- 不要用 `--force` 推 `main`。

## 5. 发布后

| 项 | 命令/动作 |
|---|---|
| GitHub Release | 可选；tag 已含说明 |
| npm | `npm publish --access public`（需 2FA/token；见 §7） |
| 部署 | 按 §6 重新安装/链接并重启 |
| 公告 | 更新 README 版本徽章/状态段、GitHub description/topics |
| 复核 | `npm view dsh-win-computer-use version`；`dsh --profile web --dump-config` |

## 6. 部署到 web profile

**现状**：web profile 跑的是**拷贝**，不是指向仓库的链接；发布 tag 不会自动进入用户 harness。切换必须重新安装/链接并重启。

```bash
# 1. 备份当前目录（不要直接覆盖旧版；保留回滚能力）
#    当前旧名：~/.dsh/profiles/web/node_modules/dsh-computer-use
#    新名：    ~/.dsh/profiles/web/node_modules/dsh-win-computer-use

# 2. 用新名安装（推荐 install.sh；Windows/Linux 先设 DSH_HOME）
DSH_HOME=/path/to/dsh-home ./install.sh

# 3. 确认合成配置含新插件
dsh --profile web --dump-config | grep dsh-win-computer-use

# 4. 重启 harness（token 会轮换）
~/.dsh/restart-dsh-capture.ps1

# 5. 会话内冒烟
#    computer_do(action="status") -> dispatcher / 2 可见 / 20 隐藏
#    screen_observe(window="Notepad") -> 编号树
```

注意：

- `install.sh` 会写 home 级 `cordis.patch.yml`；如果已有同名块会跳过（幂等）。改配置请直接编辑 profile/home patch。
- 不要在未确认旧目录内容时 `rm -rf`；先重命名保留回滚。
- 旧版 `dsh-computer-use` 与新版可并存于 node_modules，但 profile 配置只能启用一个 id。
- 部署后若工具未出现：先查 `--dump-config` 与宿主日志；不要先怀疑模型。

## 7. npm 发布（待做）

> dsh-market 优先走 npm tarball；`dsh plugin add <包名>` 从 npm 解析。当前**未发布**。

```bash
npm pack --dry-run              # 先看 32 文件清单
npm login                       # 已登录账号 jerryweizhihao（按实际）
npm publish --access public     # 需要 2FA/token
npm view dsh-win-computer-use version
```

发布后：

```bash
dsh plugin --profile web add dsh-win-computer-use
```

`package.json` 已声明 `files`（index.js / lib / tools / cordis.patch.yml / README / VERIFICATION / PERMISSIONS / docs / assets / verify-runtime.mjs）；不要加入 tests、node_modules、`.dsh-test`。

## 8. awesome-dsh-plugin 收录（待做）

1. Fork [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)；
2. 在 `README.md` 与 `README.zh.md` 的合适分类各加一行（候选 `Tools & Capabilities` / 新增 `Computer Use`）：

```markdown
- [orangeofcarl0-sys/dsh-win-computer-use](https://github.com/orangeofcarl0-sys/dsh-win-computer-use) — Windows-first 桌面操作插件：AX/UIA 编号树 + 原生截图直读，后台优先三级投递链，凭据硬保护
```

3. 提交 PR（仓库已有 `dsh-plugin` topic）。

## 9. 回滚

- **代码**：切回上一个 tag（`git checkout v0.5.6 -- .` 不推荐；用干净 clone 或 `git revert`），重新打 tag 需用户授权。
- **部署**：把 profile 的 `node_modules/dsh-win-computer-use` 指回备份目录，重启 harness。
- **npm**：`npm unpublish` 有 72 小时/依赖限制；优先发 patch 版本，不要删版本。
- **数据**：插件不写用户文件、不建数据库，回滚无需数据迁移。

## 10. 发布记录

| 版本 | 日期 | 提交 | 主题 |
|---|---|---|---|
| v0.5.6 | 2026-09-17 | `68770fd` | 委派能力降级修复（toolFilter/scoped restrict/三级阶梯）+ 文档修正 |
| v0.5.5 | 2026-09-17 | — | 动态工具面（已废弃） |
| v0.5.4 | 2026-09-17 | — | dsh 0.1.5 适配、坐标契约、观察降噪、上下文预算、S4 |
| v0.5.3 | 2026-09-06 | — | 结构密码检测、快照新鲜度、S3a |
| v0.5.2 | 2026-09-06 | — | Windows 凭据保护 |
| v0.5.1 | 2026-09-06 | — | 结构重构 |
| v0.5.0 | 2026-09-06 | — | 工具改进包（12→19） |

> 历史 tag 均为注解 tag；更早版本见 `git tag`。
