param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $out = New-TaskDir 'out'
  $result = Join-Path $out 'result.json'
  $payload = [ordered]@{ mode = 'click'; clicks = 1; pwdLength = 0; normalText = ''; at = (Get-Date).ToString('o') }
  [IO.File]::WriteAllText($result, ($payload | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  $checks += (Add-Check 'simulated stop/resume result' (Test-Path $result) $result)
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
