# t14 / excel-chart

- group: authored
- **tier: core**
- **isolation: dirty**
- **ac2: none**
- tools: screen_observe / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t14\`
- oracle: XLSX XML cell values + native bar chart part; no Office/COM
- 2026-11-16: dirty-desktop Excel data+chart task; user Excel windows are never closed.

## Prompt

<<<PROMPT
The desktop may contain other user Excel windows; never close them.

In the Excel window opened by setup, enter this table on Sheet1:

A1 Month, B1 Sales, C1 Cost, D1 Profit
A2 Jan, B2 12000, C2 7000, D2 5000
A3 Feb, B3 15000, C3 8000, D3 7000
A4 Mar, B4 9000, C4 6000, D4 3000
A5 Apr, B5 18000, C5 10000, D5 8000
A6 May, B6 21000, C6 12000, D6 9000

Insert a native column chart of Sales by Month on Sheet1 with the title `S4 Sales`. Save the workbook as `{task_dir}\out\sales.xlsx`. Do not use command-line/file-copy tools.
PROMPT>>>

## Notes

- Setup copies the Office SHELLNEW blank workbook and opens it; if Excel reuses a user window, setup is ENV and never touches it.
- Oracle parses `sharedStrings.xml`, `sheet1.xml` and `xl/charts/chart1.xml`; no COM.
- AC2 simulate is not available for this app-dependent task; verify-oracles reports AC2 SKIP.
