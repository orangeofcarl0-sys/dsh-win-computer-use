param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $targetDir = New-TaskDir 'target'
  $allow = Join-Path $targetDir 'allow.txt'
  [IO.File]::WriteAllText($allow, '', (New-Object System.Text.UTF8Encoding($false)))
  $npState = Join-Path $base 'test-notepad.json'
  $np = Open-TestNotepad -Path $allow -TitleNeedle 'allow.txt' -StateFile $npState -ExpectedTabs @('allow.txt') -FinalTabs @('allow.txt')
  $checks += (Add-Check 'allow.txt notepad opened' ([bool]$np.ok -and [bool]$np.owned) ("hwnd=$($np.hwnd) reason=$($np.reason)"))

  $out = New-TaskDir 'out'
  $resultFile = Join-Path $out 'result.json'
  if (Test-Path $resultFile) { Remove-Item $resultFile -Force }
  $init = Initialize-SecurityTask -Mode 'click' -Title 'S4-SEC04-TTL' -ResultFile $resultFile -StateFile (Join-Path $base 'fixture.json')
  $checks += (Add-Check 'TTL fixture window' ([bool]$init.win.ok) ("hwnd=$($init.win.hwnd) title=$($init.win.title) reason=$($init.win.reason)"))

  $st = Read-TestState (Join-Path $base 'state.json')
  if ($st) {
    [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
      startedAt = $st.startedAt; result = $st.result; mode = $st.mode
      isolation = $st.isolation; sentinel = $st.sentinel
      allow = $allow; allowExpected = 'S4 SEC04 READY'
    }))
  }
  if (-not $np.ok -or -not $init.ok) {
    Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("security fixture unavailable: " + $np.reason + ' ' + $init.reason)
  }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
