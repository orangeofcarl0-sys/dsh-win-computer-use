param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $stateFile = Join-Path $base 'dialog.json'
  $w = Close-TestAppWindow -StateFile $stateFile
  if (-not $w.closed) {
    $checks += (Add-Check 'dialog app window left open' $false ("reason=$($w.reason) title=$($w.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile $stateFile -Result ([ordered]@{ reason = $w.reason; leftover = $w.title }))
    $dirty = $true
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
