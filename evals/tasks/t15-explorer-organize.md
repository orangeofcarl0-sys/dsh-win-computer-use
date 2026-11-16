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

An Explorer window is open at the sandbox inbox. It contains eight files and three folders. First rename `report-draft.txt` to `report-final.txt`:
- single-click the file name once to select it (do not double-click);
- press F2; if no inline edit box appears, use the Explorer command bar's 重命名 button or right-click > 重命名;
- type `report-final.txt` and press Enter. Do not rename any other file.

Then move every file:
- every `.txt` (including `report-final.txt`) to `docs`;
- every `.png` and `.jpg` to `images`;
- every `.pdf`, `.md` and `.tmp` to `archive`.

Use single-click selection; never double-click a file (it opens an app). Use Ctrl+click to select multiple files, then Ctrl+X/Ctrl+V, or drag them. Do not verify after every move: finish all moves, then verify once. The inbox must contain only the three folders at the end. Do not delete or edit file contents, do not open files, and do not use command-line/file-write tools.
PROMPT>>>

## Notes

- Setup uses the existing state-scoped `Open-TestExplorer`; cleanup closes only the new HWND.
- Prompt puts the rename first and gives F2 plus the command-bar fallback; it forbids double-clicking files and per-move verification. The 8-file terminal tree is unchanged.
- 2026-11-16 live: **3/3 pass** (177/146/89 steps). The rename-first/F2+command-bar prompt keeps the terminal tree correct, but steps remain high and variable; Explorer rename/verification strategy is still the main cost.
- Oracle checks exact paths, old paths absent, and file contents unchanged.
