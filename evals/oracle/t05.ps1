param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$expected = 'S4-T05 ANSI check ' + [char]0x00E9 + '.'
try {
  $f = Join-Path (Get-TaskDir) 'saveas\out-ansi.txt'
  if (-not (Test-Path $f)) {
    $checks += (Add-Check 'file exists' $false $f)
    Out-Finish -Ok $false -Checks $checks
  }
  $checks += (Add-Check 'file exists' $true $f)
  $bytes = [IO.File]::ReadAllBytes($f)
  $bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
  $c1 = (-not $bom)
  $checks += (Add-Check 'no UTF-8 BOM (ANSI)' $c1 ('first3=' + (($bytes | Select-Object -First 3 | ForEach-Object { $_.ToString('X2') }) -join ' ')))
  $nonAscii = @($bytes | Where-Object { $_ -gt 0x7F })
  $checks += (Add-Check 'non-ASCII byte present' ($nonAscii.Count -gt 0) ('count=' + $nonAscii.Count))
  $text = [Text.Encoding]::Default.GetString($bytes)
  $norm = $text -replace "`r`n", "`n"
  $c2 = ($norm.Trim() -ceq $expected)
  $checks += (Add-Check 'content match' $c2 ('read=' + $norm.Trim()))
  # 另存为默认源目录陷阱：第一次只改文件名就保存会留下 src\out-ansi.txt。
  $taskDir = [IO.Path]::GetDirectoryName([IO.Path]::GetDirectoryName($f))
  $strayFile = [IO.Path]::Combine($taskDir, 'src\out-ansi.txt')
  $strayOk = -not (Test-Path $strayFile)
  $checks += (Add-Check 'no stray out-ansi.txt in src' $strayOk $strayFile)
  Out-Finish -Ok ($c1 -and $c2 -and ($nonAscii.Count -gt 0) -and $strayOk) -Checks $checks
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message
}
