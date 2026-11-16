# t12 / ppt-replica

- group: authored
- **tier: core**
- **isolation: dirty**
- **ac2: none**
- tools: screen_observe / screen_zoom / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t12\`
- oracle: PPTX XML (slide count/size, text, shape colors/positions); no Office/COM
- 2026-11-16: dirty-desktop PowerPoint replica; user PowerPoint windows are never closed.

## Prompt

<<<PROMPT
A reference image is open in the browser window whose title contains `s4-t12-ref` (file: `{task_dir}\s4-t12-ref.png`). The desktop may contain other user presentations/windows; never close them.

The PowerPoint window whose title contains `replica` already has a presentation open and saved at `{task_dir}\out\replica.pptx`. It contains exactly one 16:9 slide; use that slide. Do not create a new presentation, do not change the slide size, and do not add a second slide.

Replicate the reference on this slide:
- title `S4 PPT REPLICA` and subtitle `Dirty Desktop Test` are already filled in; do not modify them;
- three gray rectangle placeholders are already on the slide at the target positions (Q1/Q2/Q3). Click each gray bar, set 形状填充 to red, blue and green respectively, and add the Q1/Q2/Q3 labels (separate text boxes are fine). Do not insert new shapes or move the placeholders.

Click the `保存` toolbar button (top-left floppy icon; Ctrl+S also works) immediately after opening and again after each filled bar. Do not wait until the end, do not use Save As, and do not close PowerPoint. Do not use command-line/file-copy tools.
PROMPT>>>

## Notes

- Setup builds `out\replica.pptx` from the installed `WidescreenPresentation.potx`, prunes it to one 16:9 slide, records `seedHash`, then opens that final path in a new PowerPoint window (maximized). No `/N`, no COM.
- The seed also contains the correct title/subtitle and three gray rectangle placeholders (`S4 Bar Q1/Q2/Q3`) at the exact oracle geometry; the task is to recolor/label them, not to insert shapes or retype the title. This avoids the 2026-11-16 `Insert > Shapes` hunt and title loss.
- The prompt asks for an explicit `保存` toolbar checkpoint after the text exists and after each bar; the seed file is already at the final path, so saving does not require Save As. 2026-11-16 runs that waited until the end did not save.
- 2026-11-16 live: 25 min/190 steps saved; title/subtitle, red/blue bars and Q1 passed, green bar and Q2/Q3 missing. Still high-risk; not a smoke promise.
- Oracle parses OOXML ZIP/XML only; no COM, no `Quit`, no `Presentations.Close`. It requires the output hash to differ from `seedHash` and the existing slide/text/shape checks to pass.
- If the Office widescreen template is missing/invalid, setup is ENV. AC2 simulate is not available; verify-oracles reports AC2 SKIP rather than a fake PASS.
