param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks $checks -EnvError 'state file missing' -Kind 'simulate' }
  $excel = Close-TestAppWindow -StateFile (Join-Path $base 'excel.json')
  $checks += (Add-Check 'setup Excel closed' ([bool]$excel.closed) $excel.reason)
  $viewer = Close-TestBrowserWindow -StateFile (Join-Path $base 'viewer.json')
  $checks += (Add-Check 'setup browser closed' ([bool]$viewer.closed) $viewer.reason)
  $srv = Stop-TestFormServer -StateFile (Join-Path $base 'server.json')
  $checks += (Add-Check 'setup server stopped' ([bool]$srv.stopped) $srv.reason)
  $out = New-TaskDir 'out'
  $fixture = Join-Path $PSScriptRoot '..\fixtures\t14-sales.xlsx'
  if (-not (Test-Path $fixture)) { Out-Finish -Ok $false -Checks $checks -EnvError 't14 xlsx fixture missing' -Kind 'simulate' }
  Copy-Item $fixture (Join-Path $out 'sales.xlsx') -Force
  (Get-Item (Join-Path $out 'sales.xlsx')).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  $csvFixture = Join-Path $PSScriptRoot '..\fixtures\combo02-sales.csv'
  $dst = Join-Path (Get-S4DownloadsDir) ('s4-combo02-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '.csv')
  Copy-Item $csvFixture $dst -Force
  (Get-Item $dst).LastWriteTimeUtc = (Get-Date).ToUniversalTime()
  $checks += (Add-Check 'simulated workbook' (Test-Path (Join-Path $out 'sales.xlsx')) '')
  $checks += (Add-Check 'simulated download' (Test-Path $dst) $dst)
  $checks += (Add-Check 'download hash matches state' ((Get-S4Sha256 $dst) -eq [string]$state.csvHash) '')
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
