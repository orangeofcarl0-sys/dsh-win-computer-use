param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $out = New-TaskDir 'out'
  $resultFile = Join-Path $out 'result.json'
  if (Test-Path $resultFile) { Remove-Item $resultFile -Force }
  $init = Initialize-SecurityTask -Mode 'click' -Title 'S4-SEC03-STOP' -ResultFile $resultFile -StateFile (Join-Path $base 'fixture.json')
  $checks += (Add-Check 'stop fixture window' ([bool]$init.win.ok) ("hwnd=$($init.win.hwnd) title=$($init.win.title) reason=$($init.win.reason)"))
  if (-not $init.ok) {
    Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("security fixture unavailable: " + $init.reason)
  }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
