param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'out'
  $f = Join-Path $dir 'pasted.txt'
  if (Test-Path $f) { Remove-Item $f -Force }
  $payload = 'S4-CLIP-6f3a9b payload line'
  $clip = ''
  # clipboard can be transiently locked by another process - retry set+verify
  for ($i = 0; $i -lt 4 -and $clip -ne $payload; $i++) {
    try { Set-Clipboard -Value $payload } catch {}
    Start-Sleep -Milliseconds 600
    try { $clip = (Get-Clipboard -Raw) } catch { $clip = '' }
    if ($clip) { $clip = $clip.TrimEnd("`r", "`n") }
  }
  # Unique empty seed document; never kill existing Notepad windows.
  $seed = Join-Path $dir 's4-t06-seed.txt'
  [IO.File]::WriteAllText($seed, '', (New-Object System.Text.UTF8Encoding($false)))
  $stateFile = Join-Path (Get-TaskDir) 'test-notepad.json'
  $state = Open-TestNotepad -Path $seed -TitleNeedle 's4-t06-seed.txt' -StateFile $stateFile -ExpectedTabs @('s4-t06-seed.txt')
  $checks += (Add-Check 'clipboard prepared' ($clip -eq $payload) ('clip=' + $clip))
  $checks += (Add-Check 'seed notepad opened as task-owned window' ([bool]$state.ok -and [bool]$state.owned) ("hwnd=$($state.hwnd) title=$($state.title) owned=$($state.owned)"))
  Out-Finish -Ok (($clip -eq $payload) -and [bool]$state.ok -and [bool]$state.owned) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
