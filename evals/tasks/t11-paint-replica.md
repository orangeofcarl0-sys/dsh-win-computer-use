# t11 / paint-replica

- group: authored
- **tier: core**
- **isolation: dirty**
- **ac2: full**
- tools: screen_observe / screen_zoom / computer_click / computer_drag / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t11\`
- oracle: PNG 800x600 + white ratio + red/blue/black mask bbox/coverage tolerance
- 2026-11-16: dirty-desktop Paint replica. Reference image is shown in a new browser window; user windows are never closed.

## Prompt

<<<PROMPT
A reference image is open in a browser window whose title contains `s4-t11-ref`. The desktop may contain other user windows; never close them.

In the Paint window whose title contains `s4-t11-canvas`, reproduce the reference image on the 800x600 white canvas:
- a filled red rectangle;
- a filled blue ellipse;
- a thick black horizontal line near the bottom.

Use mouse drawing/shape controls. When done, save the canvas as `{task_dir}\out\replica.png` in PNG format and keep the 800x600 canvas size. Do not copy the reference file, do not use command-line tools, and do not resize the canvas.
PROMPT>>>

## Notes

- Setup opens the reference in a new browser window (`s4-t11-ref`) and the canvas seed in a Paint window (`s4-t11-canvas`).
- Cleanup closes only the recorded test HWNDs; if Paint merged into a user window/tab and cannot be proven/closes safely, it leaves the window and reports dirty.
- Oracle uses color masks with bbox/area/coverage tolerances; exact pixel hash is intentionally not used.
