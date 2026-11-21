param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $r = Close-SecurityTask -Base $base -StateFile (Join-Path $base 'fixture.json')
  $checks += @($r.checks)
  if ($r.dirty) { $dirty = $true }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
