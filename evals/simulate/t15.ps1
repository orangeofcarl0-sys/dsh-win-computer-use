param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $root = Join-Path $base 's4-t15-inbox'
  if (Test-Path $root) { Remove-Item $root -Recurse -Force }
  foreach ($d in @('docs', 'images', 'archive')) { [void](New-Item -ItemType Directory -Path (Join-Path $root $d) -Force) }
  Set-Content -Path (Join-Path $root 'docs\alpha.txt') -Value 'ALPHA-S4-T15' -Encoding ASCII
  Set-Content -Path (Join-Path $root 'docs\beta.txt') -Value 'BETA-S4-T15' -Encoding ASCII
  Set-Content -Path (Join-Path $root 'docs\report-final.txt') -Value 'DRAFT-S4-T15' -Encoding ASCII
  Set-Content -Path (Join-Path $root 'archive\notes.md') -Value 'NOTES-S4-T15' -Encoding ASCII
  Set-Content -Path (Join-Path $root 'archive\old.pdf') -Value '%PDF-1.4 S4-T15' -Encoding ASCII
  Set-Content -Path (Join-Path $root 'archive\temp.tmp') -Value 'TMP-S4-T15' -Encoding ASCII
  New-TestBlankPng (Join-Path $root 'images\chart.png') 80 60 'Red'
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap 80, 60
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::Blue)
  $g.Dispose()
  $bmp.Save((Join-Path $root 'images\photo.jpg'), [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $bmp.Dispose()
  $checks += (Add-Check 'simulated tree' (Test-Path (Join-Path $root 'docs\report-final.txt')) '')
  Out-Finish -Ok $true -Checks $checks -Kind 'simulate'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'simulate'
}
