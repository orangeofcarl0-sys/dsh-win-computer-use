param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if ($state) {
    $removed = @(Remove-S4MatchedDownloadsAny -Dir (Get-S4DownloadsDir) -StartedAt ([datetime]::Parse([string]$state.startedAt).ToUniversalTime()) -ExpectedHash ([string]$state.csvHash) -Filter '*.csv')
    $checks += (Add-Check 'matched CSV downloads removed' ($removed.Count -ge 0) ("removed=$($removed.Count)"))
  }
  $excel = Close-TestAppWindow -StateFile (Join-Path $base 'excel.json')
  if (-not $excel.closed) {
    $checks += (Add-Check 'test Excel window left open' $false ("reason=$($excel.reason) title=$($excel.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile (Join-Path $base 'excel.json') -Result ([ordered]@{ reason = $excel.reason; leftover = $excel.title }))
    $dirty = $true
  }
  $viewer = Close-TestBrowserWindow -StateFile (Join-Path $base 'viewer.json')
  if (-not $viewer.closed) {
    $checks += (Add-Check 'download browser window left open' $false ("reason=$($viewer.reason) title=$($viewer.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile (Join-Path $base 'viewer.json') -Result ([ordered]@{ reason = $viewer.reason; leftover = $viewer.title }))
    $dirty = $true
  }
  $srv = Stop-TestFormServer -StateFile (Join-Path $base 'server.json')
  $checks += (Add-Check 'CSV server stopped' ([bool]$srv.stopped) $srv.reason)
  if (-not $srv.stopped) { $dirty = $true }
  $sent = Close-TestSentinel -StateFile (Join-Path $base 'sentinel.json')
  $checks += (Add-Check 'sentinel closed' ([bool]$sent.closed) $sent.reason)
  if (-not $sent.closed) {
    [void](Save-LeftoverState -TaskId $TaskId -StateFile (Join-Path $base 'sentinel.json') -Result ([ordered]@{ reason = $sent.reason; leftover = $sent.title }))
    $dirty = $true
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
