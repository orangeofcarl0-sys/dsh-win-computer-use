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

A browser window titled `s4-t17-doc` is open to a 3-page PDF. On page 3, find the complete sentence starting with `S4-T17:` (it is the only such sentence). Copy the full sentence, switch to the Excel window opened by setup, paste it into cell A1, and save the workbook as `{task_dir}\out\excerpt.xlsx`.

Do not type the sentence manually if it is already selectable; do not use command-line/file-copy tools.
PROMPT>>>

## Notes

- Setup generates a local 3-page PDF with Edge/Chrome headless print-to-pdf and opens it in a new browser window; cleanup closes only that HWND.
- Excel output is parsed as XLSX XML; no COM.
- This task is intentionally high-risk because browser PDF text selection/clipboard behavior varies; run it 3 times before promoting it to smoke.
- AC2 simulate is not available for this app-dependent task; verify-oracles reports AC2 SKIP.
