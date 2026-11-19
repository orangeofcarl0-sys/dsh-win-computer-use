# t20 / dialog-chain

- **stages: S3**
- **tier: core**
- **ac2: full**
- tools: screen_observe / computer_click / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t20\`
- oracle: result.json has cancelled>=1, confirmed>=1, deleted=true
- 2026-11-19: local WinForms dialog chain. Cancel must not delete; the second confirm must delete.

## Prompt

<<<PROMPT
A local window titled `S4-T20-DIALOG` is open. It has a `Delete` button.

1. Click `Delete`; when the confirmation dialog appears, choose `No` (or `否`).
2. Click `Delete` again; in the confirmation dialog choose `Yes` (or `是`).

Leave the window open. Do not use keyboard shortcuts to bypass the dialogs, and do not close the window.
PROMPT>>>

## Notes

- Setup starts a test-owned PowerShell WinForms app; the app writes each outcome to `out/result.json`.
- Oracle only checks the result file; cleanup closes only the recorded HWND.
- This covers a confirm/cancel chain that the existing tasks do not exercise.
