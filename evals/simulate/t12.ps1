param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks $checks -EnvError 'state file missing' -Kind 'simulate' }
  $fixture = Join-Path $PSScriptRoot '..\fixtures\t12-replica.pptx'
  if (-not (Test-Path $fixture)) { Out-Finish -Ok $false -Checks $checks -EnvError 't12 fixture missing' -Kind 'simulate' }
  $outDir = New-TaskDir 'out'
  $out = Join-Path $outDir 'replica.pptx'
  # Setup opens the seed/output path in PowerPoint. AC2 simulate must close that
  # test-owned window before replacing the file; otherwise Windows keeps it locked.
  $pptState = Join-Path $base 'ppt.json'
  $closed = Close-TestAppWindow -StateFile $pptState
  $checks += (Add-Check 'setup PowerPoint closed for simulate' ([bool]$closed.closed) $closed.reason)
  if (-not $closed.closed) {
    Out-Finish -Ok $false -Checks $checks -EnvError ('cannot close setup PowerPoint: ' + $closed.reason) -Kind 'simulate'
  }
  Copy-Item $fixture $out -Force
  (Get-Item $out).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  $outHash = Get-S4Sha256 $out
  $checks += (Add-Check 'fixture differs from seed' ($outHash -ne [string]$state.seedHash) ("seed=$($state.seedHash) out=$outHash"))
  $checks += (Add-Check 'simulated replica' (Test-Path $out) $out)
  Out-Finish -Ok ($outHash -ne [string]$state.seedHash) -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
