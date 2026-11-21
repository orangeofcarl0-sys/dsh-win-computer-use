param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $out = New-TaskDir 'out'
  $result = Join-Path $out 'result.json'
  $payload = [ordered]@{ text = 'S4 A11Y OK'; submitted = $true; at = (Get-Date).ToString('o') }
  [IO.File]::WriteAllText($result, ($payload | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  $checks += (Add-Check 'simulated keyboard result' (Test-Path $result) $result)
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
