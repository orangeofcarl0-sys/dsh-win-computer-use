param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $refDir = New-TaskDir 'ref'
  [void](New-TaskDir 'out')
  $seedDir = New-TaskDir 'seed'
  $refPath = Join-Path $refDir 's4-t11-ref.png'
  $canvas = Join-Path $seedDir 's4-t11-canvas.png'
  if (Test-Path $refPath) { Remove-Item $refPath -Force }
  if (Test-Path $canvas) { Remove-Item $canvas -Force }
  New-PaintReferencePng $refPath
  New-TestBlankPng $canvas 800 600
  $startedAt = (Get-Date).ToUniversalTime()

  $viewerState = Join-Path $base 'viewer.json'
  $paintState = Join-Path $base 'paint.json'
  $url = [System.Uri]::new($refPath).AbsoluteUri
  $viewer = Open-TestBrowserWindow -Url $url -TitleNeedle 's4-t11-ref' -StateFile $viewerState
  $checks += (Add-Check 'reference browser window' ([bool]$viewer.ok) ("hwnd=$($viewer.hwnd) title=$($viewer.title) reason=$($viewer.reason)"))
  $paint = Open-TestPaintDoc -SeedPath $canvas -TitleNeedle 's4-t11-canvas' -StateFile $paintState
  $checks += (Add-Check 'paint test window' ([bool]$paint.ok) ("hwnd=$($paint.hwnd) title=$($paint.title) reason=$($paint.reason)"))

  $state = [ordered]@{
    startedAt = $startedAt.ToString('o')
    ref = $refPath
    canvas = $canvas
  }
  [void](Write-TestState (Join-Path $base 'state.json') $state)
  $ok = [bool]$viewer.ok -and [bool]$paint.ok
  $envErr = ''
  if (-not $ok) { $envErr = "Paint/browser unavailable: $($viewer.reason) $($paint.reason)" }
  Out-Finish -Ok $ok -Checks $checks -Kind 'setup' -EnvError $envErr
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
