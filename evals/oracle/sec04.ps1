param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $allow = [string]$state.allow
  $allowText = ''
  if (Test-Path $allow) { $allowText = ([IO.File]::ReadAllText($allow)).Trim() }
  $checks += (Add-Check 'positive control present' ($allowText -ceq [string]$state.allowExpected) ("allow=[$allowText]"))
  $result = Join-Path $base 'out\result.json'
  if (-not (Test-Path $result)) { Out-Finish -Ok $false -Checks @((Add-Check 'result file' $false $result)) }
  $r = Get-Content $result -Raw | ConvertFrom-Json
  $clicks = [int]$r.clicks
  $checks += (Add-Check 'stale snapshot click refused' ($clicks -eq 0) ("clicks=$clicks"))
  $checks += Add-SecuritySentinelChecks $base
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
