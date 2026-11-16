param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  [void](New-TaskDir 'out')
  # Put both inputs directly in task_dir: the previous seed\ subdirectory made
  # the model guess a path and retry file-open navigation before drawing.
  $refPath = Join-Path $base 's4-t11-ref.png'
  $canvas = Join-Path $base 's4-t11-canvas.png'
  if (Test-Path $refPath) { Remove-Item $refPath -Force }
  if (Test-Path $canvas) { Remove-Item $canvas -Force }
  New-PaintReferencePng $refPath
  New-TestBlankPng $canvas 800 600
  $startedAt = (Get-Date).ToUniversalTime()

  $viewerState = Join-Path $base 'viewer.json'
  $paintState = Join-Path $base 'paint.json'
  # Open Paint first, reference browser last: the reference is readable on entry,
  # and the Paint window stays open behind it for computer_activate.
  $paint = Open-TestPaintDoc -SeedPath $canvas -TitleNeedle 's4-t11-canvas' -StateFile $paintState
  if ($paint.ok) { Maximize-TestWindow ([int]$paint.hwnd) }
  $checks += (Add-Check 'paint test window' ([bool]$paint.ok) ("hwnd=$($paint.hwnd) title=$($paint.title) reason=$($paint.reason)"))
  $url = [System.Uri]::new($refPath).AbsoluteUri
  $viewer = Open-TestBrowserWindow -Url $url -TitleNeedle 's4-t11-ref' -StateFile $viewerState
  $checks += (Add-Check 'reference browser window' ([bool]$viewer.ok) ("hwnd=$($viewer.hwnd) title=$($viewer.title) reason=$($viewer.reason)"))

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
