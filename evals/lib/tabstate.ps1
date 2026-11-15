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

function Wait-NoNotepadProcess([int]$TimeoutMs = 5000) {
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    if (-not (Test-NotepadRunning)) { return $true }
    Start-Sleep -Milliseconds 200
  }
  return (-not (Test-NotepadRunning))
}

function Get-NotepadPids {
  return @(Get-Process -Name notepad -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
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
    $existing = [string]$m.backup
    if ($existing -and -not (Test-Path $existing)) {
      Out-Json ([ordered]@{ ok = $false; action = 'backup'; reason = 'active marker points at missing backup'; backup = $existing })
      exit 2
    }
    Out-Json ([ordered]@{ ok = $true; action = 'backup'; already = $true; backup = $existing; moved = 0 })
    exit 0
  }
  if (-not (Test-Path $stateDir)) {
    # Still write a marker so Clear-TestTabStateForLaunch clears eval-created bins
    # between tasks; restore will remove them and the marker.
    $obj = [ordered]@{ backup = ''; at = (Get-Date).ToString('o'); moved = 0 }
    [IO.File]::WriteAllText($marker, ($obj | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false)))
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
  if (-not (Wait-NoNotepadProcess 5000)) {
    Out-Json ([ordered]@{
      ok = $false; action = 'restore'; reason = 'notepad process is still running; close test windows first'
      backup = $(if (Test-Path $marker) { try { $m = Get-Content $marker -Raw | ConvertFrom-Json; [string]$m.backup } catch { '' } } else { '' })
      pids = @(Get-NotepadPids)
    })
    exit 2
  }
  if (-not (Test-Path $marker)) {
    Out-Json ([ordered]@{ ok = $true; action = 'restore'; reason = 'no active backup'; restored = 0 })
    exit 0
  }
  $m = Get-Content $marker -Raw | ConvertFrom-Json
  $dir = [string]$m.backup
  if ($dir -and -not (Test-Path $dir)) {
    Out-Json ([ordered]@{ ok = $false; action = 'restore'; reason = 'backup dir missing'; backup = $dir })
    exit 2
  }
  if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
  $expected = if ($dir) { @(Get-ChildItem $dir -Filter '*.bin' -File -ErrorAction SilentlyContinue).Count } else { 0 }
  $restored = 0
  # Remove eval-created bins; the backup is authoritative.
  foreach ($f in @(Get-ChildItem $stateDir -Filter '*.bin' -File -ErrorAction SilentlyContinue)) {
    try { Remove-Item -LiteralPath $f.FullName -Force -ErrorAction Stop } catch {}
  }
  if ($dir) {
    foreach ($f in @(Get-ChildItem $dir -Filter '*.bin' -File -ErrorAction SilentlyContinue)) {
      try {
        Move-Item -LiteralPath $f.FullName -Destination (Join-Path $stateDir $f.Name) -Force -ErrorAction Stop
        $restored++
      } catch {}
    }
  }
  if ($restored -lt $expected) {
    # Keep the backup and marker for a retry/manual restore; do not destroy data.
    Out-Json ([ordered]@{ ok = $false; action = 'restore'; reason = "restored $restored of $expected"; backup = $dir; restored = $restored })
    exit 2
  }
  Remove-Item $marker -Force -ErrorAction SilentlyContinue
  if ($dir) { Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue }
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
