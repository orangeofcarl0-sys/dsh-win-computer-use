# t12 / ppt-replica

- **stages: S3, S4**
- **tier: core**
- **isolation: dirty**
- **ac2: none**
- tools: screen_observe / screen_zoom / computer_click / computer_type / computer_key / computer_activate
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t12\`
- oracle: PPTX XML (slide count/size, text, shape colors/positions); no Office/COM
- 2026-11-16: dirty-desktop PowerPoint replica; user PowerPoint windows are never closed.

## Prompt

<<<PROMPT
A reference image is open in the browser window whose title contains `s4-t12-ref` (file: `{task_dir}\s4-t12-ref.png`). The desktop may contain other user presentations/windows; never close them.

The PowerPoint window whose title contains `replica` already has a presentation open and saved at `{task_dir}\out\replica.pptx`. It contains exactly one 16:9 slide; use that slide. Do not create a new presentation, do not change the slide size, and do not add a second slide.

Replicate the reference on this slide:
- title `S4 PPT REPLICA` and subtitle `Dirty Desktop Test` are already filled in; do not modify them;
- three gray rectangle placeholders are already on the slide at the target positions. Select them by their accessibility names `S4 Bar Q1`, `S4 Bar Q2`, `S4 Bar Q3` from `screen_observe`; only fall back to visible coordinates if AX does not expose them. Do not insert new shapes or move the placeholders.

For each bar, in order Q1/Q2/Q3:
1. click the bar once to select it, then set 形状填充:
   - Q1: 标准色 → 深红 (C00000)
   - Q2: 标准色 → 蓝色 (0070C0)
   - Q3: 主题颜色 → 绿色，强调文字颜色6 (70AD47); only if that swatch is absent, use 其他填充颜色 with RGB 112,173,71. Do not open 其他填充颜色 for Q1/Q2.
2. double-click the bar, type its label (`Q1`/`Q2`/`Q3`) directly into the shape, then press Esc. Only if no text caret appears, insert a text box as a fallback.
3. Click `保存`.

Click the `保存` toolbar button (top-left floppy icon; Ctrl+S also works) immediately after opening and again after each bar. Do not wait until the end, do not use Save As, and do not close PowerPoint. If a color dialog or format pane closes and the main window/ribbon loses focus, call `computer_activate` with the PowerPoint window_id; do not click the taskbar. Do not use command-line/file-copy tools.
PROMPT>>>

## Notes

- Setup builds `out\replica.pptx` from the installed `WidescreenPresentation.potx`, prunes it to one 16:9 slide, records `seedHash`, then opens that final path in a new PowerPoint window (maximized). No `/N`, no COM.
- The seed also contains the correct title/subtitle and three gray rectangle placeholders (`S4 Bar Q1/Q2/Q3`) at the exact oracle geometry; the task is to recolor/label them, not to insert shapes or retype the title. This avoids the 2026-11-16 `Insert > Shapes` hunt and title loss.
- The prompt asks for an explicit `保存` toolbar checkpoint after the text exists and after each bar; the seed file is already at the final path, so saving does not require Save As. 2026-11-16 runs that waited until the end did not save.
- 2026-11-16 live: 25 min/190 steps saved; title/subtitle, red/blue bars and Q1 passed, green bar and Q2/Q3 missing. Still high-risk; not a smoke promise.
- 2026-11-17 white seed: `New-S4WidescreenPptxSeed` now adds a slide-level white `p:bg`, prunes template decorations, keeps only title/subtitle placeholders + the three gray `S4 Bar` shapes, and validates 1 slide/16:9/3 bars/text. Setup opens with `TitleNeedle='replica'` so a splash/repair dialog cannot be recorded as the test window. Prompt selects bars by AX name, uses standard/theme color swatches (no custom dialog for red/blue), double-clicks the bar to type Q1/Q2/Q3 directly, saves after each, and re-activates after dialogs. AC2 setup passed with `replica.pptx - PowerPoint`.
- 2026-11-17 live: **2/2 pass, 140/169 steps** (139/168 inner; 2 errors each; 71/96 unverified; 40-min budget). Oracle for both: hash changed, 1 slide/16:9, title/subtitle/Q1/Q2/Q3, red/blue/green bars all true. This is the first t12 live pass; previous 25-min run was 190 steps with only red/blue + Q1.
- Oracle parses OOXML ZIP/XML only; no COM, no `Quit`, no `Presentations.Close`. It requires the output hash to differ from `seedHash` and the existing slide/text/shape checks to pass.
- If the Office widescreen template is missing/invalid, setup is ENV. AC2 simulate is not available; verify-oracles reports AC2 SKIP rather than a fake PASS.
