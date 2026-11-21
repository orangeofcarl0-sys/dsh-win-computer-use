param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $ppt = Close-TestAppWindow -StateFile (Join-Path $base 'ppt.json')
  if (-not $ppt.closed) {
    $checks += (Add-Check 'test PowerPoint window left open' $false ("reason=$($ppt.reason) title=$($ppt.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile (Join-Path $base 'ppt.json') -Result ([ordered]@{ reason = $ppt.reason; leftover = $ppt.title }))
    $dirty = $true
  }
  $excel = Close-TestAppWindow -StateFile (Join-Path $base 'excel.json')
  if (-not $excel.closed) {
    $checks += (Add-Check 'test Excel window left open' $false ("reason=$($excel.reason) title=$($excel.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile (Join-Path $base 'excel.json') -Result ([ordered]@{ reason = $excel.reason; leftover = $excel.title }))
    $dirty = $true
  }
  $viewer = Close-TestBrowserWindow -StateFile (Join-Path $base 'viewer.json')
  if (-not $viewer.closed) {
    $checks += (Add-Check 'PDF browser window left open' $false ("reason=$($viewer.reason) title=$($viewer.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile (Join-Path $base 'viewer.json') -Result ([ordered]@{ reason = $viewer.reason; leftover = $viewer.title }))
    $dirty = $true
  }
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
