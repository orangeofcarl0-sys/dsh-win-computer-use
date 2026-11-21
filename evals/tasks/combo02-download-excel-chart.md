# combo02 / download-excel-chart

- **stages: S3, S4**
- **tier: core**
- **isolation: dirty**
- **ac2: full**
- **app: browser,excel**
- **hotspot: multi-app**
- **requires: browser,office-excel,node**
- tools: screen_observe / computer_activate / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\combo02\`
- oracle: Downloads 新增 sales CSV hash 匹配；XLSX A1:D6 + 原生柱状图；sentinel 不变
- 2026-11-21: 经典两应用链：本地浏览器下载 CSV → Excel 导入 → 柱状图。

## Prompt

<<<PROMPT
A local browser page titled `S4-COMBO02-DOWNLOAD` is open, and Excel has `sales.xlsx`.

1. Download `sales.csv` from the local page.
2. Open/import the downloaded CSV into `sales.xlsx` so columns A-D contain Month, Sales, Cost, Profit and rows Jan-May exactly.
3. Create a native bar chart titled `S4 Sales` using the Sales series.
4. Save `sales.xlsx` and leave it open.

Do not close the browser or Excel. The CSV is local (127.0.0.1).
PROMPT>>>

## Notes

- Setup starts a local `download-csv` server and opens Chrome/Edge; cleanup removes only a new CSV whose SHA-256 matches the fixture.
- Oracle reuses t14's XLSX expectations (A1:D6 + native bar chart) and checks the downloaded CSV hash.
- Simulate closes the setup Excel/server/browser and copies `t14-sales.xlsx` plus the CSV fixture into Downloads.
