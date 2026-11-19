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
  $r = Get-Content $resultFile -Raw | ConvertFrom-Json
  $cancelled = [int]$r.cancelled
  $confirmed = [int]$r.confirmed
  $checks += (Add-Check 'cancel recorded' ($cancelled -ge 1) ("cancelled=$cancelled"))
  $checks += (Add-Check 'confirm recorded' ($confirmed -ge 1) ("confirmed=$confirmed"))
  $checks += (Add-Check 'delete only after confirm' (($r.deleted) -eq $true) ("deleted=$($r.deleted)"))
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
