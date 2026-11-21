param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $seed = [string]$state.seed
  $out = [string]$state.output
  $checks += (Add-Check 'source seed unchanged' ((Get-S4Sha256Shared $seed) -eq [string]$state.seedHash) $seed)
  if (-not (Test-Path $out)) { Out-Finish -Ok $false -Checks @((Add-Check 'output exists' $false $out)) }
  $checks += (Add-Check 'output exists' $true $out)
  $m = Read-DocxManifest $out
  $text = (([string]$m.text) -replace "`r`n", "`n").Trim()
  $checks += (Add-Check 'seed text retained' ($text.IndexOf('S4 W02 seed', [System.StringComparison]::Ordinal) -ge 0) $text)
  $checks += (Add-Check 'saved text present' ($text.IndexOf('S4 W02 saved', [System.StringComparison]::Ordinal) -ge 0) $text)
  $checks += (Add-Check 'source and output differ' ((Get-S4Sha256Shared $seed) -ne (Get-S4Sha256 $out)) '')
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
