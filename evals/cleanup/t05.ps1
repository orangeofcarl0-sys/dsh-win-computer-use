param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $stateFile = Join-Path (Get-TaskDir) 'test-notepad.json'
  $r = Close-TestNotepad -StateFile $stateFile
  if ($r.leftover) {
    $checks += (Add-Check 'leftover notepad window left open' $true ([string]$r.leftover + ' — ' + [string]$r.reason))
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
