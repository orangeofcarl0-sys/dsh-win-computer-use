# rec01 / draft-recovery

- **stages: S3**
- **tier: core**
- **isolation: clean**
- **ac2: full**
- **app: notepad**
- **hotspot: recovery**
- **requires: notepad**
- tools: screen_observe / app_launch / computer_type / computer_key / computer_activate
- sandbox: `%USERPROFILE%\.dsh\s4-evals\rec01\`
- oracle: `final.txt` 同时包含 draft 句与恢复句
- 2026-11-21: 恢复类任务：应用未打开，从已有 draft 重新打开并保存最终稿。

## Prompt

<<<PROMPT
The task folder is `{task_dir}`. It contains `draft.txt` with an unfinished draft.

1. Open `draft.txt` in Notepad.
2. Add a new line at the end with exactly this text: `S4 REC01 RECOVERED`
3. Save the document as `final.txt` in the same task folder.
4. Leave Notepad open.

Do not use command-line file writing; use the graphical editor.
PROMPT>>>

## Notes

- Setup only writes `draft.txt`; the app is intentionally closed, so the task tests reopening/recovering from an existing artifact.
- Oracle reads `final.txt`; draft content must be retained.
- Cleanup closes only test-owned Notepad tabs via `Close-OrphanTestNotepads` with explicit allowed tabs.
