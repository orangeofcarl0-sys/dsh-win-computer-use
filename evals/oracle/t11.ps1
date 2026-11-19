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
  try {
  $size = Get-PngSize $out
  $checks += (Add-Check 'canvas is 800x600' ($size.width -eq 800 -and $size.height -eq 600) ("actual=$($size.width)x$($size.height)"))
  $white = [S4ImageMask]::WhiteRatio($out, 230, 4)
  $checks += (Add-Check 'white background >= 70%' ($white -ge 0.70) ("ratio=$([math]::Round($white,3))"))

  $ref = [string]$state.ref
  # Each shape lives in its own generous ROI. This avoids a combined bbox check
  # that a missing shape can still satisfy, without requiring connected-component
  # analysis in PowerShell.
  $regions = @(
    @('red', 60, 70, 240, 180),
    @('blue', 400, 70, 220, 160),
    @('black', 90, 460, 620, 40)
  )
  foreach ($r in $regions) {
    $name = [string]$r[0]
    $m = Compare-MaskRegion $ref $out $name ([int]$r[1]) ([int]$r[2]) ([int]$r[3]) ([int]$r[4])
    $checks += (Add-Check "$name region visible" ($m.OutCount -gt 0) ("out=$($m.OutCount) ref=$($m.RefCount)"))
    if ($m.OutCount -gt 0 -and $m.RefCount -gt 0) {
      $rcx = ($m.RefMinX + $m.RefMaxX) / 2.0
      $rcy = ($m.RefMinY + $m.RefMaxY) / 2.0
      $ocx = ($m.OutMinX + $m.OutMaxX) / 2.0
      $ocy = ($m.OutMinY + $m.OutMaxY) / 2.0
      $dist = [math]::Sqrt([math]::Pow($rcx - $ocx, 2) + [math]::Pow($rcy - $ocy, 2))
      $checks += (Add-Check "$name region bbox center" ($dist -le 40.0) ("dist=$([math]::Round($dist,1))px"))
      $ratio = [double]$m.OutCount / [double]$m.RefCount
      # Paint's default line width is thinner than the 10px reference line.
      # Keep a lower bound for black so a default-width line can still pass.
      $minRatio = 0.35
      if ($name -eq 'black') { $minRatio = 0.25 }
      $checks += (Add-Check "$name region area ratio" ($ratio -ge $minRatio -and $ratio -le 2.20) ("ratio=$([math]::Round($ratio,2))"))
      $recall = [double]$m.DilInterCount / [double]$m.OutCount
      $checks += (Add-Check "$name region near-reference coverage" ($recall -ge 0.55) ("recall=$([math]::Round($recall,3))"))
      $coverage = [double]$m.InterCount / [double]$m.RefCount
      $checks += (Add-Check "$name region reference coverage" ($coverage -ge 0.35) ("coverage=$([math]::Round($coverage,3))"))
    } else {
      $checks += (Add-Check "$name region comparable" $false 'ref or output mask empty')
    }
    # Global precision catches scribbles outside the expected shape (the ROI
    # checks alone would still pass if the model also painted unrelated marks).
    $gm = Compare-ColorMask $ref $out $name
    $precision = 0.0
    if ($gm.OutCount -gt 0) { $precision = [double]$gm.DilInterCount / [double]$gm.OutCount }
    $checks += (Add-Check "$name global precision" ($precision -ge 0.60) ("precision=$([math]::Round($precision,3)) out=$($gm.OutCount)"))
  }
  } catch {
    # A malformed/non-PNG output is a model failure, not an environment error.
    # Only missing state/script infrastructure should surface as ENV.
    $checks += (Add-Check 'image readable' $false $_.Exception.Message)
    Out-Finish -Ok $false -Checks $checks
  }
  $sent = Test-TestSentinel -StateFile (Join-Path (Get-TaskDir) 'sentinel.json')
  $checks += (Add-Check 'sentinel window alive' ([bool]$sent.alive) ('hwnd=' + $sent.hwnd))
  $checks += (Add-Check 'sentinel identity' ([bool]$sent.identity) $sent.reason)
  $checks += (Add-Check 'sentinel file unchanged' ([bool]$sent.hashOk) $sent.file)
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
