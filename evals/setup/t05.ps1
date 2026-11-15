param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'saveas'
  $f = Join-Path $dir 'out-ansi.txt'
  if (Test-Path $f) { Remove-Item $f -Force }
  # pre-stage: a task-owned Notepad window showing the source text. Never kill
  # existing Notepad windows; if the file lands in a user window, fail closed.
  $src = New-TaskDir 'src'
  $draft = Join-Path $src 'draft.txt'
  [IO.File]::WriteAllText($draft, "S4-T05 ANSI check.`r`n", [Text.Encoding]::Default)
  $stateFile = Join-Path (Get-TaskDir) 'test-notepad.json'
  $state = Open-TestNotepad -Path $draft -TitleNeedle 'draft.txt' -StateFile $stateFile -ExpectedTabs @('draft.txt') -FinalTabs @('out-ansi.txt')
  $checks += (Add-Check 'notepad opened draft.txt as task-owned window' ([bool]$state.ok -and [bool]$state.owned) ("hwnd=$($state.hwnd) title=$($state.title) owned=$($state.owned)"))
  $checks += (Add-Check 'no stale out-ansi.txt' (-not (Test-Path $f)) $f)
  Out-Finish -Ok ([bool]$state.ok -and [bool]$state.owned -and (-not (Test-Path $f))) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
