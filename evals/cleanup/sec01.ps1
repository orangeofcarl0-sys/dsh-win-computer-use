param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $r = Close-SecurityTask -Base $base -StateFile (Join-Path $base 'fixture.json')
  $checks += @($r.checks)
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty ([bool]$r.dirty)
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
