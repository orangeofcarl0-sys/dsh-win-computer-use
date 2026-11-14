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
  # Win11 Notepad may host them as two tabs in ONE window, so verify via UIA tab items.
  $state1 = Join-Path (Get-TaskDir) 'test-notepad.json'
  $state2 = Join-Path (Get-TaskDir) 'test-notepad-2.json'
  $s1 = Open-TestNotepad -Path $a -TitleNeedle 'a.txt' -StateFile $state1
  if (-not $s1.ok -or -not $s1.owned) {
    $checks += (Add-Check 'a.txt opened as task-owned window' $false ("hwnd=$($s1.hwnd) title=$($s1.title) owned=$($s1.owned)"))
    Out-Finish -Ok $false -Checks $checks -Kind 'setup'
  }
  Start-Sleep -Milliseconds 800
  $s2 = Open-TestNotepad -Path $b -TitleNeedle 'b.txt' -StateFile $state2
  if (-not $s2.ok) {
    $checks += (Add-Check 'b.txt opened' $false ("reason=$($s2.reason)"))
    Out-Finish -Ok $false -Checks $checks -Kind 'setup'
  }
  if (-not $s2.owned) {
    if ([int]$s2.hwnd -ne [int]$s1.hwnd) {
      $checks += (Add-Check 'b.txt stayed outside user window' $false ("b hwnd=$($s2.hwnd) a hwnd=$($s1.hwnd)"))
      Out-Finish -Ok $false -Checks $checks -Kind 'setup'
    }
    # b.txt is a tab in the task-owned window; record it as owned for cleanup.
    $s2.owned = $true
    try { [IO.File]::WriteAllText($state2, ($s2 | ConvertTo-Json -Compress), (New-Object System.Text.UTF8Encoding($false))) } catch {}
  }
  $deadline = (Get-Date).AddSeconds(15)
  $tabs = @()
  while ((Get-Date) -lt $deadline) {
    Add-Type -AssemblyName UIAutomationClient
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Window)
    $wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
    $tabs = @()
    foreach ($w in $wins) {
      $n = ''
      try { $n = [string]$w.Current.Name } catch {}
      if ($n -match '\.txt') {
        $items = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
          (New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::TabItem)))
        foreach ($it in $items) { try { $tabs += [string]$it.Current.Name } catch {} }
      }
    }
    $hasA = @($tabs | Where-Object { $_ -match 'a\.txt' }).Count -gt 0
    $hasB = @($tabs | Where-Object { $_ -match 'b\.txt' }).Count -gt 0
    if ($hasA -and $hasB) { break }
    Start-Sleep -Milliseconds 700
  }
  $hasA = @($tabs | Where-Object { $_ -match 'a\.txt' }).Count -gt 0
  $hasB = @($tabs | Where-Object { $_ -match 'b\.txt' }).Count -gt 0
  $checks += (Add-Check 'files prepared' ((Test-Path $a) -and (Test-Path $b)) ($a + ' ; ' + $b))
  $checks += (Add-Check 'both documents loaded in task-owned Notepad' ($hasA -and $hasB) ('tabs=' + (($tabs | Select-Object -Unique) -join ',')))
  Out-Finish -Ok ($hasA -and $hasB) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
