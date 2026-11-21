param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $word = Close-TestAppWindow -StateFile (Join-Path $base 'word.json')
  if (-not $word.closed) {
    [void](Save-LeftoverState -TaskId $TaskId -StateFile (Join-Path $base 'word.json') -Result ([ordered]@{ reason = $word.reason; leftover = $word.title }))
    $dirty = $true
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
