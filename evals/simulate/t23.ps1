param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $out = New-TaskDir 'out'
  $startedAt = (Get-Date).ToUniversalTime()
  $payload = [ordered]@{ cancelled = 1; confirmed = 1; nestedCancelled = 0; archived = $true; at = (Get-Date).ToString('o') }
  $resultFile = Join-Path $out 'result.json'
  [IO.File]::WriteAllText($resultFile, ($payload | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = $startedAt.ToString('o'); result = $resultFile; isolation = (Get-IsolationMode) }))
  $checks += (Add-Check 'simulated dialog result' (Test-Path $resultFile) $resultFile)
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
