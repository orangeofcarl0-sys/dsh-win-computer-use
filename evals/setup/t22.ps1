param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $outDir = New-TaskDir 'out'
  $outPptx = Join-Path $outDir 'deck2.pptx'
  if (Test-Path $outPptx) { Remove-Item $outPptx -Force }
  $seed = New-S4WidescreenPptxSeed -Path $outPptx -Title 'S4 T22 DECK' -Subtitle 'Second PPT Test' -BarPrefix 'T22 Bar'
  $checks += (Add-Check '16:9 PowerPoint seed' ([bool]$seed.ok) ("$($seed.reason) slideCount=$($seed.slideCount) size=$($seed.widthIn)x$($seed.heightIn)"))
  if (-not $seed.ok) {
    Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("PowerPoint seed unavailable: " + $seed.reason)
  }
  $seedHash = Get-S4Sha256 $outPptx
  $startedAt = (Get-Date).ToUniversalTime()
  $pptState = Join-Path $base 'ppt.json'
  $pptExe = Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\POWERPNT.EXE'
  $ppt = [ordered]@{ ok = $false; hwnd = 0; title = ''; reason = "not found: $pptExe" }
  if (Test-Path $pptExe) {
    $ppt = Open-TestAppWindow -Exe $pptExe -Arguments @($outPptx) -ProcessName 'POWERPNT' -TitleNeedle @('deck2') -StateFile $pptState -TimeoutSec 30
    if ($ppt.ok) { Maximize-TestWindow ([int]$ppt.hwnd) }
  }
  $checks += (Add-Check 'PowerPoint test window' ([bool]$ppt.ok) ("hwnd=$($ppt.hwnd) title=$($ppt.title) reason=$($ppt.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = $startedAt.ToString('o'); seed = $outPptx; seedHash = $seedHash
    title = 'S4 T22 UPDATED'; subtitle = 'Second PPT Test Updated'
  }))
  if (-not $ppt.ok) {
    Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("PowerPoint unavailable: " + $ppt.reason)
  }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
