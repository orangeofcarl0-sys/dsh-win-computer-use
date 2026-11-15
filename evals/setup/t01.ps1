param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $targetDir = New-TaskDir 'target'
  $target = Join-Path $targetDir 'note.txt'
  # In-place save variant: the task document already exists and is open. This avoids
  # the Win11 Save As filename field + MRU overwrite-confirm loop (2026-11-15),
  # which the driver's UIA/type paths cannot reliably drive. Save As coverage
  # remains in t05. Oracle is unchanged (target exists + exact content).
  [IO.File]::WriteAllText($target, '', (New-Object System.Text.UTF8Encoding($false)))
  $stateFile = Join-Path (Get-TaskDir) 'test-notepad.json'
  $state = Open-TestNotepad -Path $target -TitleNeedle 'note.txt' -StateFile $stateFile -ExpectedTabs @('note.txt') -FinalTabs @('note.txt')
  $checks += (Add-Check 'note.txt notepad opened as task-owned window' ([bool]$state.ok -and [bool]$state.owned) ("hwnd=$($state.hwnd) title=$($state.title) owned=$($state.owned) reason=$($state.reason)"))
  $checks += (Add-Check 'target prepared empty' ((Test-Path $target) -and ((Get-Item $target).Length -eq 0)) $target)
  Out-Finish -Ok ([bool]$state.ok -and [bool]$state.owned -and (Test-Path $target)) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
