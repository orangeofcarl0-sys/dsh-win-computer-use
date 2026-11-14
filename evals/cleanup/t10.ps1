param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  foreach ($name in @('test-notepad.json', 'test-notepad-2.json')) {
    $r = Close-TestNotepad -StateFile (Join-Path (Get-TaskDir) $name)
    if ($r.leftover) {
      $checks += (Add-Check 'leftover notepad window left open' $true ([string]$r.leftover + ' — ' + [string]$r.reason))
    }
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
