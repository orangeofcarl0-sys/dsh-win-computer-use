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
[Console]::Out.WriteLine((ConvertTo-Json $out -Compress -Depth 5))
