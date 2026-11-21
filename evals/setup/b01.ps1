param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $web = New-TaskDir 'web'
  $out = New-TaskDir 'out'
  $result = Join-Path $out 'result.json'
  $srv = Start-TestFormServer -Root $web -ResultFile $result -StateFile (Join-Path $base 'server.json') -Mode 'tabs'
  $checks += (Add-Check 'local tabs server' ([bool]$srv.ok) ("port=$($srv.port) reason=$($srv.reason)"))
  if (-not $srv.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ('tabs server unavailable: ' + $srv.reason) }
  $url = "http://127.0.0.1:$($srv.port)/"
  $viewer = Open-TestBrowserWindow -Url $url -TitleNeedle 'S4-B01-TABS' -StateFile (Join-Path $base 'viewer.json')
  $checks += (Add-Check 'browser tabs page' ([bool]$viewer.ok) ("hwnd=$($viewer.hwnd) title=$($viewer.title) reason=$($viewer.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = (Get-Date).ToUniversalTime().ToString('o'); result = $result }))
  if (-not $viewer.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ('browser unavailable: ' + $viewer.reason) }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
