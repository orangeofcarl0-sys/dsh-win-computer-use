param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $sent = Open-TestSentinel -TaskId $TaskId -StateFile (Join-Path $base 'sentinel.json')
  $checks += (Add-Check 'sentinel opened' ([bool]$sent.ok) ("hwnd=$($sent.hwnd) reason=$($sent.reason)"))
  if (-not $sent.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ('sentinel unavailable: ' + $sent.reason) }

  $web = New-TaskDir 'web'
  $out = New-TaskDir 'out'
  $html = Join-Path $web 's4-combo1-doc.html'
  $body = '<html><body style="font:22px Segoe UI;margin:60px"><h1>S4 COMBO1</h1><p id="target">S4 COMBO1: TOTAL 42</p></body></html>'
  [IO.File]::WriteAllText($html, $body, (New-Object System.Text.UTF8Encoding($false)))
  $pdf = Join-Path $web 's4-combo1-doc.pdf'
  $pr = New-TestPdfFromFile -HtmlPath $html -PdfPath $pdf
  $checks += (Add-Check 'local PDF generated' ([bool]$pr.ok) ("size=$($pr.size) reason=$($pr.reason)"))
  if (-not $pr.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("PDF generation failed: " + $pr.reason) }
  $pdfHash = Get-S4Sha256 $pdf

  $blank = 'C:\Program Files\Microsoft Office\root\vfs\Windows\SHELLNEW\EXCEL12.XLSX'
  $xlsx = Join-Path $out 'data.xlsx'
  if (-not (Test-Path $blank)) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError 'EXCEL12.XLSX shell seed missing' }
  Copy-Item $blank $xlsx -Force
  $xlsxSeedHash = Get-S4Sha256 $xlsx
  $excelExe = Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\EXCEL.EXE'
  $excel = [ordered]@{ ok = $false; hwnd = 0; title = ''; reason = "not found: $excelExe" }
  if (Test-Path $excelExe) {
    $excel = Open-TestAppWindow -Exe $excelExe -Arguments @($xlsx) -ProcessName 'EXCEL' -TitleNeedle @('data.xlsx', 'data') -StateFile (Join-Path $base 'excel.json') -TimeoutSec 30
  }
  $checks += (Add-Check 'Excel test window' ([bool]$excel.ok) ("hwnd=$($excel.hwnd) title=$($excel.title) reason=$($excel.reason)"))

  $pptx = Join-Path $out 'summary.pptx'
  $pptSeed = New-S4WidescreenPptxSeed -Path $pptx -Title 'S4 COMBO1 DECK' -Subtitle 'From PDF to Excel' -BarPrefix 'C1 Bar'
  $checks += (Add-Check 'PowerPoint seed' ([bool]$pptSeed.ok) $pptSeed.reason)
  if (-not $pptSeed.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ('PowerPoint seed unavailable: ' + $pptSeed.reason) }
  $pptSeedHash = Get-S4Sha256 $pptx
  $pptExe = Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\POWERPNT.EXE'
  $ppt = [ordered]@{ ok = $false; hwnd = 0; title = ''; reason = "not found: $pptExe" }
  if (Test-Path $pptExe) {
    $ppt = Open-TestAppWindow -Exe $pptExe -Arguments @($pptx) -ProcessName 'POWERPNT' -TitleNeedle @('summary.pptx', 'summary') -StateFile (Join-Path $base 'ppt.json') -TimeoutSec 30
    if ($ppt.ok) { Maximize-TestWindow ([int]$ppt.hwnd) }
  }
  $checks += (Add-Check 'PowerPoint test window' ([bool]$ppt.ok) ("hwnd=$($ppt.hwnd) title=$($ppt.title) reason=$($ppt.reason)"))

  $url = [System.Uri]::new($pdf).AbsoluteUri
  $viewer = Open-TestBrowserWindow -Url $url -TitleNeedle 's4-combo1-doc' -StateFile (Join-Path $base 'viewer.json')
  $checks += (Add-Check 'PDF browser window' ([bool]$viewer.ok) ("hwnd=$($viewer.hwnd) title=$($viewer.title) reason=$($viewer.reason)"))

  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    pdf = $pdf; pdfHash = $pdfHash
    xlsx = $xlsx; xlsxSeedHash = $xlsxSeedHash
    pptx = $pptx; pptSeedHash = $pptSeedHash
    sentence = 'S4 COMBO1: TOTAL 42'; expected = '42'; pptText = 'S4 COMBO1 DONE'
  }))
  $ok = [bool]$excel.ok -and [bool]$ppt.ok -and [bool]$viewer.ok
  $envErr = ''
  if (-not $ok) { $envErr = "Excel/PowerPoint/browser unavailable: $($excel.reason) $($ppt.reason) $($viewer.reason)" }
  Out-Finish -Ok $ok -Checks $checks -Kind 'setup' -EnvError $envErr
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
