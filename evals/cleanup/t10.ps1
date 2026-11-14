param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  foreach ($name in @('test-notepad.json', 'test-notepad-2.json')) {
    $stateFile = Join-Path (Get-TaskDir) $name
    $r = Close-TestNotepad -StateFile $stateFile
    if (-not $r.closed -and $r.reason -ne 'window already gone') {
      $left = Save-LeftoverState -TaskId $TaskId -StateFile $stateFile -Result $r
      $labels = @($r.tabs | ForEach-Object { $_.label }) -join ','
      $checks += (Add-Check 'unsafe notepad window left open' $false ("$name reason=$($r.reason) tabs=$labels leftoverFile=$left"))
      $dirty = $true
    }
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
