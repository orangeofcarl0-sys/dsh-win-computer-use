param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $sent = Open-TestSentinel -TaskId $TaskId -StateFile (Join-Path $base 'sentinel.json')
  $checks += (Add-Check 'sentinel opened' ([bool]$sent.ok) ("hwnd=$($sent.hwnd) reason=$($sent.reason)"))
  if (-not $sent.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ('sentinel unavailable: ' + $sent.reason) }
  $web = New-TaskDir 'web'
  $out = New-TaskDir 'out'
  $result = Join-Path $out 'result.json'
  $fixture = Join-Path $PSScriptRoot '..\fixtures\t18-download.pdf'
  if (-not (Test-Path $fixture)) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError 't18 PDF fixture missing' }
  $expectedHash = Get-S4Sha256 $fixture
  $srv = Start-TestFormServer -Root $web -ResultFile $result -StateFile (Join-Path $base 'server.json') -Mode 'download-flaky' -Fixture $fixture -FailFirst
  $checks += (Add-Check 'flaky download server' ([bool]$srv.ok) ("port=$($srv.port) reason=$($srv.reason)"))
  if (-not $srv.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ('server unavailable: ' + $srv.reason) }
  $url = "http://127.0.0.1:$($srv.port)/"
  $viewer = Open-TestBrowserWindow -Url $url -TitleNeedle 'S4-REC03-FLAKY' -StateFile (Join-Path $base 'viewer.json')
  $checks += (Add-Check 'browser download page' ([bool]$viewer.ok) ("hwnd=$($viewer.hwnd) title=$($viewer.title) reason=$($viewer.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = (Get-Date).ToUniversalTime().ToString('o'); expectedHash = $expectedHash; fixture = $fixture
  }))
  $ok = [bool]$srv.ok -and [bool]$viewer.ok
  $envErr = ''
  if (-not $ok) { $envErr = "server/browser unavailable: $($srv.reason) $($viewer.reason)" }
  Out-Finish -Ok $ok -Checks $checks -Kind 'setup' -EnvError $envErr
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
