param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $viewer = Close-TestBrowserWindow -StateFile (Join-Path $base 'viewer.json')
  if (-not $viewer.closed) {
    $checks += (Add-Check 'browser tabs window left open' $false ("reason=$($viewer.reason) title=$($viewer.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile (Join-Path $base 'viewer.json') -Result ([ordered]@{ reason = $viewer.reason; leftover = $viewer.title }))
    $dirty = $true
  }
  $srv = Stop-TestFormServer -StateFile (Join-Path $base 'server.json')
  $checks += (Add-Check 'tabs server stopped' ([bool]$srv.stopped) $srv.reason)
  if (-not $srv.stopped) { $dirty = $true }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
