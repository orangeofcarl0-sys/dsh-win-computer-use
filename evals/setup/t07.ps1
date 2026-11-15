param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir
  $f = Join-Path $dir 'workfile.txt'
  if (-not (Test-Path $f)) { Set-Content -Path $f -Value '' -Encoding ASCII -NoNewline }
  # Use the same HWND/ownership + exact-tab-set contract as the other Notepad tasks.
  # Preflight fails closed if any other Notepad window exists (never add a test tab
  # to a user window); cleanup discards test-only edits and closes via UIA.
  $stateFile = Join-Path (Get-TaskDir) 'test-notepad.json'
  $s = Open-TestNotepad -Path $f -TitleNeedle 'workfile.txt' -StateFile $stateFile -ExpectedTabs @('workfile.txt')
  $ok = [bool]$s.ok -and [bool]$s.owned
  $checks += (Add-Check 'workfile.txt notepad opened as task-owned window' $ok ("hwnd=$($s.hwnd) title=$($s.title) owned=$($s.owned) reason=$($s.reason)"))
  Out-Finish -Ok $ok -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
