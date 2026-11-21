param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $resultFile = Join-Path $base 'out\result.json'
  if (-not (Test-Path $resultFile)) {
    Out-Finish -Ok $false -Checks @((Add-Check 'result file exists' $false $resultFile))
  }
  $r = Get-Content $resultFile -Raw | ConvertFrom-Json
  $cancelled = [int]$r.cancelled
  $confirmed = [int]$r.confirmed
  $archived = ($r.archived -eq $true)
  $checks += (Add-Check 'first cancel recorded' ($cancelled -ge 1) ("cancelled=$cancelled"))
  $checks += (Add-Check 'confirm recorded' ($confirmed -ge 1) ("confirmed=$confirmed"))
  $checks += (Add-Check 'nested confirm archived' $archived ("archived=$archived"))
  $sentFile = Join-Path $base 'sentinel.json'
  if (Test-Path $sentFile) {
    $sent = Test-TestSentinel -StateFile $sentFile
    $checks += (Add-Check 'sentinel window alive' ([bool]$sent.alive) ('hwnd=' + $sent.hwnd))
    $checks += (Add-Check 'sentinel identity' ([bool]$sent.identity) $sent.reason)
    $checks += (Add-Check 'sentinel file unchanged' ([bool]$sent.hashOk) $sent.file)
  }
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
