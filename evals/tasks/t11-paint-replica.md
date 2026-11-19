# t11 / paint-replica

- **stages: S2, S4**
- **tier: core**
- **isolation: dirty**
- **ac2: full**
- tools: screen_observe / screen_zoom / computer_click / computer_drag / computer_key / computer_activate
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t11\`
- oracle: PNG 800x600 + white ratio + red/blue/black mask bbox/coverage tolerance
- 2026-11-16: dirty-desktop Paint replica. Reference image is shown in a new browser window; user windows are never closed.

## Prompt

<<<PROMPT
A reference image is open in the browser window whose title contains `s4-t11-ref` (file: `{task_dir}\s4-t11-ref.png`). The desktop may contain other user windows; never close them.

The Paint window whose title contains `s4-t11-canvas` is maximized and already has the 800x600 white canvas open (seed: `{task_dir}\s4-t11-canvas.png`). Do not launch another browser or another Paint.

Before drawing, find the Paint `window_id` with `screen_observe` and activate it with `computer_activate` (do not use Alt+Tab or the taskbar). The maximized canvas is 800x600 window-screenshot pixels with top-left (879,600); if `screen_observe` shows a different canvas element, use that element's top-left. Do not apply any DPI scale: window coordinates are canvas coordinates plus that top-left. Single-click (959,690) once to focus the canvas; a focus click should not leave a visible mark. If it does, press Ctrl+Z.

Reproduce the reference on the canvas with the shape tools. The palette and shape tools are in Paint's accessibility tree; click their elements by label and do not use screen_zoom/native to hunt for them. The canvas brush/outline width is already set to 8 px by setup; do not open `大小` (it would add steps and may change the width). Also do not use computer_task, set_value on Paint controls, Alt+Tab, or the taskbar.
1. Click the `矩形` toggle button, click the `红色` palette item, then drag (959,690) to (1159,830). After a drag the rectangle tool stays selected; click `椭圆` explicitly for the next shape.
2. Click the `椭圆` toggle button, click the `靛蓝色` palette item, then drag (1299,690) to (1479,810).
3. Click the `直线` toggle button, click the `黑色` palette item, then drag (989,1080) to (1569,1080) with `steps=30` for a smooth stroke. Do not use a modifier for dragging. Draw each shape once; if a shape is wrong, press Ctrl+Z before drawing the intended one. Do not add extra shapes.

The canvas origin is (879,600) for this maximized 800x600 canvas; the absolute window coordinates above already include it. If `screen_observe`'s canvas bounds differ, recompute by adding the new `(left, top)`. If a native screenshot looks stale, re-observe with AX; do not base coordinates on an old frame. Paint is maximized; the canvas image is 800x600.

If the first drag receipt says unverified and the canvas shows no mark, re-activate Paint, focus-click the canvas again, and retry the same drag once with `foreground=true`. Do not repeat the same drag more than twice.

When all three shapes are drawn, save immediately as `{task_dir}\out\replica.png`. In the Save As dialog choose `保存类型 = PNG (*.png)` (do not leave JPEG/BMP selected); keep the 800x600 canvas. Do not copy the reference file, do not use command-line tools, do not resize the canvas, and never close user windows.
PROMPT>>>

## Notes

- Setup opens the canvas seed and the reference directly under `{task_dir}`, maximizes Paint, then opens the reference in a new browser window (`s4-t11-ref`). Paint 11 is single-process/tabbed, so setup is ENV if any `mspaint` process already exists.
- 2026-11-16 probe: Paint 11 exposes shape tools (`矩形`/`椭圆`/`直线`) and palette entries (`黑色`/`红色`/`靛蓝色`) in the AX tree when the window is maximized; the reference uses outlines so the fill-style control is not needed.
- 2026-11-16 trajectory: old prompt runs were 107/71 steps, no save; the explicit tool/color/drag prompt (this version) passed **84** and **77** steps with all oracle checks true (app_launch=0, computer_activate used, 12 drags). A variant that forced the size slider was aborted; one invalid-PNG output is now a fail (not ENV).
- 2026-11-17 coordinate/width finding: UIA probe shows the maximized canvas is exactly `(879,600) 800x600` window-screenshot pixels (1:1, no DPI scale). Two failed runs used origin `(872–875, 594–595)` — 4–7px up-left — and the default thin stroke; visible/bbox-center/area-ratio passed, but `reference coverage` was false for red/blue/black. Setup now selects `矩形/椭圆/直线` via AX and sets Paint's `大小` menu to `8 像素` for each; the prompt gives the exact canvas origin and tells the model not to touch `大小`. After this fix: **3/3 pass, 70/88/48 steps** (all oracle checks true; 5/6/3 drags; activate + focus-click-before-first-drag true; app_launch=0).
- Cleanup closes only the recorded test HWNDs; Paint 11's in-window "是否要保存?" ContentDialog is handled by `Dismiss-TestSavePrompt` before close. If Paint cannot be proven/closes safely, it leaves the window and reports dirty.
- Oracle uses per-color ROI masks with bbox/area/coverage tolerances; exact pixel hash is intentionally not used.
