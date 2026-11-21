# term01 / powershell-terminal

- **stages: S3**
- **tier: core**
- **isolation: clean**
- **ac2: full**
- **app: other**
- **hotspot: windows-specific**
- **requires: powershell**
- tools: screen_observe / computer_activate / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\term01\`
- oracle: out/term.txt 内容为 S4 TERM OK
- 2026-11-21: PowerShell 控制台任务；覆盖终端窗口的键盘输入与文件落盘。

## Prompt

<<<PROMPT
A PowerShell console titled `S4-TERM01` is open.

Run this command in the console:
`Set-Content -Path '{task_dir}\out\term.txt' -Value 'S4 TERM OK' -NoNewline`

Then run `exit`. Type directly into the `S4-TERM01` console; do not open Notepad or use any other terminal/file-writing tool.
PROMPT>>>

## Notes

- Setup starts a test-owned PowerShell console with a unique title; cleanup closes only its recorded HWND.
- Oracle reads the output file; no model self-evaluation.
- If the console is unavailable, setup returns ENV.
