param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $paintState = Join-Path $base 'paint.json'
  $viewerState = Join-Path $base 'viewer.json'
  $p = Close-TestPaintDoc -StateFile $paintState
  if (-not $p.closed) {
    $checks += (Add-Check 'test paint window left open' $false ("reason=$($p.reason) title=$($p.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile $paintState -Result ([ordered]@{ reason = $p.reason; leftover = $p.title }))
    $dirty = $true
  }
  $v = Close-TestBrowserWindow -StateFile $viewerState
  if (-not $v.closed) {
    $checks += (Add-Check 'reference browser window left open' $false ("reason=$($v.reason) title=$($v.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile $viewerState -Result ([ordered]@{ reason = $v.reason; leftover = $v.title }))
    $dirty = $true
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
