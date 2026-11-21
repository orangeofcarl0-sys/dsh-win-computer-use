# b01 / browser-tabs-form

- **stages: S3**
- **tier: core**
- **isolation: clean**
- **ac2: full**
- **app: browser**
- **hotspot: browser**
- **requires: browser,node**
- tools: screen_observe / computer_activate / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\b01\`
- oracle: result.json name=S4 B01, notes=TAB B
- 2026-11-21: 本地浏览器多标签 + 表单提交；不碰真实站点。

## Prompt

<<<PROMPT
A local browser page titled `S4-B01-TABS` is open.

1. Open `Tab A` and `Tab B` in separate browser tabs.
2. In `S4-B01-B`, fill Name with `S4 B01` and Notes with `TAB B`, then submit the form.
3. Leave the browser open.

Do not use real websites or any non-local address.
PROMPT>>>

## Notes

- The local server serves `/tabs/a` and `/tabs/b`; only the test-owned browser HWND is closed.
- Upload/auth/print-to-PDF are still BLOCKED; this task covers tabs + form.
- Oracle reads the server's result.json; no model self-evaluation.
