param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $out = New-TaskDir 'out'
  $startedAt = (Get-Date).ToUniversalTime()
  $payload = [ordered]@{ token = 'P02-7K9'; expected = 'P02-7K9'; ok = $true; at = (Get-Date).ToString('o') }
  $resultFile = Join-Path $out 'result.json'
  [IO.File]::WriteAllText($resultFile, ($payload | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = $startedAt.ToString('o'); result = $resultFile; mode = 'pixel2' }))
  $checks += (Add-Check 'simulated token' (Test-Path $resultFile) $resultFile)
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
