param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $checks += (Add-Check 'variant matches runner' ([int]$state.variant -eq (Get-S4VariantNumber)) ("state=$($state.variant) runner=$(Get-S4VariantNumber)"))
  $out = Join-Path $base 'out\deck2.pptx'
  if (-not (Test-Path $out)) {
    Out-Finish -Ok $false -Checks @((Add-Check 'file exists' $false $out))
  }
  $checks += (Add-Check 'file exists' $true $out)
  $outHash = Get-S4Sha256 $out
  $checks += (Add-Check 'presentation changed from seed' ($outHash -ne [string]$state.seedHash) ("seed=$($state.seedHash) out=$outHash"))
  $m = Read-PptxManifest $out
  $checks += (Add-Check 'exactly one slide' ($m.slideCount -eq 1) ("actual=$($m.slideCount)"))
  $ratio = 0
  if ($m.slideHeightIn -gt 0) { $ratio = $m.slideWidthIn / $m.slideHeightIn }
  $checks += (Add-Check '16:9 slide size' ([math]::Abs($ratio - 1.7778) -le 0.04) ("size=$($m.slideWidthIn)x$($m.slideHeightIn)"))
  $texts = @()
  foreach ($s in @($m.slides)) { $texts += @($s.texts) }
  $allText = (($texts -join ' ') -replace '\s+', ' ').Trim()
  $checks += (Add-Check 'updated title' ($allText.IndexOf([string]$state.title, [System.StringComparison]::Ordinal) -ge 0) $allText)
  $checks += (Add-Check 'updated subtitle' ($allText.IndexOf([string]$state.subtitle, [System.StringComparison]::Ordinal) -ge 0) $allText)
  $checks += (Add-Check 'old title removed' ($allText.IndexOf([string]$state.seedTitle, [System.StringComparison]::Ordinal) -lt 0) $allText)
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
