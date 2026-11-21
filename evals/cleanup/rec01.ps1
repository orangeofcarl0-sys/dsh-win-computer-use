param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $orphan = Close-OrphanTestNotepads -ExtraAllowedTabs @('draft.txt', 'final.txt') -ExtraSeeds @('draft.txt')
  $left = @($orphan.leftover)
  $checks += (Add-Check 'orphan test notepad cleaned' ($left.Count -eq 0) ("closed=$($orphan.closed) leftover=$($left -join ' | ')"))
  if ($left.Count -gt 0) { $dirty = $true }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
