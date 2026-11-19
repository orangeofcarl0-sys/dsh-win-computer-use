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

Do not close other user windows. Do not use command-line or file-write tools.
PROMPT>>>

## Notes

- Setup opens Explorer at `%USERPROFILE%`; if no new Explorer HWND can be proven, setup is ENV.
- The task measures address-bar navigation + file creation; cleanup closes only the recorded Explorer HWND.
- Simulate writes the target file for AC2.
