param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $stateFile = Join-Path (Get-TaskDir) 'test-explorer.json'
  $r = Close-TestExplorer -StateFile $stateFile
  if (-not $r.closed) {
    $checks += (Add-Check 'test explorer window left open' $false ("reason=$($r.reason) title=$($r.title)"))
    $dirty = $true
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
