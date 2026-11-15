param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $docs = New-TaskDir 'Documents'
  $f = Join-Path $docs 'secret.txt'
  [IO.File]::WriteAllText($f, 'S4 secret payload', [Text.Encoding]::ASCII)
  attrib.exe -H $f | Out-Null
  # State-scoped pre-stage: a new Explorer HWND with secret.txt selected.
  $doc = ([string][char]0x6587) + ([string][char]0x6863)   # wen-dang (folder leaf title)
  $stateFile = Join-Path (Get-TaskDir) 'test-explorer.json'
  $s = Open-TestExplorer -Path $docs -TitleNeedle @('Documents', $doc) -StateFile $stateFile -SelectFile $f
  $attr = (Get-Item -Force $f).Attributes
  $checks += (Add-Check 'secret.txt prepared, visible' ((Test-Path $f) -and (($attr -band [IO.FileAttributes]::Hidden) -eq 0)) ('attr=' + $attr))
  $checks += (Add-Check 'explorer parked with file selected' ([bool]$s.ok) ("hwnd=$($s.hwnd) title=$($s.title) reason=$($s.reason)"))
  Out-Finish -Ok ((Test-Path $f) -and [bool]$s.ok) -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
