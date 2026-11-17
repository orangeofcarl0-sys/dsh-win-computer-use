# t17 / pdf-excerpt

- group: authored
- **tier: core**
- **isolation: dirty**
- **ac2: none**
- tools: screen_observe / screen_zoom / computer_click / computer_key / computer_type
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t17\`
- oracle: XLSX A1 exact excerpt text
- 2026-11-16: high-risk dirty-desktop PDF locate+copy task; user browser/Excel windows are never closed.

## Prompt

<<<PROMPT
The desktop may contain other user browser/Excel windows; never close them.

A browser window titled `s4-t17-doc` is open to a 3-page PDF. On page 3, find the complete sentence starting with `S4-T17:` (it is the only such sentence).

First activate the browser and make sure page 3 is visible. Select the sentence by triple-clicking it (`computer_click(..., count=3)`), then press Ctrl+C. Do not use Ctrl+A (it selects the whole PDF). If triple-click selects only one word, drag from the sentence start to its end, then Ctrl+C.

Switch to the Excel window opened by setup. Use Save As to save the workbook as `{task_dir}\out\excerpt.xlsx` before pasting (do not overwrite the seed). Click cell A1, paste with Ctrl+V, and press Ctrl+S. A1 must contain the complete sentence exactly, with no extra line breaks or workbook title.

Do not type the sentence manually if it is already selectable; do not use command-line/file-copy tools.
PROMPT>>>

## Notes

- Setup generates a local 3-page PDF with Edge/Chrome headless print-to-pdf and opens it in a new browser window; cleanup closes only that HWND.
- Excel output is parsed as XLSX XML; no COM.
- This task is intentionally high-risk because browser PDF text selection/clipboard behavior varies; run it 3 times before promoting it to smoke.
- 2026-11-17 prompt: triple-click the sentence (count=3) and Ctrl+C, with drag fallback; Ctrl+A is forbidden. Excel saves As `out\excerpt.xlsx` before pasting, then Ctrl+S. The sentence is one line on page 3, so triple-click/paragraph selection captures it without the rest of the PDF.
- 2026-11-17 live: **2/2 pass, 89/63 steps**; A1 exact both times. The model copied from a test PDF tab it opened in the user's Firefox (Chrome setup window also present); cleanup closed the Chrome viewer. After the run, the test Firefox tab was closed with Ctrl+W **only while it was the selected tab**, leaving the user's other 7 tabs intact. Do not close the Firefox window/process.
- AC2 simulate is not available for this app-dependent task; verify-oracles reports AC2 SKIP.
