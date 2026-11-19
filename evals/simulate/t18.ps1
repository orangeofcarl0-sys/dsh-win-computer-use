param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $fixture = Join-Path $PSScriptRoot '..\fixtures\t18-download.pdf'
  if (-not (Test-Path $fixture)) { Out-Finish -Ok $false -Checks $checks -EnvError 't18 fixture missing' -Kind 'simulate' }
  $downloads = Get-S4DownloadsDir
  if (-not (Test-Path $downloads)) { New-Item -ItemType Directory -Path $downloads -Force | Out-Null }
  $startedAt = (Get-Date).ToUniversalTime()
  $name = 's4-t18-sim-' + [guid]::NewGuid().ToString('N') + '.pdf'
  $target = Join-Path $downloads $name
  Copy-Item $fixture $target -Force
  (Get-Item $target).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  $hash = Get-S4Sha256 $target
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = $startedAt.ToString('o'); expectedHash = $hash; expectedSize = (Get-Item $fixture).Length; mode = 'download'
  }))
  $checks += (Add-Check 'simulated local download' (Test-Path $target) $target)
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
