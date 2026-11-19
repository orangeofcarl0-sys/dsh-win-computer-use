param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $browserState = Join-Path $base 'browser.json'
  $b = Close-TestBrowserWindow -StateFile $browserState
  if (-not $b.closed) {
    $checks += (Add-Check 'test browser window left open' $false ("reason=$($b.reason) title=$($b.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile $browserState -Result ([ordered]@{ reason = $b.reason; leftover = $b.title }))
    $dirty = $true
  }
  $serverState = Join-Path $base 'state\server.json'
  $srv = Stop-TestFormServer -StateFile $serverState
  if (-not $srv.stopped) {
    $checks += (Add-Check 'zoom server not stopped' $false ("reason=$($srv.reason)"))
    $dirty = $true
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
