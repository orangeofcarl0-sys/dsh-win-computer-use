# t16 / browser-form

- group: authored
- **tier: core**
- **isolation: dirty**
- **ac2: full**
- tools: screen_observe / screen_zoom / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t16\`
- oracle: local form server result.json exact fields
- 2026-11-16: local-only browser form on the dirty desktop; user browser windows are never closed.

## Prompt

<<<PROMPT
The desktop may contain other user browser windows; never close them.

A browser window titled `S4-T16-FORM` is open to a local form. Fill exactly:
- Full name: `Ada Lovelace`
- Email: `ada@example.com`
- Plan: `Pro`
- Contact: `Email`
- Newsletter: checked
- Notes: `S4-T16`

Press Submit and wait for the confirmation page. Do not use command-line tools or edit any local file directly.
PROMPT>>>

## Notes

- Setup starts a 127.0.0.1-only form server and opens a new browser window; cleanup stops only the recorded server PID and closes only the recorded browser HWND.
- Oracle reads the server-written result.json; no OCR/model self-evaluation.
