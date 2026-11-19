param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $sentinelState = Join-Path (Get-TaskDir) 'sentinel.json'
  $sent = Open-TestSentinel -TaskId $TaskId -StateFile $sentinelState
  $checks += (Add-Check 'sentinel opened' ([bool]$sent.ok) ("hwnd=$($sent.hwnd) pid=$($sent.pid) reason=$($sent.reason)"))
  if (-not $sent.ok) {
    Out-Finish -Ok $false -Checks $checks -EnvError ('sentinel unavailable: ' + $sent.reason) -Kind 'setup'
  }
  $base = Get-TaskDir
  $root = Join-Path $base 's4-t15-inbox'
  if (Test-Path $root) { Remove-Item $root -Recurse -Force }
  $inbox = New-Item -ItemType Directory -Path $root -Force
  [void](New-Item -ItemType Directory -Path (Join-Path $inbox.FullName 'docs') -Force)
  [void](New-Item -ItemType Directory -Path (Join-Path $inbox.FullName 'images') -Force)
  [void](New-Item -ItemType Directory -Path (Join-Path $inbox.FullName 'archive') -Force)
  Set-Content -Path (Join-Path $inbox.FullName 'alpha.txt') -Value 'ALPHA-S4-T15' -Encoding ASCII
  Set-Content -Path (Join-Path $inbox.FullName 'beta.txt') -Value 'BETA-S4-T15' -Encoding ASCII
  Set-Content -Path (Join-Path $inbox.FullName 'report-draft.txt') -Value 'DRAFT-S4-T15' -Encoding ASCII
  Set-Content -Path (Join-Path $inbox.FullName 'notes.md') -Value 'NOTES-S4-T15' -Encoding ASCII
  Set-Content -Path (Join-Path $inbox.FullName 'old.pdf') -Value '%PDF-1.4 S4-T15' -Encoding ASCII
  Set-Content -Path (Join-Path $inbox.FullName 'temp.tmp') -Value 'TMP-S4-T15' -Encoding ASCII
  New-TestBlankPng (Join-Path $inbox.FullName 'chart.png') 80 60 'Red'
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap 80, 60
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Blue)
  $g.Dispose()
  $bmp.Save((Join-Path $inbox.FullName 'photo.jpg'), [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $bmp.Dispose()

  [void](Close-OrphanTestExplorer -TitleNeedle 's4-t15-inbox' -Files @('alpha.txt', 'report-draft.txt'))
  $stateFile = Join-Path $base 'explorer.json'
  $e = Open-TestExplorer -Path $inbox.FullName -TitleNeedle @('s4-t15-inbox') -StateFile $stateFile
  if ($e.ok) { Maximize-TestWindow ([int]$e.hwnd) }
  $checks += (Add-Check 'Explorer test window' ([bool]$e.ok) ("hwnd=$($e.hwnd) title=$($e.title) reason=$($e.reason)"))
  if (-not $e.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("Explorer unavailable: " + $e.reason) }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
