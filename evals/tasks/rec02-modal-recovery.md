# rec02 / modal-recovery

- **stages: S3, S4**
- **tier: core**
- **isolation: both**
- **ac2: full**
- **app: winforms**
- **hotspot: recovery**
- **requires: powershell**
- tools: screen_observe / computer_click / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\rec02\`
- oracle: result.json 有 dismissed>=1、finished=true；dirty 模式 sentinel 不变
- 2026-11-21: 操作中插入模态，关闭后继续完成任务。

## Prompt

<<<PROMPT
A local window titled `S4-REC02-MODAL` is open.

1. Click `Start`. A confirmation dialog appears; choose `No` (or `否`) to dismiss it.
2. After the dialog closes, click `Finish`.

Leave the window open. If a click does not respond, you may use Tab/Enter/Escape on the dialog.
PROMPT>>>

## Notes

- The modal is a test-owned WinForms MessageBox; the app writes outcomes to `out/result.json`.
- Cleanup closes owned modals first, then the app window, then the sentinel.
- The oracle requires both the dismissed modal and the post-dialog finish action.
