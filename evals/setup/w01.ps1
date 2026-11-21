param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $outDir = New-TaskDir 'out'
  $doc = Join-Path $outDir 'report.docx'
  if (Test-Path $doc) { Remove-Item $doc -Force }
  New-Docx -Path $doc -Text 'S4 W01 original'
  $seedHash = Get-S4Sha256 $doc
  $startedAt = (Get-Date).ToUniversalTime()
  $wordExe = Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\WINWORD.EXE'
  $word = [ordered]@{ ok = $false; hwnd = 0; title = ''; reason = "not found: $wordExe" }
  $wordState = Join-Path $base 'word.json'
  if (Test-Path $wordExe) {
    $word = Open-TestAppWindow -Exe $wordExe -Arguments @($doc) -ProcessName 'WINWORD' -TitleNeedle @('report.docx') -StateFile $wordState -TimeoutSec 30
    if ($word.ok) { Maximize-TestWindow ([int]$word.hwnd) }
  }
  $checks += (Add-Check 'Word test window' ([bool]$word.ok) ("hwnd=$($word.hwnd) title=$($word.title) reason=$($word.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = $startedAt.ToString('o'); doc = $doc; seedHash = $seedHash
  }))
  if (-not $word.ok) {
    Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("Word unavailable: " + $word.reason)
  }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
