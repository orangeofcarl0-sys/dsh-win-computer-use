param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  [void](New-TaskDir 'nav')
  $target = Join-Path $base 'nav\target.txt'
  if (Test-Path $target) { Remove-Item $target -Force }
  $homeDir = [Environment]::GetFolderPath('UserProfile')
  $stateFile = Join-Path $base 'explorer.json'
  $e = Open-TestExplorer -Path $homeDir -TitleNeedle @($env:USERNAME, 'Users') -StateFile $stateFile
  $checks += (Add-Check 'explorer opened at user profile' ([bool]$e.ok) ("hwnd=$($e.hwnd) title=$($e.title) reason=$($e.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = (Get-Date).ToUniversalTime().ToString('o'); target = $target; home = $homeDir }))
  if (-not $e.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("explorer unavailable: " + $e.reason) }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
