# t01 · notepad-save

- **stages: S1**
- **tier: smoke**（冒烟组：日常回归必跑）
- **app: notepad**
- **hotspot: uia-element**
- **requires: notepad**
- tools: screen_observe / computer_type / computer_key / computer_verify
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t01\`
- oracle: 目标文件存在 + 内容逐字匹配（CRLF 归一）
- 2026-11-15：改为**原地保存**（setup 预开空 `target\note.txt`）。原因：Win11 Save As 文件名框在驱动 UIA/type 路径下返回 confirmed 但值不变，Ctrl+A 前台被锁，旧另存为/覆盖确认对话框叠层，导致 t01 三次复跑不稳定。Save As 覆盖保留在 t05。

## Prompt

<<<PROMPT
当前已打开一个空白记事本窗口（文件 note.txt）。请把下面两行文字原样输入进去（不要增删、修改任何字符）：

S4-T01 line one.
S4-T01 line two.

输入完成后必须执行保存：用“文件”→“保存”菜单（或工具栏的保存按钮）保存到当前 note.txt；只输入不保存不算完成。
请在一次 `computer_type` 中把两行完整文本（包含换行）输入进去；不要分两次输入，也不要在两行之间按回车。
保存结果以文件内容为准（由 oracle 校验）。UIA 文本输入可能不会让标题出现 `*`，标题无星号不代表没保存；不要为了制造星号使用空格、退格、重复输入或查找替换，也不要因此重输正文。
不要使用“另存为”，不要修改文件名，不要新建窗口。
第二行输入完后不要再按回车，也不要添加空格或额外字符。
PROMPT>>>

## 驱动层限制（2026-09-16 实测，upstream trycua/cua#3908）

- WinUI3 目标（Win11 记事本）上驱动的 `hotkey` 通道稳定失败（UIA 加速器扫描 4s 超时），`press_key` 静默不达，`invoke_menu` 报 menu_path_unavailable。
- 因此本任务的**保存/粘贴动作需走界面控件**（点击菜单项/工具栏或使用剪贴板工具后输入）——oracle 只看终态，不限定路径；runner 的统一约束已要求 agent 在路径不可用时改用等效控件。
- 对照：经典 Win32 目标（如注册表编辑器）上 hotkey 正常 3/3，说明这是目标类型特异性问题，非本机输入栈故障。

## 优化记录

- **2026-09-09 预置**：setup 负责启动空白记事本（原来由 agent 启动）。
- **2026-11-15 原地保存**：setup 直接预开空 `target\note.txt`，prompt 改为输入后用“文件→保存”保存到当前文件；不再走 Save As。原因见上：Win11 Save As 文件名框在驱动 UIA/type 路径下会返回 confirmed 但值不变，Ctrl+A 前台被锁，旧另存为/覆盖确认对话框会叠层；Save As 覆盖由 t05 保留。
- **2026-11-16 星号证据修正**：旧题面把“标题 `*note.txt` → `note.txt`”当作保存成功证据；WinUI UIA 文本注入不置脏，星号可能永远不出现（真机慢跑因此用 SPACE/BACKSPACE 制造又消除星号）。改为以 oracle 文件内容为准，并明确禁止为制造星号修改正文。
- **2026-11-16 单次输入约束**：真机 r5 模型把两行拆成两次 `computer_type` 并在中间按 Enter（delivery_failed 但实际插入换行），随后在编辑菜单里点“全选”结束、未保存。题面明确“在一次 computer_type 中包含换行输入两行，不要分两次/行间按回车”，减少该策略分支。
- **保留**：文字输入、保存、内容判定的完整闭环；oracle 未改。
