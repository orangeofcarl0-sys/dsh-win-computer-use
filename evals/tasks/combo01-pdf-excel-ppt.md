# combo01 / pdf-excel-ppt

- **stages: S3, S4**
- **tier: core**
- **isolation: dirty**
- **ac2: full**
- **app: pdf,excel,powerpoint**
- **hotspot: multi-app**
- **requires: office-excel,office-powerpoint,browser**
- tools: screen_observe / computer_activate / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\combo01\`
- oracle: Excel A1 == 42；PPT 文本包含 `S4 COMBO1 DONE`；PDF 未变
- 2026-11-21: 经典三应用链 PDF → Excel → PowerPoint。

## Prompt

<<<PROMPT
A PDF titled `s4-combo1-doc.pdf` is open. It says: `S4 COMBO1: TOTAL 42`.

1. In the Excel window `data.xlsx`, put the number `42` in cell A1 and save.
2. In the PowerPoint window `summary.pptx`, change the subtitle to `S4 COMBO1 DONE` and save.
3. Leave Excel, PowerPoint, and the PDF viewer open.

Do not close the PDF viewer. If a save dialog appears, keep the current format.
PROMPT>>>

## Notes

- Setup opens Excel and PowerPoint before the PDF viewer, so the input document is on top on entry.
- Excel uses the Office `EXCEL12.XLSX` shell seed; PowerPoint uses `New-S4WidescreenPptxSeed` with a distinct title.
- Oracle reads OOXML for both outputs and checks the PDF hash; no COM.
- Simulate closes the setup Office windows before replacing output paths; `evals/fixtures/combo01-data.xlsx` provides the expected A1=42 workbook.
