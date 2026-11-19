param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = Join-Path (Get-TaskDir) 'files'
  $old = Join-Path $dir 'report-q7.txt'
  $new = Join-Path $dir 'report-q7-final.txt'
  $keep = Join-Path $dir 'keep.txt'
  $oldGone = -not (Test-Path $old)
  $newThere = (Test-Path $new)
  $checks += (Add-Check 'old name gone' $oldGone $old)
  $checks += (Add-Check 'new name exists' $newThere $new)
  $same = $false
  if ($newThere) {
    $norm = ([IO.File]::ReadAllText($new)) -replace "`r`n", "`n"
    $same = ($norm.Trim() -eq 'Q7 report body 12345')
  }
  $checks += (Add-Check 'content unchanged' $same '')

  # Exactly two files: the renamed report and the unrelated sentinel. This
  # catches report-q7-final.txt.txt, copies, and other accidental artifacts.
  $names = @(Get-ChildItem -Path $dir -File -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty Name | Sort-Object)
  $expectedNames = @('keep.txt', 'report-q7-final.txt')
  $checks += (Add-Check 'file set exact' (($names -join ',') -eq ($expectedNames -join ',')) ($names -join ','))
  $keepSame = (Test-Path $keep) -and (([IO.File]::ReadAllText($keep)).Trim() -eq 'KEEP-S4-T03')
  $checks += (Add-Check 'keep.txt unchanged' $keepSame '')
  $nearMiss = Test-Path (Join-Path $dir 'report-q7-final.txt.txt')
  $checks += (Add-Check 'no double extension' (-not $nearMiss) 'report-q7-final.txt.txt')

  Out-Finish -Ok ($oldGone -and $newThere -and $same -and $keepSame -and (-not $nearMiss) -and (($names -join ',') -eq ($expectedNames -join ','))) -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
