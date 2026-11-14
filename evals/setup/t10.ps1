param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $dir = New-TaskDir 'swap'
  $a = Join-Path $dir 'a.txt'
  $b = Join-Path $dir 'b.txt'
  [IO.File]::WriteAllText($a, 'AAA-content-original-a', [Text.Encoding]::ASCII)
  [IO.File]::WriteAllText($b, 'BBB-content-original-b', [Text.Encoding]::ASCII)
  # Open both files in task-owned Notepad window(s); never kill user Notepad windows.
  # Win11 Notepad may host them as two tabs in ONE window, so verify the exact tab
  # set on the recorded HWND(s), never with a global ".txt" scan.
  $state1 = Join-Path (Get-TaskDir) 'test-notepad.json'
  $state2 = Join-Path (Get-TaskDir) 'test-notepad-2.json'
  $s1 = Open-TestNotepad -Path $a -TitleNeedle 'a.txt' -StateFile $state1 -ExpectedTabs @('a.txt')
  if (-not $s1.ok -or -not $s1.owned) {
    $checks += (Add-Check 'a.txt opened as safe task-owned window' $false ("hwnd=$($s1.hwnd) title=$($s1.title) owned=$($s1.owned) reason=$($s1.reason)"))
    Out-Finish -Ok $false -Checks $checks -Kind 'setup'
  }
  Start-Sleep -Milliseconds 500
  $s2 = Open-TestNotepad -Path $b -TitleNeedle 'b.txt' -StateFile $state2 -ExpectedTabs @('b.txt')
  if (-not $s2.ok -and [int]$s2.hwnd -eq 0) {
    $checks += (Add-Check 'b.txt opened' $false ("reason=$($s2.reason)"))
    Out-Finish -Ok $false -Checks $checks -Kind 'setup'
  }
  $same = ([int]$s2.hwnd -eq [int]$s1.hwnd)
  if (-not $same -and -not $s2.owned) {
    $checks += (Add-Check 'b.txt stayed outside user window' $false ("b hwnd=$($s2.hwnd) a hwnd=$($s1.hwnd)"))
    Out-Finish -Ok $false -Checks $checks -Kind 'setup'
  }

  $expected1 = if ($same) { @('a.txt', 'b.txt') } else { @('a.txt') }
  $expected2 = if ($same) { @('a.txt', 'b.txt') } else { @('b.txt') }
  $t1 = Test-NotepadTabSet -Hwnd ([int]$s1.hwnd) -ExpectedTabs $expected1
  $t2 = if ($same) { $t1 } else { Test-NotepadTabSet -Hwnd ([int]$s2.hwnd) -ExpectedTabs $expected2 }
  $checks += (Add-Check 'a window tab set exact' $t1.ok ("tabs=" + (@($t1.labels) -join ',')))
  $checks += (Add-Check 'b window tab set exact' $t2.ok ("tabs=" + (@($t2.labels) -join ',')))
  $checks += (Add-Check 'files prepared' ((Test-Path $a) -and (Test-Path $b)) ($a + ' ; ' + $b))
  if (-not ($t1.ok -and $t2.ok)) {
    Out-Finish -Ok $false -Checks $checks -Kind 'setup'
  }

  # Persist the final expected set for cleanup (same-window case has two tabs).
  foreach ($pair in @(@($state1, $s1, $expected1, $t1), @($state2, $s2, $expected2, $t2))) {
    $sf = $pair[0]; $st = $pair[1]; $exp = $pair[2]; $tc = $pair[3]
    $st.owned = $true
    $st.safeToClose = [bool]$tc.ok
    $st.expectedTabs = @($exp)
    $st.tabs = @($tc.tabs | ForEach-Object { $_.raw })
    try { [IO.File]::WriteAllText($sf, ($st | ConvertTo-Json -Compress -Depth 5), (New-Object System.Text.UTF8Encoding($false))) } catch {}
  }
  Out-Finish -Ok ($t1.ok -and $t2.ok) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
