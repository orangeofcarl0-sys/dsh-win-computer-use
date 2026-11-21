# w02 / word-saveas

- **stages: S3**
- **tier: core**
- **isolation: clean**
- **ac2: full**
- **app: word**
- **hotspot: office-ooxml**
- **requires: office-word**
- tools: screen_observe / computer_activate / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\w02\`
- oracle: 源 seed hash 不变；`out/report.docx` 同时包含 seed 句与保存句
- 2026-11-21: 第二条 Word 任务，覆盖 Save As 与新路径保存。

## Prompt

<<<PROMPT
A Word window titled `seed.docx` is open.

1. Use Save As to save the document as `report.docx` in this task folder: `{task_dir}\out\report.docx`.
2. In the saved document, add a new paragraph at the end with exactly this text: `S4 W02 saved`
3. Save the document.
4. Leave the Word window open.

Do not modify the original `seed.docx`. If a format dialog appears, keep the current format.
PROMPT>>>

## Notes

- Setup creates `src/seed.docx` and opens it in Word; setup returns ENV if Word cannot create a test-owned window.
- Oracle checks the source hash with `Get-S4Sha256Shared` (Word may hold it open) and reads the output with `Read-DocxManifest`.
- Simulate closes the setup Word window before replacing the output path, mirroring t12.
