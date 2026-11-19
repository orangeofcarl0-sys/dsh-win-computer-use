# p01 / pixel-target

- **stages: S2**
- **tier: core**
- **ac2: full**
- tools: screen_observe / screen_zoom / computer_click
- sandbox: `%USERPROFILE%\.dsh\s4-evals\p01\`
- oracle: canvas click cell == C2（唯一红色圆的格子）
- 2026-11-19: unassisted pixel localization. The page has no AX label for the target and the prompt gives no coordinates.

## Prompt

<<<PROMPT
A local page is open in the browser window titled `S4-P01-PIXEL`. It shows a 6x4 grid of colored cells; exactly one cell contains a red circle.

Click the red circle once. Do not use keyboard navigation, do not open developer tools, and do not edit the page. Use the canvas itself to locate the target; coordinates are not provided.
PROMPT>>>

## Notes

- Requires an image-capable route (`mode=native`/`screen_zoom`); a text-only route fails this task rather than reporting ENV.
- The server records the clicked cell in `out/result.json`; the oracle accepts only `hit=true` and `cell=C2`.
- Cleanup closes only the recorded browser HWND and stops the test server.
