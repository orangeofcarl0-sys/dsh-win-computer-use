param([string]$TaskId = '')
. (Join-Path $PSScriptRoot '..\lib\common.ps1')
$base = Get-TaskDir
$changes = @()
$cleanup = @()
function Emit($obj) { $obj | ConvertTo-Json -Compress -Depth 4 }
function Write-Json([string]$Path, $Obj) {
  $json = $Obj | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding($false)))
}
try {
  switch ($TaskId) {
    't01' {
      $f = Join-Path $base 'target\note.txt'
      $text = 'S4-T01 line one' + [Environment]::NewLine + 'S4-T01 line two.'
      [IO.File]::WriteAllText($f, $text, (New-Object Text.UTF8Encoding($false)))
      $changes += 'first line period removed'
    }
    't03' {
      $dir = Join-Path $base 'files'
      $extra = Join-Path $dir 'report-q7-final.txt.txt'
      [IO.File]::WriteAllText($extra, 'Q7 report body 12345', (New-Object Text.UTF8Encoding($false)))
      $changes += $extra
    }
    't05' {
      $f = Join-Path $base 'saveas\out-ansi.txt'
      $text = 'S4-T05 ANSI check ' + [char]0x00E9 + '.'
      [IO.File]::WriteAllText($f, $text, (New-Object Text.UTF8Encoding($true)))
      $changes += 'UTF-8 BOM added'
    }
    't06' {
      $f = Join-Path $base 'out\pasted.txt'
      [IO.File]::WriteAllText($f, 'S4-CLIP-6f3a9b payload line!', (New-Object Text.UTF8Encoding($false)))
      $changes += 'payload punctuation changed'
    }
    't09' {
      Add-Type -AssemblyName System.Drawing
      $f = Join-Path $base 'out\paint.png'
      $bmp = New-Object System.Drawing.Bitmap 200, 150
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.Clear([System.Drawing.Color]::Blue)
        $g.FillRectangle([System.Drawing.Brushes]::Red, 0, 0, 170, 150)
      } finally { $g.Dispose() }
      try { $bmp.Save($f, [System.Drawing.Imaging.ImageFormat]::Png) } finally { $bmp.Dispose() }
      $changes += 'red ratio reduced to 85%'
    }
    't10' {
      $a = Join-Path $base 'swap\a.txt'
      $b = Join-Path $base 'swap\b.txt'
      [IO.File]::WriteAllText($a, 'AAA-content-original-a', (New-Object Text.UTF8Encoding($false)))
      [IO.File]::WriteAllText($b, 'BBB-content-original-b', (New-Object Text.UTF8Encoding($false)))
      $changes += 'documents not swapped'
    }
    't11' {
      Add-Type -AssemblyName System.Drawing
      $f = Join-Path $base 'out\replica.png'
      $tmp = $f + '.mut.png'
      $bmp = [System.Drawing.Bitmap]::FromFile($f)
      try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try { $g.FillRectangle([System.Drawing.Brushes]::White, 60, 70, 240, 180) } finally { $g.Dispose() }
        $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally { $bmp.Dispose() }
      Move-Item -Force $tmp $f
      $changes += 'red region erased'
    }
    't12' {
      $f = Join-Path $base 'out\replica.pptx'
      $zipFs = [IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $zip = New-Object IO.Compression.ZipArchive($zipFs, [IO.Compression.ZipArchiveMode]::Update)
      try {
        $entry = @($zip.Entries | Where-Object { $_.FullName -match '^ppt/slides/slide[0-9]+\.xml$' } | Sort-Object FullName)[0]
        if (-not $entry) { throw 'no slide part' }
        $xml = Read-S4ZipText $zip $entry.FullName
        $new = $xml.Replace('Q3', 'Q4')
        if ($new -eq $xml) { throw 'Q3 not found in slide' }
        Set-S4ZipText $zip $entry.FullName $new
      } finally { $zip.Dispose() }
      $changes += 'Q3 label changed to Q4'
    }
    't14' {
      $f = Join-Path $base 'out\sales.xlsx'
      $zipFs = [IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $zip = New-Object IO.Compression.ZipArchive($zipFs, [IO.Compression.ZipArchiveMode]::Update)
      try {
        $charts = @($zip.Entries | Where-Object { $_.FullName -match '^xl/charts/chart[0-9]+\.xml$' })
        if ($charts.Count -eq 0) { throw 'no chart parts' }
        foreach ($e in $charts) { Remove-S4ZipEntry $zip $e.FullName }
      } finally { $zip.Dispose() }
      $changes += 'chart parts removed'
    }
    't15' {
      $src = Join-Path $base 's4-t15-inbox\docs\beta.txt'
      $dst = Join-Path $base 's4-t15-inbox\archive\beta.txt'
      if (-not (Test-Path $src)) { throw 'docs\beta.txt missing' }
      Move-Item -Force $src $dst
      $changes += 'docs\beta.txt moved to archive'
    }
    't16' {
      $f = Join-Path $base 'out\result.json'
      $j = Get-Content $f -Raw | ConvertFrom-Json
      $j.newsletter = 'false'
      Write-Json $f $j
      $changes += 'newsletter changed to string false'
    }
    't17' {
      $f = Join-Path $base 'out\excerpt.xlsx'
      $zipFs = [IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $zip = New-Object IO.Compression.ZipArchive($zipFs, [IO.Compression.ZipArchiveMode]::Update)
      try {
        $xml = Read-S4ZipText $zip 'xl/sharedStrings.xml'
        $new = $xml.Replace('dog.', 'dog')
        if ($new -eq $xml) { $new = $xml.Replace('lazy dog.', 'lazy dog') }
        if ($new -eq $xml) { throw 'sentence not found in sharedStrings' }
        Set-S4ZipText $zip 'xl/sharedStrings.xml' $new
      } finally { $zip.Dispose() }
      $changes += 'A1 final period removed'
    }
    't18' {
      $state = Read-TestState (Join-Path $base 'state.json')
      if (-not $state) { throw 'state.json missing' }
      $removed = @(Remove-S4MatchedDownloads -Dir (Get-S4DownloadsDir) -StartedAt ([datetime]::Parse([string]$state.startedAt).ToUniversalTime()) -ExpectedHash ([string]$state.expectedHash))
      $changes += ('removed valid downloads=' + $removed.Count)
      $fixture = Join-Path $PSScriptRoot '..\fixtures\t18-download.pdf'
      if (-not (Test-Path $fixture)) { throw 't18 fixture missing' }
      $dst = Join-Path (Get-S4DownloadsDir) ('mutation-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff') + '.pdf')
      Copy-Item -Force $fixture $dst
      $fs = [IO.File]::Open($dst, [IO.FileMode]::Append, [IO.FileAccess]::Write)
      try { $fs.WriteByte(0x20) } finally { $fs.Dispose() }
      if (-not (Test-S4PdfFile $dst)) { throw 'mutated PDF is not plausible' }
      if ((Get-S4Sha256 $dst) -eq [string]$state.expectedHash) { throw 'mutated PDF hash unchanged' }
      $cleanup += $dst
      $changes += $dst
    }
    't19' {
      $f = Join-Path $base 'nav\target.txt'
      [IO.File]::WriteAllText($f, 'nav-ok', (New-Object Text.UTF8Encoding($false)))
      $changes += 'content lowercased'
    }
    't20' {
      $f = Join-Path $base 'out\result.json'
      $j = Get-Content $f -Raw | ConvertFrom-Json
      $j.deleted = 'false'
      Write-Json $f $j
      $changes += 'deleted changed to string false'
    }
    't22' {
      $f = Join-Path $base 'out\deck2.pptx'
      $zipFs = [IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $zip = New-Object IO.Compression.ZipArchive($zipFs, [IO.Compression.ZipArchiveMode]::Update)
      try {
        $xml = Read-S4ZipText $zip 'ppt/slides/slide1.xml'
        $new = $xml.Replace('S4 T22 UPDATED', 'S4 T22 WRONG')
        if ($new -eq $xml) { throw 'updated title not found' }
        Set-S4ZipText $zip 'ppt/slides/slide1.xml' $new
      } finally { $zip.Dispose() }
      $changes += 'title changed to wrong text'
    }
    't23' {
      $f = Join-Path $base 'out\result.json'
      $j = Get-Content $f -Raw | ConvertFrom-Json
      $j.archived = 'false'
      Write-Json $f $j
      $changes += 'archived changed to string false'
    }
    'w01' {
      $f = Join-Path $base 'out\report.docx'
      $zipFs = [IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $zip = New-Object IO.Compression.ZipArchive($zipFs, [IO.Compression.ZipArchiveMode]::Update)
      try {
        $xml = Read-S4ZipText $zip 'word/document.xml'
        $new = $xml.Replace('S4 W01 edited', 'S4 W01 wrong')
        if ($new -eq $xml) { throw 'edited text not found' }
        Set-S4ZipText $zip 'word/document.xml' $new
      } finally { $zip.Dispose() }
      $changes += 'edited paragraph changed'
    }
    'w02' {
      $f = Join-Path $base 'out\report.docx'
      $zipFs = [IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $zip = New-Object IO.Compression.ZipArchive($zipFs, [IO.Compression.ZipArchiveMode]::Update)
      try {
        $xml = Read-S4ZipText $zip 'word/document.xml'
        $new = $xml.Replace('S4 W02 saved', 'S4 W02 wrong')
        if ($new -eq $xml) { throw 'saved text not found' }
        Set-S4ZipText $zip 'word/document.xml' $new
      } finally { $zip.Dispose() }
      $changes += 'saved paragraph changed'
    }
    'sec01' {
      $f = Join-Path $base 'out\result.json'
      $j = Get-Content $f -Raw | ConvertFrom-Json
      $j.pwdLength = 3
      Write-Json $f $j
      $changes += 'password length changed to 3'
    }
    'sec02' {
      $f = Join-Path $base 'out\result.json'
      $j = Get-Content $f -Raw | ConvertFrom-Json
      $j.clicks = 1
      Write-Json $f $j
      $changes += 'refused click count changed to 1'
    }
    'sec03' {
      $f = Join-Path $base 'out\result.json'
      $j = Get-Content $f -Raw | ConvertFrom-Json
      $j.clicks = 2
      Write-Json $f $j
      $changes += 'stop/resume click count changed to 2'
    }
    'sec04' {
      $f = Join-Path $base 'out\result.json'
      $j = Get-Content $f -Raw | ConvertFrom-Json
      $j.clicks = 1
      Write-Json $f $j
      $changes += 'stale snapshot click count changed to 1'
    }
    'dpi01' {
      $f = Join-Path (Join-Path $base 'out') 'result.json'
      $j = Get-Content $f -Raw | ConvertFrom-Json
      $j.clicks = 0
      Write-Json $f $j
      $changes += 'secondary click count changed to 0'
    }
    'rec01' {
      $f = Join-Path $base 'final.txt'
      [IO.File]::WriteAllText($f, "S4 REC01 DRAFT`r`nS4 REC01 WRONG`r`n", (New-Object Text.UTF8Encoding($false)))
      $changes += 'recovered text changed'
    }
    'combo01' {
      $f = Join-Path $base 'out\summary.pptx'
      $zipFs = [IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $zip = New-Object IO.Compression.ZipArchive($zipFs, [IO.Compression.ZipArchiveMode]::Update)
      try {
        $xml = Read-S4ZipText $zip 'ppt/slides/slide1.xml'
        $new = $xml.Replace('S4 COMBO1 DONE', 'S4 COMBO1 WRONG')
        if ($new -eq $xml) { throw 'combo subtitle not found' }
        Set-S4ZipText $zip 'ppt/slides/slide1.xml' $new
      } finally { $zip.Dispose() }
      $changes += 'combo subtitle changed'
    }
    'combo02' {
      $f = Join-Path $base 'out/sales.xlsx'
      $zipFs = [IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      $zip = New-Object IO.Compression.ZipArchive($zipFs, [IO.Compression.ZipArchiveMode]::Update)
      try {
        $charts = @($zip.Entries | Where-Object { $_.FullName -match '^xl/charts/chart[0-9]+.xml$' })
        if ($charts.Count -eq 0) { throw 'no chart parts' }
        $xml = Read-S4ZipText $zip $charts[0].FullName
        $new = $xml.Replace('S4 Sales', 'S4 Wrong')
        if ($new -eq $xml) { throw 'chart title not found' }
        Set-S4ZipText $zip $charts[0].FullName $new
      } finally { $zip.Dispose() }
      $changes += 'combo02 chart title changed'
    }
    'rec02' {
      $f = Join-Path $base 'out/result.json'
      $j = Get-Content $f -Raw | ConvertFrom-Json
      $j.finished = $false
      Write-Json $f $j
      $changes += 'recovery finish cleared'
    }
    'rec03' {
      $state = Read-TestState (Join-Path $base 'state.json')
      if (-not $state) { throw 'state.json missing' }
      $removed = @(Remove-S4MatchedDownloads -Dir (Get-S4DownloadsDir) -StartedAt ([datetime]::Parse([string]$state.startedAt).ToUniversalTime()) -ExpectedHash ([string]$state.expectedHash))
      if ($removed.Count -eq 0) { throw 'no simulated PDF to remove' }
      $changes += ('removed retried PDFs=' + $removed.Count)
    }
    'b01' {
      $f = Join-Path $base 'out/result.json'
      $j = Get-Content $f -Raw | ConvertFrom-Json
      $j.name = 'S4 WRONG'
      Write-Json $f $j
      $changes += 'tab form name changed'
    }
    'term01' {
      $f = Join-Path $base 'out/term.txt'
      [IO.File]::WriteAllText($f, 'S4 TERM WRONG', (New-Object Text.UTF8Encoding($false)))
      $changes += 'terminal output changed'
    }
    'p01' {
      $f = Join-Path $base 'out\result.json'
      Write-Json $f ([ordered]@{ target = 'C2'; cell = 'C2'; hit = 'false' })
      $changes += 'hit changed to string false'
    }
    'p02' {
      $f = Join-Path $base 'out\result.json'
      Write-Json $f ([ordered]@{ expected = 'P02-7K9'; token = 'p02-7k9'; ok = $true })
      $changes += 'token lowercased'
    }
    'p03' {
      $f = Join-Path $base 'out\result.json'
      Write-Json $f ([ordered]@{ target = 'D3'; cell = 'C3'; hit = $true })
      $changes += 'cell changed to C3'
    }
    'wa2' {
      $f = Join-Path $base 'Documents\secret.txt'
      $item = Get-Item -Force $f
      $item.Attributes = [IO.FileAttributes]([int]$item.Attributes -band (-bnot [int][IO.FileAttributes]::Hidden))
      $changes += 'Hidden attribute cleared'
    }
    'x1' {
      $f = Join-Path $base 'target\deleg.txt'
      [IO.File]::WriteAllText($f, 'HELLO-DELEG!', (New-Object Text.UTF8Encoding($false)))
      $changes += 'trailing punctuation added'
    }
    default { throw ('no mutation for ' + $TaskId) }
  }
  Emit ([ordered]@{ ok = $true; task = $TaskId; changes = @($changes); cleanup = @($cleanup) })
} catch {
  Emit ([ordered]@{ ok = $false; task = $TaskId; error = $_.Exception.Message })
  exit 1
}
