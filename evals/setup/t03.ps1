param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'files'
  $f = Join-Path $dir 'report-q7.txt'
  [IO.File]::WriteAllText($f, 'Q7 report body 12345', [Text.Encoding]::ASCII)
  # Unrelated sentinel: a correct rename must not touch it, and the directory
  # must not gain duplicate/near-miss names (e.g. report-q7-final.txt.txt).
  $keep = Join-Path $dir 'keep.txt'
  [IO.File]::WriteAllText($keep, 'KEEP-S4-T03', [Text.Encoding]::ASCII)
  Remove-Item (Join-Path $dir 'report-q7-final.txt') -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $dir 'report-q7-final.txt.txt') -Force -ErrorAction SilentlyContinue
  # State-scoped pre-stage: require a NEW Explorer HWND; never close user windows.
  $stateFile = Join-Path (Get-TaskDir) 'test-explorer.json'
  $s = Open-TestExplorer -Path $dir -TitleNeedle @('files') -StateFile $stateFile
  $checks += (Add-Check 'report-q7.txt prepared' (Test-Path $f) $f)
  $checks += (Add-Check 'keep.txt sentinel prepared' ((Test-Path $keep) -and ([IO.File]::ReadAllText($keep) -eq 'KEEP-S4-T03')) $keep)
  $checks += (Add-Check 'explorer parked at files dir' ([bool]$s.ok) ("hwnd=$($s.hwnd) title=$($s.title) reason=$($s.reason)"))
  Out-Finish -Ok ((Test-Path $f) -and [bool]$s.ok) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
