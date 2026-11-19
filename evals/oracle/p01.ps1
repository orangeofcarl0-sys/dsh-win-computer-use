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
  $hit = [bool]$r.hit
  $cell = [string]$r.cell
  $target = [string]$r.target
  $checks += (Add-Check 'target cell is C2' ($target -eq 'C2') ("target=$target"))
  $checks += (Add-Check 'clicked cell is C2' ($cell -eq 'C2') ("cell=$cell"))
  $checks += (Add-Check 'hit is true' $hit ("hit=$hit"))
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
