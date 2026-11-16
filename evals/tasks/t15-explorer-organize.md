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
- in the inline edit box press Ctrl+A to select the whole current name including the `.txt` extension, then type `report-final.txt` and press Enter. If the result becomes `report-final.txt.txt`, rename it again to `report-final.txt`. Do not rename any other file.

Then move every file:
- every `.txt` (including `report-final.txt`) to `docs`;
- every `.png` and `.jpg` to `images`;
- every `.pdf`, `.md` and `.tmp` to `archive`.

Use single-click selection; never double-click a file (it opens an app and will be treated as a failed run). Click file items with `foreground=true` so the driver sends a real mouse click: background/UIA clicks on Explorer items can invoke the default action and open the file. Ctrl+click is available through `computer_click(element=..., modifier=["ctrl"])` and already forces foreground; use it to extend the selection, and do not Ctrl+click an already-selected file (it toggles it off). Do not use `computer_key` for clicking. Then use Ctrl+X/Ctrl+V, or drag, to move the selection. If a file does open in Notepad by mistake, close that Notepad window immediately without saving (Ctrl+W), return to Explorer, and continue; do not type in it. Do not verify after every move: finish all moves, then verify once. The inbox must contain only the three folders at the end. Do not delete or edit file contents, do not open files, and do not use command-line/file-write tools.
PROMPT>>>

## Notes

- Setup uses the existing state-scoped `Open-TestExplorer`; cleanup closes only the new HWND.
- Prompt puts the rename first and gives F2 plus the command-bar fallback; it forbids double-clicking files and per-move verification. The 8-file terminal tree is unchanged.
- 2026-11-16 live: **3/3 pass** (177/146/89 steps). The rename-first/F2+command-bar prompt keeps the terminal tree correct, but steps remain high and variable; Explorer rename/verification strategy is still the main cost.
- 2026-11-17 live: Ctrl+click is now expressible (`computer_click(..., modifier:["ctrl"])`); final **3/3 pass** at **77/72/59 steps** (5 Ctrl+click in each; no Notepad/Photos mis-open; dirty=false). Two prompt fixes came from failed runs: (a) file single-click must use `foreground=true` — background clicks go through UIA Invoke and opened Notepad/Photos/PDF; (b) after F2, press Ctrl+A in the edit box before typing the full name, otherwise Explorer keeps the extension and produces `report-final.txt.txt`.
- Oracle checks exact paths, old paths absent, and file contents unchanged.
