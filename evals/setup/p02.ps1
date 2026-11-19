param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $web = New-TaskDir 'web'
  $out = New-TaskDir 'out'
  $stateDir = New-TaskDir 'state'
  $serverState = Join-Path $stateDir 'server.json'
  $resultFile = Join-Path $out 'result.json'
  if (Test-Path $resultFile) { Remove-Item $resultFile -Force }
  $startedAt = (Get-Date).ToUniversalTime()
  $srv = Start-TestFormServer -Root $web -ResultFile $resultFile -StateFile $serverState -Mode 'pixel2'
  $checks += (Add-Check 'token server' ([bool]$srv.ok) ("pid=$($srv.pid) port=$($srv.port) reason=$($srv.reason)"))
  if (-not $srv.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("token server unavailable: " + $srv.reason) }
  $url = ('http://127.0.0.1:' + [int]$srv.port + '/')
  $browserState = Join-Path $base 'browser.json'
  $b = Open-TestBrowserWindow -Url $url -TitleNeedle 'S4-P02-TOKEN' -StateFile $browserState
  $checks += (Add-Check 'browser test window' ([bool]$b.ok) ("hwnd=$($b.hwnd) title=$($b.title) reason=$($b.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = $startedAt.ToString('o'); port = [int]$srv.port; result = $resultFile; mode = 'pixel2'
  }))
  if (-not $b.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("browser unavailable: " + $b.reason) }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
