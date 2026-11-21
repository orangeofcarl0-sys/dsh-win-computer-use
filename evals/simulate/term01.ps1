param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $out = New-TaskDir 'out'
  $file = Join-Path $out 'term.txt'
  [IO.File]::WriteAllText($file, 'S4 TERM OK', (New-Object System.Text.UTF8Encoding($false)))
  $checks += (Add-Check 'simulated term output' (Test-Path $file) $file)
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
