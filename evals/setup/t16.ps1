param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $sentinelState = Join-Path (Get-TaskDir) 'sentinel.json'
  $sent = Open-TestSentinel -TaskId $TaskId -StateFile $sentinelState
  $checks += (Add-Check 'sentinel opened' ([bool]$sent.ok) ("hwnd=$($sent.hwnd) pid=$($sent.pid) reason=$($sent.reason)"))
  if (-not $sent.ok) {
    Out-Finish -Ok $false -Checks $checks -EnvError ('sentinel unavailable: ' + $sent.reason) -Kind 'setup'
  }
  $base = Get-TaskDir
  $web = New-TaskDir 'web'
  $out = New-TaskDir 'out'
  $stateDir = New-TaskDir 'state'
  $serverState = Join-Path $stateDir 'server.json'
  $resultFile = Join-Path $out 'result.json'
  if (Test-Path $resultFile) { Remove-Item $resultFile -Force }
  $startedAt = (Get-Date).ToUniversalTime()
  $srv = Start-TestFormServer -Root $web -ResultFile $resultFile -StateFile $serverState
  $checks += (Add-Check 'local form server' ([bool]$srv.ok) ("pid=$($srv.pid) port=$($srv.port) reason=$($srv.reason)"))
  if (-not $srv.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("form server unavailable: " + $srv.reason) }

  $url = ('http://127.0.0.1:' + [int]$srv.port + '/form.html')
  $browserState = Join-Path $base 'browser.json'
  $b = Open-TestBrowserWindow -Url $url -TitleNeedle 'S4-T16-FORM' -StateFile $browserState
  $checks += (Add-Check 'browser test window' ([bool]$b.ok) ("hwnd=$($b.hwnd) title=$($b.title) reason=$($b.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = $startedAt.ToString('o'); port = [int]$srv.port; result = $resultFile
  }))
  if (-not $b.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("browser unavailable: " + $b.reason) }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
