# t22 / ppt-title-edit

- **stages: S3**
- **tier: core**
- **isolation: clean**
- **ac2: full**
- **app: powerpoint**
- **hotspot: office-ooxml**
- **requires: office-powerpoint**
- **variants: 3**
- tools: screen_observe / computer_activate / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t22\`
- oracle: PPTX 仍为 1 页 16:9，标题/副标题更新为 variant 指定文本，旧 seed 标题消失，seed hash 改变
- 2026-11-21: 第二条 PowerPoint 任务，覆盖标题/副标题编辑与保存；variant 1-3 使用不同 seed 与目标文本。

## Prompt

<<<PROMPT
A PowerPoint window titled `deck2.pptx` is open with one 16:9 slide.

1. Change the slide title to `{{title}}`.
2. Change the subtitle to `{{subtitle}}`.
3. Save the presentation in place and leave the window open.

Do not close PowerPoint. If a save dialog appears, keep the current format.
PROMPT>>>

## Notes

- Setup uses `New-S4WidescreenPptxSeed` with a distinct title/subtitle/bar prefix so t12 and t22 do not share seed text; variants 1-3 use different seed and target strings.
- Oracle only reads OOXML; no COM and no model self-evaluation.
- Simulate regenerates the expected deck through the same seed builder, using state title/subtitle, so no binary fixture is required.
