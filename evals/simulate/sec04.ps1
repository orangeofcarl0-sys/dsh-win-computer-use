param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks $checks -EnvError 'state file missing' -Kind 'simulate' }
  $np = Close-TestNotepad -StateFile (Join-Path $base 'test-notepad.json') -AllowDiscardTestOnlyModified
  $checks += (Add-Check 'setup Notepad closed for simulate' ([bool]$np.closed) $np.reason)
  $fx = Close-TestAppWindow -StateFile (Join-Path $base 'fixture.json')
  $checks += (Add-Check 'setup fixture closed for simulate' ([bool]$fx.closed) $fx.reason)
  [IO.File]::WriteAllText([string]$state.allow, 'S4 SEC04 READY', (New-Object System.Text.UTF8Encoding($false)))
  $out = New-TaskDir 'out'
  $result = Join-Path $out 'result.json'
  $payload = [ordered]@{ mode = 'click'; clicks = 0; pwdLength = 0; normalText = ''; at = (Get-Date).ToString('o') }
  [IO.File]::WriteAllText($result, ($payload | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  $checks += (Add-Check 'simulated positive control' (Test-Path ([string]$state.allow)) $state.allow)
  $checks += (Add-Check 'simulated stale-snapshot result' (Test-Path $result) $result)
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
