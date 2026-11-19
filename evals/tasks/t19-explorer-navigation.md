# t19 / explorer-navigation

- **stages: S3**
- **tier: core**
- **ac2: full**
- tools: screen_observe / computer_key / computer_type / computer_click
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t19\`
- oracle: `nav\target.txt` exists with exact content `NAV-OK`
- 2026-11-19: navigation coverage. Setup starts at the user profile, not the target directory.

## Prompt

<<<PROMPT
An Explorer window is open at your user profile. Navigate to `{task_dir}\nav` using the address bar (Ctrl+L) or the path breadcrumb, then create a new text file named `target.txt` in that folder containing exactly:

NAV-OK

Creating the file through Notepad's Save As is acceptable. Do not close other user windows. Do not use command-line or file-write tools. Do not use Win+R; use `app_launch` or the Start menu if you need to open Notepad.
PROMPT>>>

## Notes

- Setup opens Explorer at `%USERPROFILE%`; if no new Explorer HWND can be proven, setup is ENV.
- The task measures address-bar navigation + file creation; cleanup closes only the recorded Explorer HWND.
- File creation may use Explorer's New command or Notepad's Save As. The oracle checks the file, so a pass does not prove Explorer's New path specifically; that provenance is intentionally out of scope here.
- Win+R is forbidden in the prompt: on this desktop it can degrade to a bare `win` (Start/Search) or open CmdPal, costing many steps. Use `app_launch` or the Start menu.
- Simulate writes the target file for AC2.
