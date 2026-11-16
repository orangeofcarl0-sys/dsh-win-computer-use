param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $viewerState = Join-Path $base 'viewer.json'
  $v = Close-TestBrowserWindow -StateFile $viewerState
  if (-not $v.closed) {
    $checks += (Add-Check 'PDF browser window left open' $false ("reason=$($v.reason) title=$($v.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile $viewerState -Result ([ordered]@{ reason = $v.reason; leftover = $v.title }))
    $dirty = $true
  }
  $excelState = Join-Path $base 'excel.json'
  $x = Close-TestAppWindow -StateFile $excelState
  if (-not $x.closed) {
    $checks += (Add-Check 'test Excel window left open' $false ("reason=$($x.reason) title=$($x.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile $excelState -Result ([ordered]@{ reason = $x.reason; leftover = $x.title }))
    $dirty = $true
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
