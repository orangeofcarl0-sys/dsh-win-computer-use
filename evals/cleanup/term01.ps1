param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $w = Close-TestAppWindow -StateFile (Join-Path $base 'term.json')
  if (-not $w.closed) {
    $checks += (Add-Check 'PowerShell console left open' $false ("reason=$($w.reason) title=$($w.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile (Join-Path $base 'term.json') -Result ([ordered]@{ reason = $w.reason; leftover = $w.title }))
    $dirty = $true
  }
  $orphan = Close-OrphanTestNotepads -ExtraAllowedTabs @('term.txt') -ExtraSeeds @('term.txt')
  $left = @($orphan.leftover)
  $checks += (Add-Check 'orphan test notepad cleaned' ($left.Count -eq 0) ("closed=$($orphan.closed) leftover=$($left -join ' | ')"))
  if ($left.Count -gt 0) { $dirty = $true }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
