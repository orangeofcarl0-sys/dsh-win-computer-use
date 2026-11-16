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
A reference image is open in the browser window whose title contains `s4-t11-ref` (file: `{task_dir}\s4-t11-ref.png`). The desktop may contain other user windows; never close them.

The Paint window whose title contains `s4-t11-canvas` is maximized and already has the 800x600 white canvas open (seed: `{task_dir}\s4-t11-canvas.png`). Do not launch another browser or another Paint.

Reproduce the reference on the canvas with the shape tools. The palette and shape tools are in Paint's accessibility tree; click their elements by label and do not use screen_zoom/native to hunt for them. Also do not use computer_task, set_value on Paint controls, Alt+Tab, or the taskbar.
1. Click the `矩形` toggle button, click the `红色` palette item, then drag from canvas (80,90) to (280,230). After a drag the rectangle tool stays selected; click `椭圆` explicitly for the next shape.
2. Click the `椭圆` toggle button, click the `靛蓝色` palette item, then drag from canvas (420,90) to (600,210).
3. Click the `直线` toggle button, click the `黑色` palette item, then drag from canvas (110,480) to (690,480). The default line width is fine; do not adjust 大小. Draw each shape once; if a shape is wrong, press Ctrl+Z before drawing the intended one, and do not add extra shapes.

Canvas coordinates are relative to the canvas top-left; use the canvas bounds from `screen_observe` (or the native screenshot) to convert them to window-screenshot coordinates before dragging. Paint is maximized and the canvas is 800x600 at 100% zoom.

When all three shapes are drawn, save immediately as `{task_dir}\out\replica.png`. In the Save As dialog choose `保存类型 = PNG (*.png)` (do not leave JPEG/BMP selected); keep the 800x600 canvas. Do not copy the reference file, do not use command-line tools, do not resize the canvas, and never close user windows.
PROMPT>>>

## Notes

- Setup opens the canvas seed and the reference directly under `{task_dir}`, maximizes Paint, then opens the reference in a new browser window (`s4-t11-ref`). Paint 11 is single-process/tabbed, so setup is ENV if any `mspaint` process already exists.
- 2026-11-16 probe: Paint 11 exposes shape tools (`矩形`/`椭圆`/`直线`) and palette entries (`黑色`/`红色`/`靛蓝色`) in the AX tree when the window is maximized; the reference uses outlines so the fill-style control is not needed.
- 2026-11-16 trajectory: old prompt runs were 107/71 steps, no save; the explicit tool/color/drag prompt (this version) passed **84** and **77** steps with all oracle checks true (app_launch=0, computer_activate used, 12 drags). A variant that forced the size slider was aborted; one invalid-PNG output is now a fail (not ENV).
- Cleanup closes only the recorded test HWNDs; Paint 11's in-window "是否要保存?" ContentDialog is handled by `Dismiss-TestSavePrompt` before close. If Paint cannot be proven/closes safely, it leaves the window and reports dirty.
- Oracle uses per-color ROI masks with bbox/area/coverage tolerances; exact pixel hash is intentionally not used.
