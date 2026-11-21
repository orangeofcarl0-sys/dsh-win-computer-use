# t22 / ppt-title-edit

- **stages: S3**
- **tier: core**
- **isolation: clean**
- **ac2: full**
- **app: powerpoint**
- **hotspot: office-ooxml**
- **requires: office-powerpoint**
- tools: screen_observe / computer_activate / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t22\`
- oracle: PPTX 仍为 1 页 16:9，标题/副标题更新为指定文本，seed hash 改变
- 2026-11-21: 第二条 PowerPoint 任务，覆盖标题/副标题编辑与保存。

## Prompt

<<<PROMPT
A PowerPoint window titled `deck2.pptx` is open with one 16:9 slide.

1. Change the slide title to `S4 T22 UPDATED`.
2. Change the subtitle to `Second PPT Test Updated`.
3. Save the presentation in place and leave the window open.

Do not close PowerPoint. If a save dialog appears, keep the current format.
PROMPT>>>

## Notes

- Setup uses `New-S4WidescreenPptxSeed` with a distinct title/subtitle/bar prefix so t12 and t22 do not share seed text.
- Oracle only reads OOXML; no COM and no model self-evaluation.
- Simulate regenerates the expected deck through the same seed builder, so no binary fixture is required.
