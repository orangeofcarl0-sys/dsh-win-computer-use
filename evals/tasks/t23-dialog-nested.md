# t23 / dialog-nested

- **stages: S3, S4**
- **tier: core**
- **isolation: both**
- **ac2: full**
- **app: winforms**
- **hotspot: native-dialog**
- **requires: powershell**
- tools: screen_observe / computer_click / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t23\`
- oracle: result.json has cancelled>=1, confirmed>=1, archived=true
- 2026-11-21: 第二条 WinForms 对话框任务，覆盖三按钮/嵌套确认；clean 与 dirty 两种模式。

## Prompt

<<<PROMPT
A local window titled `S4-T23-DIALOG` is open. It has an `Archive` button.

1. Click `Archive`; in the first confirmation choose `No` (or `否`).
2. Click `Archive` again; in the first confirmation choose `Yes` (or `是`).
3. In the second confirmation choose `Yes` (or `是`) to finish archiving.

Leave the window open. Do not bypass the dialogs by editing files directly.
If a click does not respond, you may use Tab/Enter/Escape to select dialog buttons.
Always return to the window titled `S4-T23-DIALOG` if another window comes to the foreground.
PROMPT>>>

## Notes

- Setup starts a test-owned PowerShell WinForms app; the app writes outcomes to `out/result.json`.
- `isolation: both`: clean mode uses the task sandbox only; dirty mode also opens a sentinel and checks it in the oracle.
- Cleanup closes owned modals first, then the recorded app window, then the sentinel.
