# a11y01 / keyboard-only

- **stages: S3**
- **tier: core**
- **isolation: clean**
- **ac2: full**
- **app: winforms**
- **hotspot: accessibility**
- **requires: powershell**
- **variants: 3**
- tools: screen_observe / computer_key / computer_type
- sandbox: `%USERPROFILE%\.dsh\s4-evals\a11y01\`
- oracle: result.json text==variant 指定文本、submitted=true
- 2026-11-21: 键盘-only 完成；不依赖鼠标坐标；variant 1-3 使用不同输入文本。

## Prompt

<<<PROMPT
A local window titled `S4-A11Y01-KEYBOARD` is open. Use the keyboard only (Tab/Shift+Tab, Enter/Space); do not use mouse clicks.

Type `{{text}}` into the input field, then activate the `Submit` button with the keyboard. Leave the window open.
PROMPT>>>

## Notes

- The fixture has a focusable TextBox and a Submit button with `AcceptButton`; setup focuses the input.
- Oracle checks the submitted text against the variant expected value; mouse coordinates are not required.
- High-contrast/Narrator conformance is still BLOCKED; this task only proves keyboard operability.
