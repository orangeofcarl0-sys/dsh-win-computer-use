param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $stateFile = Join-Path $base 'excel.json'
  $x = Close-TestAppWindow -StateFile $stateFile
  if (-not $x.closed) {
    $checks += (Add-Check 'test Excel window left open' $false ("reason=$($x.reason) title=$($x.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile $stateFile -Result ([ordered]@{ reason = $x.reason; leftover = $x.title }))
    $dirty = $true
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
