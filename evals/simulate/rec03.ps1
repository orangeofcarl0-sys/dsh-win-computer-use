param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks $checks -EnvError 'state file missing' -Kind 'simulate' }
  $viewer = Close-TestBrowserWindow -StateFile (Join-Path $base 'viewer.json')
  $checks += (Add-Check 'setup browser closed' ([bool]$viewer.closed) $viewer.reason)
  $srv = Stop-TestFormServer -StateFile (Join-Path $base 'server.json')
  $checks += (Add-Check 'setup server stopped' ([bool]$srv.stopped) $srv.reason)
  $fixture = [string]$state.fixture
  if (-not (Test-Path $fixture)) { Out-Finish -Ok $false -Checks $checks -EnvError 'PDF fixture missing' -Kind 'simulate' }
  $dst = Join-Path (Get-S4DownloadsDir) ('s4-rec03-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '.pdf')
  Copy-Item $fixture $dst -Force
  (Get-Item $dst).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  $checks += (Add-Check 'simulated download' ((Get-S4Sha256 $dst) -eq [string]$state.expectedHash) $dst)
  Out-Finish -Ok ((Get-S4Sha256 $dst) -eq [string]$state.expectedHash) -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
