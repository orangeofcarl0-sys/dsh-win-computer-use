param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $refDir = New-TaskDir 'ref'
  $outDir = New-TaskDir 'out'
  $ref = Join-Path $refDir 's4-t11-ref.png'
  New-PaintReferencePng $ref
  $startedAt = (Get-Date).ToUniversalTime()
  $out = Join-Path $outDir 'replica.png'
  Copy-Item $ref $out -Force
  (Get-Item $out).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = $startedAt.ToString('o'); ref = $ref; canvas = ''
  }))
  $checks += (Add-Check 'simulated replica' (Test-Path $out) $out)
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
