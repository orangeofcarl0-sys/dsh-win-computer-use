param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $w = Close-TestAppWindow -StateFile (Join-Path $base 'app.json')
  if (-not $w.closed) {
    $checks += (Add-Check 'accessibility fixture left open' $false ("reason=$($w.reason) title=$($w.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile (Join-Path $base 'app.json') -Result ([ordered]@{ reason = $w.reason; leftover = $w.title }))
    $dirty = $true
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
