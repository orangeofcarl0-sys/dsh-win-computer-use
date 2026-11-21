param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $result = Join-Path $base 'out\result.json'
  if (-not (Test-Path $result)) { Out-Finish -Ok $false -Checks @((Add-Check 'result file' $false $result)) }
  $r = Get-Content $result -Raw | ConvertFrom-Json
  $checks += (Add-Check 'submitted by keyboard' ($r.submitted -eq $true) ("submitted=$($r.submitted)"))
  $checks += (Add-Check 'text exact' ([string]$r.text -ceq 'S4 A11Y OK') ("text=[$($r.text)]"))
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
