param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$checks = @()
try {
  $base = Get-TaskDir
  [void](New-TaskDir)
  $draft = Join-Path $base 'draft.txt'
  [IO.File]::WriteAllText($draft, "S4 REC01 DRAFT`r`n", (New-Object System.Text.UTF8Encoding($false)))
  [void](Write-TestState (Join-Path $base 'state.json') ([ordered]@{
    startedAt = (Get-Date).ToUniversalTime().ToString('o'); draft = $draft
  }))
  $checks += (Add-Check 'draft created' (Test-Path $draft) $draft)
  Out-Finish -Ok $true -Checks $checks -Kind 'setup'
} catch {
  Out-Finish -Ok $false -Checks $checks -EnvError $_.Exception.Message -Kind 'setup'
}
