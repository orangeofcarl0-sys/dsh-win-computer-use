param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
$dirty = $false
try {
  $base = Get-TaskDir
  $state = Read-TestState (Join-Path $base 'state.json')
  if ($state) {
    $started = [datetime]::Parse([string]$state.startedAt).ToUniversalTime()
    $removed = @(Remove-S4MatchedDownloads -Dir (Get-S4DownloadsDir) -StartedAt $started -ExpectedHash ([string]$state.expectedHash))
    $checks += (Add-Check 'only hash-matched new PDFs removed' $true ("removed=$($removed.Count)"))
  }
  $browserState = Join-Path $base 'browser.json'
  $b = Close-TestBrowserWindow -StateFile $browserState
  if (-not $b.closed) {
    $checks += (Add-Check 'test browser window left open' $false ("reason=$($b.reason) title=$($b.title)"))
    [void](Save-LeftoverState -TaskId $TaskId -StateFile $browserState -Result ([ordered]@{ reason = $b.reason; leftover = $b.title }))
    $dirty = $true
  }
  $sent = Close-TestSentinel -StateFile (Join-Path (Get-TaskDir) 'sentinel.json')
  $checks += (Add-Check 'sentinel closed' ([bool]$sent.closed) $sent.reason)
  if (-not $sent.closed) {
    [void](Save-LeftoverState -TaskId $TaskId -StateFile (Join-Path (Get-TaskDir) 'sentinel.json') -Result ([ordered]@{ reason = $sent.reason; leftover = $sent.title }))
    $dirty = $true
  }
  Remove-TaskDir
  Out-Finish -Ok $true -Checks $checks -Kind 'cleanup' -Dirty $dirty
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'cleanup'
}
