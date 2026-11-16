param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $out = New-TaskDir 'out'
  $startedAt = (Get-Date).ToUniversalTime()
  $result = [ordered]@{
    name = 'Ada Lovelace'
    email = 'ada@example.com'
    plan = 'Pro'
    contact = 'Email'
    newsletter = $true
    notes = 'S4-T16'
    at = (Get-Date).ToString('o')
  }
  [IO.File]::WriteAllText((Join-Path $out 'result.json'), ($result | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = $startedAt.ToString('o'); result = (Join-Path $out 'result.json') }))
  $checks += (Add-Check 'simulated result' (Test-Path (Join-Path $out 'result.json')) '')
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
