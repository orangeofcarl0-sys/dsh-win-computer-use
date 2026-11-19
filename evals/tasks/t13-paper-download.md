# t13 / paper-download

- **stages: S3, S4**
- **tier: core**
- **isolation: dirty**
- **ac2: none**
- tools: screen_observe / computer_click / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t13\` (state only; download goes to user's default Downloads)
- oracle: new PDF in user Downloads with SHA-256 == setup-captured NeurIPS 2017 hash
- network: required; setup ENV if unavailable
- 2026-11-16: real NeurIPS download on the dirty desktop; user browser is reused via a new window, never killed.

## Prompt

<<<PROMPT
A browser window has been opened to the NeurIPS page for `Attention Is All You Need` (NeurIPS 2017). Download the PDF (NeurIPS 2017 version) to the browser's default Downloads directory (usually `C:\Users\<you>\Downloads`). If the PDF opens in a viewer, use the viewer's download button.

Do not use command-line tools, file-copy tools, or a dedicated browser profile. Do not close or modify other user browser windows/tabs. The download must be a real PDF file, not only a viewer tab.
PROMPT>>>

## Notes

- Setup downloads the same version once to a temp file, records SHA-256/size, then deletes it; the agent cannot copy a pre-staged target.
- Oracle only considers PDFs created after setup started; cleanup deletes only new files whose SHA-256 matches the expected paper.
- Existing user PDFs and other Downloads files are never modified.
- AC2 simulate is not available for a real-network task; verify-oracles reports AC2 SKIP.
