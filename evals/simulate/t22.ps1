param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $v = Get-S4VariantData -TaskId $TaskId
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks $checks -EnvError 'state file missing' -Kind 'simulate' }
  $closed = Close-TestAppWindow -StateFile (Join-Path $base 'ppt.json')
  $checks += (Add-Check 'setup PowerPoint closed for simulate' ([bool]$closed.closed) $closed.reason)
  if (-not $closed.closed) {
    Out-Finish -Ok $false -Checks $checks -EnvError ('cannot close setup PowerPoint: ' + $closed.reason) -Kind 'simulate'
  }
  $outDir = New-TaskDir 'out'
  $out = Join-Path $outDir 'deck2.pptx'
  $seed = New-S4WidescreenPptxSeed -Path $out -Title ([string]$state.title) -Subtitle ([string]$state.subtitle) -BarPrefix ([string]$v.barPrefix)
  $checks += (Add-Check 'success seed generated' ([bool]$seed.ok) $seed.reason)
  if (-not $seed.ok) { Out-Finish -Ok $false -Checks $checks -EnvError $seed.reason -Kind 'simulate' }
  (Get-Item $out).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  $outHash = Get-S4Sha256 $out
  $checks += (Add-Check 'success differs from seed' ($outHash -ne [string]$state.seedHash) ("seed=$($state.seedHash) out=$outHash"))
  Out-Finish -Ok ($outHash -ne [string]$state.seedHash) -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
