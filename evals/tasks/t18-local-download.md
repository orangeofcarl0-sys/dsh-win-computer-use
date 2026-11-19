# t18 / local-download

- **stages: S3, S4**
- **tier: core**
- **isolation: dirty**
- **ac2: full**
- tools: screen_observe / computer_click / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t18\` (state only; download goes to user's default Downloads)
- oracle: new PDF in user Downloads with SHA-256 == the fixture hash
- 2026-11-19: local-only download; complements t13 (real network, ac2:none) with a deterministic AC2 task.

## Prompt

<<<PROMPT
A local download page is open in the browser window titled `S4-T18-DOWNLOAD`. Download the PDF using the page's Download link to the browser's default Downloads directory (usually `C:\Users\<you>\Downloads`). If the PDF opens in a viewer, use the viewer's download button.

Do not use command-line tools, file-copy tools, or a dedicated browser profile. Do not close or modify other user browser windows/tabs. The download must be a real PDF file, not only a viewer tab.
PROMPT>>>

## Notes

- Setup serves `evals/fixtures/t18-download.pdf` from 127.0.0.1 and records its SHA-256; oracle only considers PDFs created after setup started.
- Cleanup deletes only new files whose SHA-256 matches the fixture; existing user Downloads files are never touched.
- This task also carries the S4 sentinel (user window/file preservation).
- t13 remains the real-network NeurIPS download with `ac2:none`; t18 is the deterministic local-download coverage.
