# t12 / ppt-replica

- group: authored
- **tier: core**
- **isolation: dirty**
- **ac2: none**
- tools: screen_observe / screen_zoom / computer_click / computer_type / computer_key
- sandbox: `%USERPROFILE%\.dsh\s4-evals\t12\`
- oracle: PPTX XML (slide count/size, text, shape colors/positions); no Office/COM
- 2026-11-16: dirty-desktop PowerPoint replica; user PowerPoint windows are never closed.

## Prompt

<<<PROMPT
A reference image is open in a browser window whose title contains `s4-t12-ref`. The desktop may contain other user presentations/windows; never close them.

In the PowerPoint window opened by setup, create ONE 16:9 slide that replicates the reference:
- title `S4 PPT REPLICA`, subtitle `Dirty Desktop Test`;
- three labeled bars `Q1`, `Q2`, `Q3` in red, blue and green at the positions shown;
- footer text `seed:S4-T12`.

Save the presentation as `{task_dir}\out\replica.pptx`. Do not create extra slides; do not use command-line/file-copy tools.
PROMPT>>>

## Notes

- Setup uses `POWERPNT.EXE /N` (new blank presentation) and requires a NEW top-level window; if PowerPoint reuses a user window, setup is ENV and never touches it.
- Oracle parses OOXML ZIP/XML only; no COM, no `Quit`, no `Presentations.Close`.
- AC2 simulate is not available for this app-dependent task; verify-oracles reports AC2 SKIP rather than a fake PASS.
