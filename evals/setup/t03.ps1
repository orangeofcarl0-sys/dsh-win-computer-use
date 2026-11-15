param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'files'
  $f = Join-Path $dir 'report-q7.txt'
  [IO.File]::WriteAllText($f, 'Q7 report body 12345', [Text.Encoding]::ASCII)
  Remove-Item (Join-Path $dir 'report-q7-final.txt') -Force -ErrorAction SilentlyContinue
  # State-scoped pre-stage: require a NEW Explorer HWND; never close user windows.
  $stateFile = Join-Path (Get-TaskDir) 'test-explorer.json'
  $s = Open-TestExplorer -Path $dir -TitleNeedle @('files') -StateFile $stateFile
  $checks += (Add-Check 'report-q7.txt prepared' (Test-Path $f) $f)
  $checks += (Add-Check 'explorer parked at files dir' ([bool]$s.ok) ("hwnd=$($s.hwnd) title=$($s.title) reason=$($s.reason)"))
  Out-Finish -Ok ((Test-Path $f) -and [bool]$s.ok) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
