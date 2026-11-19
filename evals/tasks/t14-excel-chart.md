# t14 / excel-chart

- **stages: S3, S4**
- **tier: core**
- **isolation: dirty**
- **ac2: full**
- tools: screen_observe / computer_activate / computer_wait / computer_clipboard / computer_set_value / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t14\`
- oracle: XLSX XML cell values + native bar chart part; no Office/COM
- 2026-11-16: dirty-desktop Excel data+chart task; user Excel windows are never closed.

## Prompt

<<<PROMPT
The desktop may contain other user Excel windows; never close them.

First `screen_observe` the Excel window opened by setup, then activate it with `computer_activate` (pid + window_id; under dispatcher route it through `computer_do`). Do not use Alt+Tab or the taskbar. Wait 800-1200 ms after activation.

Enter this table on Sheet1:
A1 Month, B1 Sales, C1 Cost, D1 Profit
A2 Jan, B2 12000, C2 7000, D2 5000
A3 Feb, B3 15000, C3 8000, D3 7000
A4 Mar, B4 9000, C4 6000, D4 3000
A5 Apr, B5 18000, C5 10000, D5 8000
A6 May, B6 21000, C6 12000, D6 9000

Use one clipboard paste for the whole block: write this TSV to the clipboard with `computer_clipboard(action="write", text="Month\tSales\tCost\tProfit\nJan\t12000\t7000\t5000\nFeb\t15000\t8000\t7000\nMar\t9000\t6000\t3000\nApr\t18000\t10000\t8000\nMay\t21000\t12000\t9000")`, click cell A1, then click the Home ribbon `Paste` button. Prefer the ribbon Paste button over Ctrl+V. If the result is partial or single-column, rewrite the clipboard and click Paste again; do not type the table cell by cell.

After the table appears, verify A1:D6 once with a native/zoom observation; do not observe after every cell. Then click cell A1 (use `screen_zoom` + `from_zoom=true` if direct coordinates are uncertain), press `Ctrl+Shift+End` to select A1:D6, and press `Alt+F1` to insert a native column chart. Do not use the Name Box, do not `screen_observe(query="名称框")` (a query observe clears the action snapshot), and do not open the Select Data Source dialog. The chart may show Sales/Cost/Profit series; it must use Month (A2:A6) as categories and include the Sales series (B2:B6). Set the chart title to `S4 Sales` (double-click the title, Ctrl+A, type). Save the workbook as `{task_dir}\out\sales.xlsx` (Save As; do not overwrite the seed). If F12 does not open a dialog, use File > Save As > Browse; enter the file name with `computer_set_value`. After the dialog closes, activate Excel again and press Ctrl+S. Do not use command-line/file-copy tools.
PROMPT>>>

## Notes

- Setup copies the Office SHELLNEW blank workbook and opens it; if Excel reuses a user window, setup is ENV and never touches it.
- Oracle parses `sharedStrings.xml`, `sheet1.xml` and `xl/charts/chart1.xml`; no COM.
- 2026-11-17 live r1: 24 cells, native bar chart, title `S4 Sales`, and Sales series all passed; only `Month categories=false` failed because the model inserted the chart without a category range and detoured through 选择数据源. The Name Box and early-Save-As variants both regressed (Go To/name-box handling cost steps; early save led to cell-by-cell typing and a blank output). Final prompt: table-first, click A1 + `Ctrl+Shift+End` (A1:D6) + `Alt+F1`, chart title `S4 Sales`, final Save As; 25-min budget. The oracle now accepts either `catFormula` containing A2 or cached category labels Jan..May. Result: **r1 pass 141 steps**, all checks including `Month categories=true`.
- AC2 simulate is not available for this app-dependent task; verify-oracles reports AC2 SKIP.
