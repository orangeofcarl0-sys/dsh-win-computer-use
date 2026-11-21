param()
$ErrorActionPreference = 'Stop'
$paths = [ordered]@{}
$candidates = @{
  vscode = @(
    (Join-Path $env:ProgramFiles 'Microsoft VS Code\Code.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\Code.exe')
  )
  vlc = @(
    (Join-Path $env:ProgramFiles 'VideoLAN\VLC\vlc.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'VideoLAN\VLC\vlc.exe')
  )
  windowsTerminal = @(
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\wt.exe')
  )
  settings = @(
    (Join-Path $env:WINDIR 'System32\SystemSettings.exe'),
    (Join-Path $env:WINDIR 'ImmersiveControlPanel\SystemSettings.exe')
  )
  wsl = @(
    (Join-Path $env:WINDIR 'System32\wsl.exe')
  )
}
foreach ($k in $candidates.Keys) {
  $found = ''
  foreach ($p in @($candidates[$k])) { if ($p -and (Test-Path $p)) { $found = $p; break } }
  $paths[$k] = $found
}
$langs = @()
try {
  foreach ($l in @(Get-WinUserLanguageList)) { $langs += [string]$l.LanguageTag }
} catch {}
[ordered]@{
  ok = $true
  paths = $paths
  languages = $langs
  cjk = [bool](@($langs | Where-Object { $_ -match '^(zh|ja|ko)' }).Count -gt 0)
} | ConvertTo-Json -Compress -Depth 6
