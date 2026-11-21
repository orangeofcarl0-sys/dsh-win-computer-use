param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $out = New-TaskDir 'out'
  $result = Join-Path $out 'result.json'
  $payload = [ordered]@{ name = 'S4 B01'; notes = 'TAB B'; at = (Get-Date).ToString('o') }
  [IO.File]::WriteAllText($result, ($payload | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = (Get-Date).ToUniversalTime().ToString('o'); result = $result }))
  $checks += (Add-Check 'simulated tabs form' (Test-Path $result) $result)
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
