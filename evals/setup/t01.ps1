param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $targetDir = New-TaskDir 'target'
  $target = Join-Path $targetDir 'note.txt'
  if (Test-Path $target) { Remove-Item $target -Force }
  # Unique empty seed document: avoids colliding with the user's existing Notepad
  # windows/tabs and gives cleanup an exact title to track. Never kill Notepad.
  $seed = Join-Path $targetDir 's4-t01-seed.txt'
  [IO.File]::WriteAllText($seed, '', (New-Object System.Text.UTF8Encoding($false)))
  $stateFile = Join-Path (Get-TaskDir) 'test-notepad.json'
  $state = Open-TestNotepad -Path $seed -TitleNeedle 's4-t01-seed.txt' -StateFile $stateFile -ExpectedTabs @('s4-t01-seed.txt') -FinalTabs @('note.txt')
  $checks += (Add-Check 'seed notepad opened as task-owned window' ([bool]$state.ok -and [bool]$state.owned) ("hwnd=$($state.hwnd) title=$($state.title) owned=$($state.owned)"))
  $checks += (Add-Check 'target dir prepared, no stale file' (-not (Test-Path $target)) $target)
  Out-Finish -Ok ([bool]$state.ok -and [bool]$state.owned -and (-not (Test-Path $target))) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
