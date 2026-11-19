param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $nav = New-TaskDir 'nav'
  $target = Join-Path $nav 'target.txt'
  [IO.File]::WriteAllText($target, 'NAV-OK', (New-Object System.Text.UTF8Encoding($false)))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = (Get-Date).ToUniversalTime().ToString('o'); target = $target }))
  $checks += (Add-Check 'simulated target' (Test-Path $target) $target)
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
