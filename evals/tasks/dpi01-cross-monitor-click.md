# dpi01 / cross-monitor-click

- **stages: S2**
- **tier: core**
- **isolation: clean**
- **ac2: full**
- **app: winforms**
- **hotspot: windows-specific**
- **requires: powershell,secondary-monitor**
- tools: screen_observe / computer_activate / computer_click
- sandbox: `%USERPROFILE%\.dsh\s4-evals\dpi01\`
- oracle: 第二屏 fixture 的 Click 计数 == 1
- 2026-11-21: 第二屏窗口点击；验证窗口截图坐标/屏幕原点不落在主屏。

## Prompt

<<<PROMPT
A local window titled `S4-DPI01-SECOND` is open on the secondary monitor.

Click its `Click` button once, then leave the window open. Do not move it to the primary monitor.
PROMPT>>>

## Notes

- Setup enumerates `System.Windows.Forms.Screen`; if fewer than two monitors, setup returns ENV.
- The fixture is placed at the secondary monitor origin + 100px, not at a hard-coded primary coordinate.
- Oracle checks the click counter; a cross-monitor coordinate bug will either miss or hit the wrong place.
