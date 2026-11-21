param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }

  $pdf = [string]$state.pdf
  $checks += (Add-Check 'PDF unchanged' ((Get-S4Sha256Shared $pdf) -eq [string]$state.pdfHash) $pdf)

  $xlsx = Join-Path $base 'out\data.xlsx'
  if (-not (Test-Path $xlsx)) {
    $checks += (Add-Check 'Excel output exists' $false $xlsx)
  } else {
    $checks += (Add-Check 'Excel output exists' $true $xlsx)
    $checks += (Add-Check 'Excel changed from seed' ((Get-S4Sha256 $xlsx) -ne [string]$state.xlsxSeedHash) '')
    $xm = Read-XlsxManifest $xlsx
    $actual = ''
    if ($xm.cells.Contains('A1')) { $actual = [string]$xm.cells['A1'] }
    $checks += (Add-Check 'Excel A1 == 42' ($actual -ceq [string]$state.expected) ("A1=[$actual]"))
  }

  $pptx = Join-Path $base 'out\summary.pptx'
  if (-not (Test-Path $pptx)) {
    $checks += (Add-Check 'PowerPoint output exists' $false $pptx)
  } else {
    $checks += (Add-Check 'PowerPoint output exists' $true $pptx)
    $checks += (Add-Check 'PowerPoint changed from seed' ((Get-S4Sha256 $pptx) -ne [string]$state.pptSeedHash) '')
    $pm = Read-PptxManifest $pptx
    $texts = @()
    foreach ($s in @($pm.slides)) { $texts += @($s.texts) }
    $all = (($texts -join ' ') -replace '\s+', ' ').Trim()
    $checks += (Add-Check 'PowerPoint subtitle updated' ($all.IndexOf([string]$state.pptText, [System.StringComparison]::Ordinal) -ge 0) $all)
  }

  $sent = Test-TestSentinel -StateFile (Join-Path $base 'sentinel.json')
  $checks += (Add-Check 'sentinel window alive' ([bool]$sent.alive) ('hwnd=' + $sent.hwnd))
  $checks += (Add-Check 'sentinel identity' ([bool]$sent.identity) $sent.reason)
  $checks += (Add-Check 'sentinel file unchanged' ([bool]$sent.hashOk) $sent.file)
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
