param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $root = Join-Path $base 's4-t15-inbox'
  $inbox = $root
  $files = @(Get-ChildItem -Path $inbox -File -ErrorAction SilentlyContinue)
  $checks += (Add-Check 'inbox has no files' ($files.Count -eq 0) ("count=$($files.Count)"))
  $dirs = @(Get-ChildItem -Path $inbox -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name | Sort-Object)
  $checks += (Add-Check 'inbox has docs/images/archive' (($dirs -join ',') -eq 'archive,docs,images') ($dirs -join ','))

  $expected = [ordered]@{
    'docs\alpha.txt' = 'ALPHA-S4-T15'
    'docs\beta.txt' = 'BETA-S4-T15'
    'docs\report-final.txt' = 'DRAFT-S4-T15'
    'images\chart.png' = ''
    'images\photo.jpg' = ''
    'archive\notes.md' = 'NOTES-S4-T15'
    'archive\old.pdf' = '%PDF-1.4 S4-T15'
    'archive\temp.tmp' = 'TMP-S4-T15'
  }
  foreach ($rel in $expected.Keys) {
    $p = Join-Path $root $rel
    $exists = Test-Path $p
    $checks += (Add-Check "exists $rel" $exists $p)
    if ($exists -and $expected[$rel] -ne '') {
      $actual = [IO.File]::ReadAllText($p).Trim()
      $checks += (Add-Check "content $rel" ($actual -ceq [string]$expected[$rel]) ("actual=$actual"))
    }
  }
  foreach ($rel in @('alpha.txt', 'beta.txt', 'report-draft.txt', 'notes.md', 'chart.png', 'photo.jpg', 'old.pdf', 'temp.tmp')) {
    $checks += (Add-Check "old path absent $rel" (-not (Test-Path (Join-Path $root $rel))) $rel)
  }
  $checks += (Add-Check 'no report-draft.txt in docs' (-not (Test-Path (Join-Path $root 'docs\report-draft.txt'))) '')
  $sent = Test-TestSentinel -StateFile (Join-Path (Get-TaskDir) 'sentinel.json')
  $checks += (Add-Check 'sentinel window alive' ([bool]$sent.alive) ('hwnd=' + $sent.hwnd))
  $checks += (Add-Check 'sentinel identity' ([bool]$sent.identity) $sent.reason)
  $checks += (Add-Check 'sentinel file unchanged' ([bool]$sent.hashOk) $sent.file)
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
