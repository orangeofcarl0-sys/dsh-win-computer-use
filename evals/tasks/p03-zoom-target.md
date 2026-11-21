# p03 / zoom-target

- **stages: S2**
- **tier: core**
- **ac2: full**
- **app: canvas,browser**
- **hotspot: pixel-zoom**
- **requires: browser,node**
- tools: screen_observe / screen_zoom / computer_click
- sandbox: `%USERPROFILE%\.dsh\s4-evals\p03\`
- oracle: canvas click cell == D3（16x16 小目标）
- 2026-11-19: real `screen_zoom` + `from_zoom=true` click on a small target.

## Prompt

<<<PROMPT
A local page is open in the browser window titled `S4-P03-ZOOM`. It shows a dense grid with one small red square.

Use `screen_zoom` to inspect the area and click the small red square once with `from_zoom=true`; do not guess from a preview size. Do not use keyboard navigation, developer tools, or page source.
PROMPT>>>

## Notes

- Requires an image-capable route; `screen_zoom` is the intended path.
- The server records the clicked cell; oracle accepts only `hit=true` and `cell=D3`.
- Cleanup closes only the recorded browser HWND and stops the test server.
