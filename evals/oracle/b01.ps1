param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $result = [string]$state.result
  if (-not (Test-Path $result)) { Out-Finish -Ok $false -Checks @((Add-Check 'form result exists' $false $result)) }
  $r = Get-Content $result -Raw | ConvertFrom-Json
  $checks += (Add-Check 'name exact' ([string]$r.name -ceq 'S4 B01') ("name=[$($r.name)]"))
  $checks += (Add-Check 'notes exact' ([string]$r.notes -ceq 'TAB B') ("notes=[$($r.notes)]"))
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
