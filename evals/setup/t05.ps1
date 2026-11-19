param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'saveas'
  $f = Join-Path $dir 'out-ansi.txt'
  if (Test-Path $f) { Remove-Item $f -Force }
  # pre-stage: a task-owned Notepad window showing the source text. Never kill
  # existing Notepad windows; if the file lands in a user window, fail closed.
  $src = New-TaskDir 'src'
  $draft = Join-Path $src 'draft.txt'
  # Non-ASCII payload: without it, ANSI and UTF-8-without-BOM are byte-identical
  # for ASCII text, so the old oracle could not distinguish the encodings.
  # Build the character from a code point: Windows PowerShell 5.1 reads BOM-less
  # scripts as ANSI, so a literal non-ASCII character here would be corrupted.
  $eacute = [char]0x00E9
  [IO.File]::WriteAllText($draft, "S4-T05 ANSI check $eacute.`r`n", [Text.Encoding]::Default)
  $stateFile = Join-Path (Get-TaskDir) 'test-notepad.json'
  $state = Open-TestNotepad -Path $draft -TitleNeedle 'draft.txt' -StateFile $stateFile -ExpectedTabs @('draft.txt') -FinalTabs @('out-ansi.txt')
  $checks += (Add-Check 'notepad opened draft.txt as task-owned window' ([bool]$state.ok -and [bool]$state.owned) ("hwnd=$($state.hwnd) title=$($state.title) owned=$($state.owned)"))
  $checks += (Add-Check 'no stale out-ansi.txt' (-not (Test-Path $f)) $f)
  Out-Finish -Ok ([bool]$state.ok -and [bool]$state.owned -and (-not (Test-Path $f))) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
