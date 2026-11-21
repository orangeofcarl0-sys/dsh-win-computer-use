# rec03 / network-retry

- **stages: S3, S4**
- **tier: core**
- **isolation: dirty**
- **ac2: full**
- **app: browser,pdf**
- **hotspot: recovery**
- **requires: browser,node**
- tools: screen_observe / computer_activate / computer_click / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\rec03\`
- oracle: Downloads 新增 PDF hash 匹配 fixture；sentinel 不变
- 2026-11-21: 首次下载返回 500，重试后成功；验证断网/失败重试恢复。

## Prompt

<<<PROMPT
A local browser page titled `S4-REC03-FLAKY` is open.

Download the PDF. The first request may fail with a temporary server error; retry until the PDF is saved successfully. Leave the browser open.
PROMPT>>>

## Notes

- The local server returns 500 on the first `/download/paper.pdf` request and the fixture on retry (`--fail-first`).
- Oracle waits for a new PDF in Downloads whose SHA-256 matches the fixture.
- Cleanup removes only hash-matched new PDFs, closes the browser, stops the server, and closes the sentinel.
