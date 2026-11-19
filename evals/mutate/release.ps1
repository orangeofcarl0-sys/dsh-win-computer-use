param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$base = Get-TaskDir
$closed = @()
$fail = ''
function Close-One([string]$Path, [string]$Kind) {
  if (-not (Test-Path $Path)) { return }
  if ($Kind -eq 'notepad') {
    $r = Close-TestNotepad -StateFile $Path
  } elseif ($Kind -eq 'paint') {
    $r = Close-TestPaint -StateFile $Path
  } else {
    $r = Close-TestAppWindow -StateFile $Path
  }
  $script:closed += [ordered]@{ state = (Split-Path $Path -Leaf); closed = [bool]$r.closed; reason = [string]$r.reason }
  if (-not $r.closed) { $script:fail = [string]$r.reason }
}
try {
  switch ($TaskId) {
    't01' { Close-One (Join-Path $base 'test-notepad.json') 'notepad' }
    't05' { Close-One (Join-Path $base 'test-notepad.json') 'notepad' }
    't06' { Close-One (Join-Path $base 'test-notepad.json') 'notepad' }
    't10' {
      Close-One (Join-Path $base 'test-notepad.json') 'notepad'
      Close-One (Join-Path $base 'test-notepad-2.json') 'notepad'
    }
    't09' { Close-One (Join-Path $base 'test-paint.json') 'paint' }
    't11' { Close-One (Join-Path $base 'paint.json') 'paint' }
    't12' { Close-One (Join-Path $base 'ppt.json') 'app' }
    't14' { Close-One (Join-Path $base 'excel.json') 'app' }
    't17' { Close-One (Join-Path $base 'excel.json') 'app' }
    default { }
  }
  [ordered]@{ ok = (-not $fail); reason = $fail; closed = @($closed) } | ConvertTo-Json -Compress -Depth 4
} catch {
  [ordered]@{ ok = $false; reason = $_.Exception.Message; closed = @($closed) } | ConvertTo-Json -Compress -Depth 4
  exit 1
}
