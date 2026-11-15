param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'out'
  $f = Join-Path $dir 'pasted.txt'
  if (Test-Path $f) { Remove-Item $f -Force }
  $payload = 'S4-CLIP-6f3a9b payload line'
  $clipCheck = Test-ClipboardRoundTrip -Text $payload -Retries 8
  if (-not $clipCheck.ok) {
    # Environment-blocked: do NOT open Notepad / create side effects.
    $checks += (Add-Check 'clipboard prepared' $false ('error=' + $clipCheck.error))
    Out-Finish -Ok $false -Checks $checks -EnvError ('clipboard unavailable: ' + $clipCheck.error) -Kind 'setup'
  }
  $clip = [string]$clipCheck.text
  # Unique empty seed document; never kill existing Notepad windows.
  $seed = Join-Path $dir 's4-t06-seed.txt'
  [IO.File]::WriteAllText($seed, '', (New-Object System.Text.UTF8Encoding($false)))
  $stateFile = Join-Path (Get-TaskDir) 'test-notepad.json'
  $state = Open-TestNotepad -Path $seed -TitleNeedle 's4-t06-seed.txt' -StateFile $stateFile -ExpectedTabs @('s4-t06-seed.txt') -FinalTabs @('pasted.txt')
  $checks += (Add-Check 'clipboard prepared' $true ('clip=' + $clip))
  $checks += (Add-Check 'seed notepad opened as task-owned window' ([bool]$state.ok -and [bool]$state.owned) ("hwnd=$($state.hwnd) title=$($state.title) owned=$($state.owned)"))
  Out-Finish -Ok ([bool]$state.ok -and [bool]$state.owned) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
