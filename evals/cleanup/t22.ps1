param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $ppt = Close-TestAppWindow -StateFile (Join-Path $base 'ppt.json')
  if (-not $ppt.closed) {
    [void](Save-LeftoverState -TaskId $TaskId -StateFile (Join-Path $base 'ppt.json') -Result ([ordered]@{ reason = $ppt.reason; leftover = $ppt.title }))
    $dirty = $true
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
