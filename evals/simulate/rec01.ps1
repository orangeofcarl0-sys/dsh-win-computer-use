param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $final = Join-Path $base 'final.txt'
  [IO.File]::WriteAllText($final, "S4 REC01 DRAFT`r`nS4 REC01 RECOVERED`r`n", (New-Object System.Text.UTF8Encoding($false)))
  $checks += (Add-Check 'simulated recovered file' (Test-Path $final) $final)
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
