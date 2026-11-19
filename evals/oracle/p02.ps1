param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $resultFile = Join-Path $base 'out\result.json'
  if (-not (Test-Path $resultFile)) {
    $checks += (Add-Check 'result file exists' $false $resultFile)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'result file exists' $true $resultFile)
  $r = Get-Content $resultFile -Raw | ConvertFrom-Json
  $checks += (Add-Check 'expected token' (([string]$r.expected) -ceq 'P02-7K9') ("expected=$($r.expected)"))
  $checks += (Add-Check 'submitted token exact' (([string]$r.token) -ceq 'P02-7K9') ("token=$($r.token)"))
  $checks += (Add-Check 'token ok' (($r.ok) -eq $true) ("ok=$($r.ok)"))
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
