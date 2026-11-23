# FAQ — 常见问题与易混概念

> 目的：把使用者/评测者最容易踩的坑与二义概念集中回答；细节链接到对应文档，不在本页复制长文。
> 读者：使用者、评测者、新维护者。
> 状态：当前实现（最后核对 2026-11-23）。
> 相关：[TOOLS](TOOLS.md) · [WINDOWS](WINDOWS.md) · [TROUBLESHOOTING](TROUBLESHOOTING.md) · [ERRORS](ERRORS.md) · [README](../README.md)。

## 1. 启动应用为什么不要用 Win+R？

本机 Win+R 打开的是 Command Palette（`Microsoft.CmdPal.UI`），AX 树为空且拒绝前台激活/文本投递；`win` 组合键已 **fail-closed**（明确返回“不支持”，不再静默降级为单键 `win`）。启动应用用 `app_launch` 或开始菜单。见 [WINDOWS](WINDOWS.md) §3。

## 2. 预填字段（如“另存为”文件名）怎么填？

优先 `computer_set_value(element=..., value=完整内容)` **覆盖**；`computer_type` 是追加语义，会把新文本接在旧值后面。`ctrl+a` 在 WinUI 对话框/无菜单栏窗口可能不可用。见 [TOOLS](TOOLS.md) §4.3/§4.4。

## 3. Explorer 文件项单击后为什么打开了文件？

后台坐标点击会优先走 UIA hit-test/Invoke；在文件项上 Invoke 等于“打开”，还可能连锁打开 Photos/PDF。单选文件传 `foreground=true`；多选 Ctrl+click 因 `modifier` 已自动前台。见 [WINDOWS](WINDOWS.md) §5。

## 4. 坐标为什么点偏了？预览图能用来量坐标吗？

`@(x,y)` 与 `computer_click(x,y)` 是窗口截图**原图像素**；宿主预览可能缩放显示，不能按预览尺寸估坐标。精确像素任务用 `screen_zoom` + `from_zoom=true`。见 [WINDOWS](WINDOWS.md) §5。

## 5. 第一次 `screen_observe` 失败怎么办？

确认图形会话里有可见普通窗口（headless 环境不适合桌面动作）；脚本会跳过 `0×0` shell 弹窗与驱动自身窗口；指定 `window` 未匹配时回执带候选，用 `window_id` 重选。驱动未运行先看 [TROUBLESHOOTING](TROUBLESHOOTING.md) §2。

## 6. `ok:true` 就代表动作生效了吗？

不。`effect:unverifiable` 表示“已送达但未确认”，必须 `screen_observe`/`computer_verify` 复核；`ok:true` 只说明“没有拒绝/未送达”。回执文本是模型唯一可靠的状态证据。见 [ERRORS](ERRORS.md) §1。

## 7. 模态对话框把动作卡住 30s 怎么办？

模态打开期间该进程 UIA provider 不服务跨进程请求，驱动动作会阻塞到模态关闭。先等待 5–10s 再 observe 确认是否“延迟成功”；标准 `#32770` 对话框按钮由 `nativeDialogs:auto` 兜底（`BM_CLICK`）。不要连续重试/换键/activate。完整指引见 [WINDOWS](WINDOWS.md) §6.1。

## 8. `computer_activate` 和 `foreground=true` 什么时候用？

`computer_activate` 把已存在窗口前置，不启动/关闭应用也不恢复原前台；脏桌面多窗口切换优先用它（不要点任务栏/反复 Alt+Tab）。`foreground=true` 是单次动作的强制前台投递，更慢且移动指针，只在需要真实焦点时用。见 [TOOLS](TOOLS.md) §4.11 与 §7。

## 9. “S4” 到底指什么？`S4_TEMP` 是 S4 阶段的东西吗？

S1-S4 是**评测任务阶段**（S4 = Dirty 能力任务集）；`S4_TEMP`/`S4_POWERSHELL`/`~/.dsh/s4-evals/`/`S4 Bar` 等 `S4_*` 是 0.5.4 时代冻结的兼容名，与现在的 S4 阶段无关。见 [README](README.md) §6.1。

## 10. “后台投递”和“后台输入”是一回事吗？

不是两层同一个东西。**后台投递（L1）**是驱动/消息投递层的不抢焦点通道（UIA Invoke、PostMessage），默认投递链的一部分；**后台输入（B0-B3）**是插件侧对“没有可交互 UIA 元素”目标的实验消息/触控/锚定通道，默认 off。见 [WINDOWS](WINDOWS.md) §2 与 [BACKGROUND-INPUT](BACKGROUND-INPUT.md) §1。

## 11. `app_launch` 启动的窗口为什么可能关不掉？

子进程完整性级别取决于驱动版本与启动路径（0.52.13 实测 daemon High、PowerShell 子进程 Medium）；非提权客户端可能关不掉 High IL 子窗口（UIPI）。优先操作已在运行的普通应用；残留提示用户手动关闭，**不要按进程名杀**。见 [WINDOWS](WINDOWS.md) §1。

## 12. 密码框是怎么保护的？坐标输入也保护吗？

唯一的内容级硬拒绝是密码框**自动输入**（`computer_type`/`computer_set_value`，element 模式，Windows 用结构位 sidecar 识别）。坐标输入无法预知目标，保护不生效——这是明确的能力边界，不是缺陷。见 [SECURITY](SECURITY.md) §4。
