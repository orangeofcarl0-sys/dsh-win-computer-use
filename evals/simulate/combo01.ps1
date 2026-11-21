param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks $checks -EnvError 'state file missing' -Kind 'simulate' }
  $closedPpt = Close-TestAppWindow -StateFile (Join-Path $base 'ppt.json')
  $closedExcel = Close-TestAppWindow -StateFile (Join-Path $base 'excel.json')
  $checks += (Add-Check 'setup PowerPoint closed' ([bool]$closedPpt.closed) $closedPpt.reason)
  $checks += (Add-Check 'setup Excel closed' ([bool]$closedExcel.closed) $closedExcel.reason)
  if (-not $closedPpt.closed -or -not $closedExcel.closed) {
    Out-Finish -Ok $false -Checks $checks -EnvError 'cannot close setup Office windows' -Kind 'simulate'
  }
  $out = New-TaskDir 'out'
  $fixture = Join-Path $PSScriptRoot '..\fixtures\combo01-data.xlsx'
  if (-not (Test-Path $fixture)) { Out-Finish -Ok $false -Checks $checks -EnvError 'combo01 xlsx fixture missing' -Kind 'simulate' }
  Copy-Item $fixture (Join-Path $out 'data.xlsx') -Force
  $pptx = Join-Path $out 'summary.pptx'
  $seed = New-S4WidescreenPptxSeed -Path $pptx -Title 'S4 COMBO1 DECK' -Subtitle 'S4 COMBO1 DONE' -BarPrefix 'C1 Bar'
  $checks += (Add-Check 'simulated PowerPoint generated' ([bool]$seed.ok) $seed.reason)
  (Get-Item (Join-Path $out 'data.xlsx')).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  (Get-Item $pptx).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  $checks += (Add-Check 'Excel differs from seed' ((Get-S4Sha256 (Join-Path $out 'data.xlsx')) -ne [string]$state.xlsxSeedHash) '')
  $checks += (Add-Check 'PowerPoint differs from seed' ((Get-S4Sha256 $pptx) -ne [string]$state.pptSeedHash) '')
  $ok = [bool]$seed.ok
  Out-Finish -Ok $ok -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
