param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  $out = Join-Path $base 'out\replica.pptx'
  if (-not $state) { Out-Finish -Ok $false -Checks @((Add-Check 'state file' $false 'missing')) -EnvError 'state file missing' }
  if (-not (Test-Path $out)) {
    $checks += (Add-Check 'file exists' $false $out)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'file exists' $true $out)
  $started = [datetime]::Parse([string]$state.startedAt).ToUniversalTime()
  $fi = Get-Item $out
  $checks += (Add-Check 'file is newer than setup' ($fi.LastWriteTimeUtc -ge $started) ("mtime=$($fi.LastWriteTimeUtc.ToString('o'))"))

  $m = Read-PptxManifest $out
  $checks += (Add-Check 'exactly one slide' ($m.slideCount -eq 1) ("actual=$($m.slideCount)"))
  $ratio = 0
  if ($m.slideHeightIn -gt 0) { $ratio = $m.slideWidthIn / $m.slideHeightIn }
  $checks += (Add-Check '16:9 slide size' ([math]::Abs($ratio - 1.7778) -le 0.04) ("size=$($m.slideWidthIn)x$($m.slideHeightIn) ratio=$([math]::Round($ratio,3))"))

  $texts = @()
  foreach ($s in @($m.slides)) { $texts += @($s.texts) }
  $allText = (($texts -join ' ') -replace '\s+', ' ').Trim()
  foreach ($needle in @('S4 PPT REPLICA', 'Dirty Desktop Test', 'Q1', 'Q2', 'Q3', 'seed:S4-T12')) {
    $checks += (Add-Check "text: $needle" ($allText.IndexOf($needle, [System.StringComparison]::Ordinal) -ge 0) $allText)
  }

  function Get-Rgb([string]$hex) {
    if (-not $hex -or $hex.Length -lt 6) { return $null }
    return @(
      [Convert]::ToInt32($hex.Substring(0, 2), 16),
      [Convert]::ToInt32($hex.Substring(2, 2), 16),
      [Convert]::ToInt32($hex.Substring(4, 2), 16)
    )
  }
  function Get-ColorDistance([string]$a, [string]$b) {
    $ra = Get-Rgb $a; $rb = Get-Rgb $b
    if (-not $ra -or -not $rb) { return 999 }
    return [math]::Sqrt([math]::Pow($ra[0] - $rb[0], 2) + [math]::Pow($ra[1] - $rb[1], 2) + [math]::Pow($ra[2] - $rb[2], 2))
  }

  $shapes = @($m.slides[0].shapes)
  $targets = @(
    @('red', 'C00000', 0.833, 2.708, 3.333, 3.125),
    @('blue', '0070C0', 5.000, 2.708, 3.333, 3.125),
    @('green', '70AD47', 9.167, 2.708, 3.333, 3.125)
  )
  foreach ($t in $targets) {
    $name = [string]$t[0]; $color = [string]$t[1]
    $tx = [double]$t[2]; $ty = [double]$t[3]; $tw = [double]$t[4]; $th = [double]$t[5]
    $hit = @($shapes | Where-Object {
      $_.fill -and (Get-ColorDistance ([string]$_.fill) $color) -le 80 -and
      [math]::Abs([double]$_.xIn - $tx) -le 0.75 -and
      [math]::Abs([double]$_.yIn - $ty) -le 0.75 -and
      [math]::Abs([double]$_.wIn - $tw) -le 0.75 -and
      [math]::Abs([double]$_.hIn - $th) -le 0.75
    })
    $detail = ($shapes | ForEach-Object { "$($_.fill)@$($_.xIn),$($_.yIn),$($_.wIn),$($_.hIn)" }) -join ' | '
    $checks += (Add-Check "$name bar" ($hit.Count -ge 1) $detail)
  }
  $ok = -not ($checks | Where-Object { -not $_.ok })
  Out-Finish -Ok $ok -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks
}
