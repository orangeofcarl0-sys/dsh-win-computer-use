param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  $web = New-TaskDir 'web'
  $out = New-TaskDir 'out'
  [void](New-TaskDir 'state')
  $html = Join-Path $web 's4-t17-doc.html'
  $sentence = 'S4-T17: The quick brown fox jumps over the lazy dog.'
  $body = '<html><body style="font:22px Segoe UI;margin:60px"><h1>Page 1</h1><p>Warm-up page.</p><div style="page-break-after:always"></div><h1>Page 2</h1><p>More context.</p><div style="page-break-after:always"></div><h1>Page 3</h1><p id="target">' + $sentence + '</p></body></html>'
  [IO.File]::WriteAllText($html, $body, (New-Object System.Text.UTF8Encoding($false)))
  $pdf = Join-Path $web 's4-t17-doc.pdf'
  $pr = New-TestPdfFromFile -HtmlPath $html -PdfPath $pdf
  $checks += (Add-Check 'local PDF generated' ([bool]$pr.ok) ("size=$($pr.size) reason=$($pr.reason)"))
  if (-not $pr.ok) { Out-Finish -Ok $false -Checks $checks -Kind 'setup' -EnvError ("PDF generation failed: " + $pr.reason) }
  $startedAt = (Get-Date).ToUniversalTime()

  $viewerState = Join-Path $base 'viewer.json'
  $url = [System.Uri]::new($pdf).AbsoluteUri + '#page=3'
  $viewer = Open-TestBrowserWindow -Url $url -TitleNeedle 's4-t17-doc' -StateFile $viewerState
  $checks += (Add-Check 'PDF browser window' ([bool]$viewer.ok) ("hwnd=$($viewer.hwnd) title=$($viewer.title) reason=$($viewer.reason)"))

  $seed = Join-Path $base 'seed.xlsx'
  $blank = 'C:\Program Files\Microsoft Office\root\vfs\Windows\SHELLNEW\EXCEL12.XLSX'
  $x = [ordered]@{ ok = $false; hwnd = 0; title = ''; reason = "seed missing: $blank" }
  if (Test-Path $blank) {
    Copy-Item $blank $seed -Force
    $excelExe = Join-Path $env:ProgramFiles 'Microsoft Office\root\Office16\EXCEL.EXE'
    if (Test-Path $excelExe) {
      $x = Open-TestAppWindow -Exe $excelExe -Arguments @($seed) -ProcessName 'EXCEL' -TitleNeedle @('seed.xlsx', 'seed') -StateFile (Join-Path $base 'excel.json') -TimeoutSec 30
    }
  }
  $checks += (Add-Check 'Excel test window' ([bool]$x.ok) ("hwnd=$($x.hwnd) title=$($x.title) reason=$($x.reason)"))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{ startedAt = $startedAt.ToString('o'); pdf = $pdf; sentence = $sentence }))
  $ok = [bool]$viewer.ok -and [bool]$x.ok
  $envErr = ''
  if (-not $ok) { $envErr = "browser/Excel unavailable: $($viewer.reason) $($x.reason)" }
  Out-Finish -Ok $ok -Checks $checks -Kind 'setup' -EnvError $envErr
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
