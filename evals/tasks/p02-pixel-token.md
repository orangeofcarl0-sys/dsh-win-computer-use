# p02 / pixel-token

- **stages: S2**
- **tier: core**
- **ac2: full**
- tools: screen_observe / screen_zoom / computer_type / computer_click
- sandbox: `%USERPROFILE%\.dsh\s4-evals\p02\`
- oracle: server token == P02-7K9
- 2026-11-19: pixel-only token read-back. The token is drawn on a canvas with no AX text.

## Prompt

<<<PROMPT
A local page is open in the browser window titled `S4-P02-TOKEN`. It shows a short code rendered on a canvas.

Read the code from the screen, type it into the input field, and press Submit. Do not open developer tools, do not inspect page source, and do not edit the page. The code is not provided in this prompt.
PROMPT>>>

## Notes

- Requires an image-capable route (`mode=native`/`screen_zoom` or vision); text-only fails.
- The server writes the submitted value and the expected value to `out/result.json`; oracle requires exact match.
- Cleanup closes only the recorded browser HWND and stops the test server.
