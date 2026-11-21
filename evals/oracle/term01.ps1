param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $out = [string]$state.output
  if (-not (Test-Path $out)) { Out-Finish -Ok $false -Checks @((Add-Check 'term output exists' $false $out)) }
  $text = ([IO.File]::ReadAllText($out)).Trim()
  $checks += (Add-Check 'term output exact' ($text -ceq 'S4 TERM OK') ("text=[$text]"))
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
