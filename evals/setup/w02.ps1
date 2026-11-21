param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $srcDir = New-TaskDir 'src'
  $outDir = New-TaskDir 'out'
  $seed = Join-Path $srcDir 'seed.docx'
  if (Test-Path $seed) { Remove-Item $seed -Force }
  New-Docx -Path $seed -Text 'S4 W02 seed'
  $seedHash = Get-S4Sha256Shared $seed
  $startedAt = (Get-Date).ToUniversalTime()
  $wordExe = Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\WINWORD.EXE'
  $word = [ordered]@{ ok = $false; hwnd = 0; title = ''; reason = "not found: $wordExe" }
  $wordState = Join-Path $base 'word.json'
  if (Test-Path $wordExe) {
    $word = Open-TestAppWindow -Exe $wordExe -Arguments @($seed) -ProcessName 'WINWORD' -TitleNeedle @('seed.docx') -StateFile $wordState -TimeoutSec 30
    if ($word.ok) { Maximize-TestWindow ([int]$word.hwnd) }
  }
  $checks += (Add-Check 'Word test window' ([bool]$word.ok) ("hwnd=$($word.hwnd) title=$($word.title) reason=$($word.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = $startedAt.ToString('o'); seed = $seed; seedHash = $seedHash
    output = (Join-Path $outDir 'report.docx')
  }))
  if (-not $word.ok) {
    Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("Word unavailable: " + $word.reason)
  }
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
