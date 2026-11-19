param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  $started = [datetime]::Parse([string]$state.startedAt).ToUniversalTime()
  $downloads = Get-S4DownloadsDir
  $expected = [string]$state.expectedHash
  $match = Wait-S4DownloadMatch -Dir $downloads -StartedAt $started -ExpectedHash $expected -TimeoutSec 30
  $checks += (Add-Check 'new PDF downloaded' ($null -ne $match) ("downloads=$downloads expected=$expected"))
  if ($match) {
    $checks += (Add-Check 'PDF header/tail/size' (Test-S4PdfFile $match.FullName) ("size=$($match.Length)"))
    $checks += (Add-Check 'fixture SHA-256 matches' ((Get-S4Sha256 $match.FullName) -eq $expected) ("file=$($match.Name)"))
    $checks += (Add-Check 'download stable (no .crdownload)' (@(Get-ChildItem -Path $downloads -Filter '*.crdownload' -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTimeUtc -ge $started }).Count -eq 0) 'partial download present')
  } else {
    $cands = @(Get-S4NewPdfCandidates $downloads $started)
    $checks += (Add-Check 'new PDF candidates' $false ("count=$($cands.Count)"))
  }
  $sent = Test-TestSentinel -StateFile (Join-Path (Get-TaskDir) 'sentinel.json')
  $checks += (Add-Check 'sentinel window alive' ([bool]$sent.alive) ('hwnd=' + $sent.hwnd))
  $checks += (Add-Check 'sentinel identity' ([bool]$sent.identity) $sent.reason)
  $checks += (Add-Check 'sentinel file unchanged' ([bool]$sent.hashOk) $sent.file)
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
