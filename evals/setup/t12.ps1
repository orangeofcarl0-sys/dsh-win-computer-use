param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $refDir = New-TaskDir 'ref'
  [void](New-TaskDir 'out')
  $refPath = Join-Path $refDir 's4-t12-ref.png'
  if (Test-Path $refPath) { Remove-Item $refPath -Force }
  New-PptReferencePng $refPath 'S4-T12'
  $startedAt = (Get-Date).ToUniversalTime()

  $viewerState = Join-Path $base 'viewer.json'
  $pptState = Join-Path $base 'ppt.json'
  $url = [System.Uri]::new($refPath).AbsoluteUri
  $viewer = Open-TestBrowserWindow -Url $url -TitleNeedle 's4-t12-ref' -StateFile $viewerState
  $checks += (Add-Check 'reference browser window' ([bool]$viewer.ok) ("hwnd=$($viewer.hwnd) title=$($viewer.title) reason=$($viewer.reason)"))

  $pptExe = Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\POWERPNT.EXE'
  $ppt = [ordered]@{ ok = $false; hwnd = 0; title = ''; reason = "not found: $pptExe" }
  if (Test-Path $pptExe) {
    $ppt = Open-TestAppWindow -Exe $pptExe -Arguments @('/N') -ProcessName 'POWERPNT' -TitleNeedle @() -StateFile $pptState -TimeoutSec 30
  }
  $checks += (Add-Check 'PowerPoint test window' ([bool]$ppt.ok) ("hwnd=$($ppt.hwnd) title=$($ppt.title) reason=$($ppt.reason)"))

  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = $startedAt.ToString('o'); ref = $refPath
  }))
  $ok = [bool]$viewer.ok -and [bool]$ppt.ok
  $envErr = ''
  if (-not $ok) { $envErr = "PowerPoint/browser unavailable: $($viewer.reason) $($ppt.reason)" }
  Out-Finish -Ok $ok -Checks $checks -Kind 'setup' -EnvError $envErr
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
