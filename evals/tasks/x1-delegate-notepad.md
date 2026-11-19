# x1 · delegate-notepad（委派通道集成验证）

- **stages: S3**
- **tier: core**
- **require_tool: computer_task**
- 用途：验证 `computer_task` 子 agent 委派通道端到端可用（PLAN-context-budget F 的真机补验）。
- oracle: 目标文件存在 + 内容逐字匹配（与 t01 同判定，但**执行路径由子 agent 完成**）
- sandbox: `%USERPROFILE%\.dsh\s4-evals\x1\`

## Prompt

<<<PROMPT
请把一行文字保存为文本文件：

HELLO-DELEG

保存位置：{task_dir}\target\deleg.txt
必须通过 computer_task 委派给子 agent 完成；不要自己操作桌面，也不要自己写文件。
PROMPT>>>

## 备注

- 该任务**必须走委派**：runner 的 `require_tool: computer_task` 会检查调用记录；直接自己保存即使文件正确也判 fail。
- oracle 仍只看文件终态；委派路径由 runner 的调用记录判定（兼容 dispatcher 的 `computer_do:computer_task`）。
- 若走委派：主上下文应只出现一条 ≤400 字符回执；子 agent 的观察/动作留在它自己的会话里（可在会话列表看到 parentSession 指向本次主会话）。
