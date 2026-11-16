# t15 / explorer-organize

- group: authored
- **tier: core**
- **isolation: dirty**
- **ac2: full**
- tools: screen_observe / computer_click / computer_key / computer_type
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t15\`
- oracle: exact file-system tree + unchanged file contents
- 2026-11-16: dirty-desktop Explorer organization; existing user Explorer windows are never closed.

## Prompt

<<<PROMPT
The desktop may contain other user Explorer windows; never close them.

An Explorer window is open at the sandbox inbox. Organize it exactly:
- move every `.txt` file to `docs`;
- rename `report-draft.txt` to `report-final.txt` (it must end up in `docs`);
- move every `.png` and `.jpg` file to `images`;
- move every `.pdf`, `.md` and `.tmp` file to `archive`.

The inbox must contain only the three folders at the end. Do not delete or edit file contents, and do not use command-line/file-write tools.
PROMPT>>>

## Notes

- Setup uses the existing state-scoped `Open-TestExplorer`; cleanup closes only the new HWND.
- Oracle checks exact paths, old paths absent, and file contents unchanged.
