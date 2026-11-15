param([string]$Action = 'backup')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$stateDir = Join-Path $env:LOCALAPPDATA 'Packages\Microsoft.WindowsNotepad_8wekyb3d8bbwe\LocalState\TabState'
$root = Join-Path $env:USERPROFILE '.dsh\s4-evals\_tabstate-backup'
$marker = Join-Path $env:USERPROFILE '.dsh\s4-evals\_tabstate-active.json'

function Test-NotepadRunning {
  $p = @(Get-Process -Name notepad -ErrorAction SilentlyContinue)
  return ($p.Count -gt 0)
}

function Out-Json($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5))
}

if ($Action -eq 'backup') {
  if (Test-NotepadRunning) {
    Out-Json ([ordered]@{ ok = $false; action = 'backup'; reason = 'notepad process is running; close Notepad windows first' })
    exit 2
  }
  if (Test-Path $marker) {
    try { $m = Get-Content $marker -Raw | ConvertFrom-Json } catch { $m = $null }
    Out-Json ([ordered]@{ ok = $true; action = 'backup'; already = $true; backup = [string]$m.backup; moved = 0 })
    exit 0
  }
  if (-not (Test-Path $stateDir)) {
    Out-Json ([ordered]@{ ok = $true; action = 'backup'; backup = ''; moved = 0; reason = 'no TabState dir' })
    exit 0
  }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $dir = Join-Path $root $stamp
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  $moved = 0
  $failed = @()
  foreach ($f in @(Get-ChildItem $stateDir -Filter '*.bin' -File -ErrorAction SilentlyContinue)) {
    try {
      Move-Item -LiteralPath $f.FullName -Destination (Join-Path $dir $f.Name) -Force -ErrorAction Stop
      $moved++
    } catch { $failed += $f.Name }
  }
  if ($failed.Count -gt 0) {
    # Put back what we moved so the user's session is not half-cleared.
    foreach ($f in @(Get-ChildItem $dir -Filter '*.bin' -File -ErrorAction SilentlyContinue)) {
      try { Move-Item -LiteralPath $f.FullName -Destination (Join-Path $stateDir $f.Name) -Force -ErrorAction Stop } catch {}
    }
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
    Out-Json ([ordered]@{ ok = $false; action = 'backup'; reason = ('could not move: ' + ($failed -join ',')) })
    exit 2
  }
  $obj = [ordered]@{ backup = $dir; at = (Get-Date).ToString('o'); moved = $moved }
  [IO.File]::WriteAllText($marker, ($obj | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
  Out-Json ([ordered]@{ ok = $true; action = 'backup'; backup = $dir; moved = $moved })
  exit 0
}

if ($Action -eq 'restore') {
  if (Test-NotepadRunning) {
    Out-Json ([ordered]@{ ok = $false; action = 'restore'; reason = 'notepad process is running; close test windows first'; backup = $(if (Test-Path $marker) { $m = Get-Content $marker -Raw | ConvertFrom-Json; $m.backup } else { '' }) })
    exit 2
  }
  if (-not (Test-Path $marker)) {
    Out-Json ([ordered]@{ ok = $true; action = 'restore'; reason = 'no active backup'; restored = 0 })
    exit 0
  }
  $m = Get-Content $marker -Raw | ConvertFrom-Json
  $dir = [string]$m.backup
  if (-not (Test-Path $dir)) {
    Out-Json ([ordered]@{ ok = $false; action = 'restore'; reason = 'backup dir missing'; backup = $dir })
    exit 2
  }
  $restored = 0
  # Remove eval-created bins; the backup is authoritative.
  foreach ($f in @(Get-ChildItem $stateDir -Filter '*.bin' -File -ErrorAction SilentlyContinue)) {
    try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop } catch {}
  }
  foreach ($f in @(Get-ChildItem $dir -Filter '*.bin' -File -ErrorAction SilentlyContinue)) {
    try {
      Move-Item -LiteralPath $f.FullName -Destination (Join-Path $stateDir $f.Name) -Force -ErrorAction Stop
      $restored++
    } catch {}
  }
  Remove-Item $marker -Force -ErrorAction SilentlyContinue
  Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  Out-Json ([ordered]@{ ok = $true; action = 'restore'; restored = $restored })
  exit 0
}

if ($Action -eq 'status') {
  $active = Test-Path $marker
  $backup = ''
  if ($active) { try { $m = Get-Content $marker -Raw | ConvertFrom-Json; $backup = [string]$m.backup } catch {} }
  Out-Json ([ordered]@{ ok = $true; action = 'status'; active = $active; backup = $backup; running = (Test-NotepadRunning) })
  exit 0
}

Out-Json ([ordered]@{ ok = $false; action = $Action; reason = 'unknown action' })
exit 2
