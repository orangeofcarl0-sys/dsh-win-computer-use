param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $appDir = New-TaskDir 'app'
  $out = New-TaskDir 'out'
  $script = Join-Path $appDir 'term-app.ps1'
  $app = @'
$Host.UI.RawUI.WindowTitle = 'S4-TERM01'
Write-Host 'S4 TERM READY'
while ($true) { Start-Sleep -Milliseconds 500 }
'@
  [IO.File]::WriteAllText($script, $app, (New-Object System.Text.UTF8Encoding($false)))
  $psExe = (Get-Command powershell.exe -ErrorAction SilentlyContinue).Source
  if (-not $psExe) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError 'powershell.exe not found' }
  $stateFile = Join-Path $base 'term.json'
  $win = Open-TestAppWindow -Exe $psExe -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script) -ProcessName '' -TitleNeedle @('S4-TERM01') -StateFile $stateFile -TimeoutSec 20
  $checks += (Add-Check 'PowerShell console' ([bool]$win.ok) ("hwnd=$($win.hwnd) title=$($win.title) reason=$($win.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = (Get-Date).ToUniversalTime().ToString('o'); output = (Join-Path $out 'term.txt') }))
  if (-not $win.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("console unavailable: " + $win.reason) }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
