param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  $out = Join-Path $base 'out\replica.png'
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  if (-not (Test-Path $out)) {
    $checks += (Add-Check 'file exists' $false $out)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'file exists' $true $out)
  $started = [datetime]::Parse([string]$state.startedAt).ToUniversalTime()
  $fi = Get-Item $out
  $checks += (Add-Check 'file is newer than setup' ($fi.LastWriteTimeUtc -ge $started) ("mtime=$($fi.LastWriteTimeUtc.ToString('o')) started=$($started.ToString('o'))"))
  $size = Get-PngSize $out
  $checks += (Add-Check 'canvas is 800x600' ($size.width -eq 800 -and $size.height -eq 600) ("actual=$($size.width)x$($size.height)"))
  $white = [S4ImageMask]::WhiteRatio($out, 230, 4)
  $checks += (Add-Check 'white background >= 60%' ($white -ge 0.60) ("ratio=$([math]::Round($white,3))"))

  $ref = [string]$state.ref
  foreach ($name in @('red', 'blue', 'black')) {
    $m = Compare-ColorMask $ref $out $name
    $checks += (Add-Check "$name mask visible" ($m.OutCount -gt 0) ("out=$($m.OutCount) ref=$($m.RefCount)"))
    if ($m.OutCount -gt 0 -and $m.RefCount -gt 0) {
      $rcx = ($m.RefMinX + $m.RefMaxX) / 2.0
      $rcy = ($m.RefMinY + $m.RefMaxY) / 2.0
      $ocx = ($m.OutMinX + $m.OutMaxX) / 2.0
      $ocy = ($m.OutMinY + $m.OutMaxY) / 2.0
      $dist = [math]::Sqrt([math]::Pow($rcx - $ocx, 2) + [math]::Pow($rcy - $ocy, 2))
      $checks += (Add-Check "$name bbox center" ($dist -le 40.0) ("dist=$([math]::Round($dist,1))px"))
      $ratio = [double]$m.OutCount / [double]$m.RefCount
      $minRatio = 0.45
      $maxRatio = 1.75
      if ($name -ne 'black') { $minRatio = 0.50; $maxRatio = 1.60 }
      $checks += (Add-Check "$name area ratio" ($ratio -ge $minRatio -and $ratio -le $maxRatio) ("ratio=$([math]::Round($ratio,2))"))
      $recall = [double]$m.DilInterCount / [double]$m.OutCount
      $checks += (Add-Check "$name near-reference coverage" ($recall -ge 0.65) ("recall=$([math]::Round($recall,3))"))
      $coverage = [double]$m.InterCount / [double]$m.RefCount
      $checks += (Add-Check "$name reference coverage" ($coverage -ge 0.45) ("coverage=$([math]::Round($coverage,3))"))
    } else {
      $checks += (Add-Check "$name mask comparable" $false 'ref or output mask empty')
    }
  }
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
