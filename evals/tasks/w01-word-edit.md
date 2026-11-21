# w01 / word-edit

- **stages: S3**
- **tier: core**
- **isolation: clean**
- **ac2: full**
- **app: word**
- **hotspot: office-ooxml**
- **requires: office-word**
- tools: screen_observe / computer_activate / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\w01\`
- oracle: DOCX 文本同时包含原始句与追加句，seed hash 改变
- 2026-11-21: 首个 Word 任务，覆盖文档编辑与原地保存。

## Prompt

<<<PROMPT
A Word window titled `report.docx` is open.

1. Add a new paragraph at the end of the document with exactly this text: `S4 W01 edited`
2. Save the document in place.
3. Leave the Word window open.

Do not close Word. If a save dialog appears, keep the current format.
PROMPT>>>

## Notes

- Setup creates a minimal DOCX and opens it in Word; if Word rejects the seed or cannot create a test-owned window, setup returns ENV.
- Oracle reads `word/document.xml`; it does not use COM or model self-evaluation.
- `Read-DocxManifest` is shared with w02 and future Word tasks.
