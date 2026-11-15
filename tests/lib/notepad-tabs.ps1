param()
# Pure classifier smoke: no UIA window required. ASCII-only source; Chinese
# suffixes are built from code points so PS 5.1 ANSI parsing stays valid.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\evals\lib\common.ps1')

$unmod = -join @([char]0x672A, [char]0x4FEE, [char]0x6539)   # unmodified
$mod = -join @([char]0x5DF2, [char]0x4FEE, [char]0x6539)     # modified
$dot = [char]0x3002

$cases = @(
  @{ name = 'exact-one'; tabs = @("s4-t01-seed.txt. $unmod$dot"); expected = @('s4-t01-seed.txt'); ok = $true },
  @{ name = 'extra-user-tab'; tabs = @("s4-t01-seed.txt. $unmod$dot", "EF_End.md. $mod$dot"); expected = @('s4-t01-seed.txt'); ok = $false },
  @{ name = 'modified-test-tab'; tabs = @("s4-t01-seed.txt. $mod$dot"); expected = @('s4-t01-seed.txt'); ok = $false },
  @{ name = 'unknown-suffix'; tabs = @('s4-t01-seed.txt'); expected = @('s4-t01-seed.txt'); ok = $false },
  @{ name = 'two-expected'; tabs = @("a.txt. $unmod$dot", "b.txt. $unmod$dot"); expected = @('a.txt', 'b.txt'); ok = $true },
  @{ name = 'count-mismatch'; tabs = @("a.txt. $unmod$dot"); expected = @('a.txt', 'b.txt'); ok = $false }
)
$out = @()
foreach ($c in $cases) {
  $r = Test-NotepadTabLabels -TabNames @($c.tabs) -ExpectedTabs @($c.expected)
  $out += [ordered]@{ name = $c.name; expected = [bool]$c.ok; actual = [bool]$r.ok; reason = [string]$r.reason; labels = @($r.labels); raw = @($c.tabs) }
}
$allowedCases = @(
  @{ name = 'allowed-final-rename'; tabs = @("note.txt. $unmod$dot"); allowed = @('s4-t01-seed.txt', 'note.txt'); count = 1; ok = $true },
  @{ name = 'allowed-other-tab'; tabs = @("other.txt. $unmod$dot"); allowed = @('s4-t01-seed.txt', 'note.txt'); count = 1; ok = $false },
  @{ name = 'allowed-count-mismatch'; tabs = @("note.txt. $unmod$dot", "extra.txt. $unmod$dot"); allowed = @('s4-t01-seed.txt', 'note.txt'); count = 1; ok = $false }
)
foreach ($c in $allowedCases) {
  $r = Test-NotepadTabAllowed -TabNames @($c.tabs) -AllowedTabs @($c.allowed) -ExpectedCount $c.count
  $out += [ordered]@{ name = $c.name; expected = [bool]$c.ok; actual = [bool]$r.ok; reason = [string]$r.reason; labels = @($r.labels); raw = @($c.tabs) }
}

# TabState cleanup: only test-sandbox bins are removed; user bin survives.
$tmp = Join-Path $env:TEMP ('s4-tabstate-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$enc = New-Object System.Text.UnicodeEncoding($false, $false)
[IO.File]::WriteAllBytes((Join-Path $tmp 'test.bin'), $enc.GetBytes('C:\Users\x\.dsh\s4-evals\t01\target\s4-t01-seed.txt'))
[IO.File]::WriteAllBytes((Join-Path $tmp 'user.bin'), $enc.GetBytes('C:\Users\x\Documents\user.md'))
$removed = Clear-TestNotepadTabState -StateDir $tmp
$testGone = -not (Test-Path (Join-Path $tmp 'test.bin'))
$userKept = Test-Path (Join-Path $tmp 'user.bin')
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
$out += [ordered]@{ name = 'tabstate-clear-only-test'; expected = $true; actual = ([bool]$testGone -and [bool]$userKept -and [int]$removed -eq 1); reason = "removed=$removed testGone=$testGone userKept=$userKept"; labels = @(); raw = @() }

[Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 5))
