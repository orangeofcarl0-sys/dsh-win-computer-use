param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $state = Read-TestState (Join-Path (Get-TaskDir) 'test-notepad.json')
  if (-not $state -or -not $state.hwnd) {
    $checks += (Add-Check 'task-owned window state' $false 'test-notepad.json missing or has no hwnd')
    Out-Finish -Ok $false -Checks $checks
  }
  $hwnd = [int]$state.hwnd
  $alive = Test-WindowAlive $hwnd
  $checks += (Add-Check 'task-owned window exists' $alive ("hwnd=$hwnd"))
  if (-not $alive) {
    Out-Finish -Ok $false -Checks $checks
  }
  $w = Find-WindowByHwnd $hwnd
  $checks += (Add-Check 'window title' ([bool]$w) $(if ($w) { [string]$w.title } else { '' }))
  $p = Get-Placement $hwnd
  $maxed = ($p.showCmd -eq 3)
  $checks += (Add-Check 'placement == SW_SHOWMAXIMIZED' $maxed ('showCmd=' + $p.showCmd))
  Out-Finish -Ok $maxed -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
