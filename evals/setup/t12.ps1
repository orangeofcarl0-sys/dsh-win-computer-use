param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $outDir = New-TaskDir 'out'
  $refPath = Join-Path $base 's4-t12-ref.png'
  if (Test-Path $refPath) { Remove-Item $refPath -Force }
  New-PptReferencePng $refPath 'S4-T12'

  $outPptx = Join-Path $outDir 'replica.pptx'
  if (Test-Path $outPptx) { Remove-Item $outPptx -Force }
  $seed = New-S4WidescreenPptxSeed $outPptx
  $checks += (Add-Check '16:9 PowerPoint seed' ([bool]$seed.ok) ("$($seed.reason) slideCount=$($seed.slideCount) size=$($seed.widthIn)x$($seed.heightIn)"))
  if (-not $seed.ok) {
    Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("PowerPoint seed unavailable: " + $seed.reason)
  }
  $seedHash = Get-S4Sha256 $outPptx
  $startedAt = (Get-Date).ToUniversalTime()

  $viewerState = Join-Path $base 'viewer.json'
  $pptState = Join-Path $base 'ppt.json'
  $pptExe = Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\POWERPNT.EXE'
  $ppt = [ordered]@{ ok = $false; hwnd = 0; title = ''; reason = "not found: $pptExe" }
  if (Test-Path $pptExe) {
    $ppt = Open-TestAppWindow -Exe $pptExe -Arguments @($outPptx) -ProcessName 'POWERPNT' -TitleNeedle @('replica') -StateFile $pptState -TimeoutSec 30
    if ($ppt.ok) { Maximize-TestWindow ([int]$ppt.hwnd) }
  }
  $checks += (Add-Check 'PowerPoint test window' ([bool]$ppt.ok) ("hwnd=$($ppt.hwnd) title=$($ppt.title) reason=$($ppt.reason)"))
  $url = [System.Uri]::new($refPath).AbsoluteUri
  $viewer = Open-TestBrowserWindow -Url $url -TitleNeedle 's4-t12-ref' -StateFile $viewerState
  $checks += (Add-Check 'reference browser window' ([bool]$viewer.ok) ("hwnd=$($viewer.hwnd) title=$($viewer.title) reason=$($viewer.reason)"))
  $checks += (Add-Check 'seed unchanged before run' ((Get-S4Sha256 $outPptx) -eq $seedHash) $outPptx)

  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = $startedAt.ToString('o'); ref = $refPath
    seed = $outPptx; seedHash = $seedHash
  }))
  $ok = [bool]$viewer.ok -and [bool]$ppt.ok
  $envErr = ''
  if (-not $ok) { $envErr = "PowerPoint/browser unavailable: $($viewer.reason) $($ppt.reason)" }
  Out-Finish -Ok $ok -Checks $checks -Kind 'setup' -EnvError $envErr
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
