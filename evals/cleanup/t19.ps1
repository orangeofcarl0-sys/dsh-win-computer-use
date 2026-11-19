param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $stateFile = Join-Path $base 'explorer.json'
  $e = Close-TestExplorer -StateFile $stateFile
  if (-not $e.closed) {
    $checks += (Add-Check 'test Explorer window left open' $false ("reason=$($e.reason) title=$($e.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile $stateFile -Result ([ordered]@{ reason = $e.reason; leftover = $e.title }))
    $dirty = $true
  }
  $orphan = Close-OrphanTestNotepads -ExtraAllowedTabs @('target.txt', 'NAV-OK') -ExtraSeeds @('target.txt')
  $left = @($orphan.leftover)
  $checks += (Add-Check 'orphan test notepad cleaned' ($left.Count -eq 0) ("closed=$($orphan.closed) leftover=$($left -join ' | ')"))
  if ($left.Count -gt 0) { $dirty = $true }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
