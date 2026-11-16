# S4 OOXML readers (PowerShell 5.1, ASCII-only). No Office/COM dependency.
# XPath uses local-name() so it does not depend on XmlNamespaceManager quirks.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Open-S4Zip([string]$Path) {
  $fs = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  return New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Read)
}

function Read-S4ZipText($Zip, [string]$Name) {
  $e = $Zip.GetEntry($Name)
  if (-not $e) { return $null }
  $sr = New-Object IO.StreamReader($e.Open(), [Text.Encoding]::UTF8)
  $txt = $sr.ReadToEnd()
  $sr.Dispose()
  return $txt
}

function Read-S4Xml($Zip, [string]$Name) {
  $txt = Read-S4ZipText $Zip $Name
  if (-not $txt) { return $null }
  $doc = New-Object System.Xml.XmlDocument
  $doc.PreserveWhitespace = $false
  $doc.LoadXml($txt)
  return $doc
}

function Get-S4Attr($Node, [string]$Name) {
  if (-not $Node) { return '' }
  $a = $Node.Attributes[$Name]
  if ($a) { return [string]$a.Value }
  return ''
}

function Read-PptxTheme($Zip) {
  $map = @{}
  $doc = Read-S4Xml $Zip 'ppt/theme/theme1.xml'
  if (-not $doc) { return $map }
  $scheme = $doc.SelectSingleNode("//*[local-name()='clrScheme']")
  if (-not $scheme) { return $map }
  foreach ($child in @($scheme.ChildNodes)) {
    if ($child.NodeType -ne 'Element') { continue }
    $name = $child.LocalName
    $srgb = $child.SelectSingleNode("*[local-name()='srgbClr']")
    $sys = $child.SelectSingleNode("*[local-name()='sysClr']")
    $val = ''
    if ($srgb) { $val = Get-S4Attr $srgb 'val' }
    elseif ($sys) { $val = Get-S4Attr $sys 'lastClr' }
    if ($val) { $map[$name] = $val.ToUpperInvariant() }
  }
  return $map
}

function Get-S4FillColor($Shape, $Theme) {
  $solid = $Shape.SelectSingleNode(".//*[local-name()='solidFill']")
  if (-not $solid) { return '' }
  $srgb = $solid.SelectSingleNode("*[local-name()='srgbClr']")
  if ($srgb) { return (Get-S4Attr $srgb 'val').ToUpperInvariant() }
  $scheme = $solid.SelectSingleNode("*[local-name()='schemeClr']")
  if ($scheme) {
    $k = Get-S4Attr $scheme 'val'
    if ($Theme.ContainsKey($k)) { return $Theme[$k] }
  }
  return ''
}

function Read-PptxManifest([string]$Path) {
  $zip = Open-S4Zip $Path
  try {
    $pres = Read-S4Xml $zip 'ppt/presentation.xml'
    $size = $pres.SelectSingleNode("//*[local-name()='sldSz']")
    $cx = [double](Get-S4Attr $size 'cx')
    $cy = [double](Get-S4Attr $size 'cy')
    $theme = Read-PptxTheme $zip
    $slides = @()
    $slideEntries = @($zip.Entries | Where-Object { $_.FullName -match '^ppt/slides/slide[0-9]+\.xml$' } | Sort-Object FullName)
    foreach ($e in $slideEntries) {
      $doc = Read-S4Xml $zip $e.FullName
      $texts = @()
      foreach ($t in @($doc.SelectNodes("//*[local-name()='t']"))) { $texts += [string]$t.InnerText }
      $shapes = @()
      foreach ($sp in @($doc.SelectNodes("//*[local-name()='sp']"))) {
        $xfrm = $sp.SelectSingleNode(".//*[local-name()='xfrm']")
        $off = if ($xfrm) { $xfrm.SelectSingleNode("*[local-name()='off']") } else { $null }
        $ext = if ($xfrm) { $xfrm.SelectSingleNode("*[local-name()='ext']") } else { $null }
        $geom = $sp.SelectSingleNode(".//*[local-name()='prstGeom']")
        $nameNode = $sp.SelectSingleNode(".//*[local-name()='cNvPr']")
        $txt = @()
        foreach ($t in @($sp.SelectNodes(".//*[local-name()='t']"))) { $txt += [string]$t.InnerText }
        $shapes += [ordered]@{
          name = Get-S4Attr $nameNode 'name'
          geom = Get-S4Attr $geom 'prst'
          fill = Get-S4FillColor $sp $theme
          xIn = if ($off) { [math]::Round(([double](Get-S4Attr $off 'x')) / 914400.0, 3) } else { 0 }
          yIn = if ($off) { [math]::Round(([double](Get-S4Attr $off 'y')) / 914400.0, 3) } else { 0 }
          wIn = if ($ext) { [math]::Round(([double](Get-S4Attr $ext 'cx')) / 914400.0, 3) } else { 0 }
          hIn = if ($ext) { [math]::Round(([double](Get-S4Attr $ext 'cy')) / 914400.0, 3) } else { 0 }
          text = (($txt -join '') -replace '\s+', ' ').Trim()
        }
      }
      $slides += [ordered]@{ name = $e.FullName; texts = $texts; shapes = $shapes }
    }
    return [ordered]@{
      slideCount = $slideEntries.Count
      slideWidthIn = if ($cx) { [math]::Round($cx / 914400.0, 3) } else { 0 }
      slideHeightIn = if ($cy) { [math]::Round($cy / 914400.0, 3) } else { 0 }
      slides = $slides
      theme = $theme
    }
  } finally {
    $zip.Dispose()
  }
}

function Read-XlsxManifest([string]$Path) {
  $zip = Open-S4Zip $Path
  try {
    $shared = @()
    $ss = Read-S4Xml $zip 'xl/sharedStrings.xml'
    if ($ss) {
      foreach ($si in @($ss.SelectNodes("//*[local-name()='si']"))) {
        $parts = @()
        foreach ($t in @($si.SelectNodes(".//*[local-name()='t']"))) { $parts += [string]$t.InnerText }
        $shared += ($parts -join '')
      }
    }
    $cells = [ordered]@{}
    $sheet = Read-S4Xml $zip 'xl/worksheets/sheet1.xml'
    if ($sheet) {
      foreach ($c in @($sheet.SelectNodes("//*[local-name()='c']"))) {
        $ref = Get-S4Attr $c 'r'
        $type = Get-S4Attr $c 't'
        $v = $c.SelectSingleNode("*[local-name()='v']")
        $is = $c.SelectSingleNode("*[local-name()='is']")
        $val = ''
        if ($is) {
          $parts = @()
          foreach ($t in @($is.SelectNodes(".//*[local-name()='t']"))) { $parts += [string]$t.InnerText }
          $val = ($parts -join '')
        } elseif ($v) {
          $val = [string]$v.InnerText
          if ($type -eq 's') {
            $idx = 0
            if ([int]::TryParse($val, [ref]$idx) -and $idx -ge 0 -and $idx -lt $shared.Count) { $val = $shared[$idx] }
          }
        }
        if ($ref) { $cells[$ref] = $val }
      }
    }
    $charts = @()
    foreach ($e in @($zip.Entries | Where-Object { $_.FullName -match '^xl/charts/chart[0-9]+\.xml$' } | Sort-Object FullName)) {
      $doc = Read-S4Xml $zip $e.FullName
      if (-not $doc) { continue }
      $kind = ''
      foreach ($k in @('barChart','lineChart','pieChart','doughnutChart','areaChart','scatterChart')) {
        if ($doc.SelectSingleNode("//*[local-name()='" + $k + "']")) { $kind = $k; break }
      }
      $title = ''
      $tn = $doc.SelectSingleNode("//*[local-name()='title']//*[local-name()='t']")
      if ($tn) { $title = [string]$tn.InnerText }
      $series = @()
      foreach ($ser in @($doc.SelectNodes("//*[local-name()='ser']"))) {
        $name = ''
        $tx = $ser.SelectSingleNode(".//*[local-name()='tx']//*[local-name()='v']")
        if ($tx) { $name = [string]$tx.InnerText }
        if (-not $name) {
          $at = $ser.SelectSingleNode(".//*[local-name()='tx']//*[local-name()='t']")
          if ($at) { $name = [string]$at.InnerText }
        }
        $cat = ''
        $catf = $ser.SelectSingleNode(".//*[local-name()='cat']//*[local-name()='f']")
        if ($catf) { $cat = [string]$catf.InnerText }
        $valf = ''
        $valfNode = $ser.SelectSingleNode(".//*[local-name()='val']//*[local-name()='f']")
        if ($valfNode) { $valf = [string]$valfNode.InnerText }
        $series += [ordered]@{ name = $name; catFormula = $cat; valFormula = $valf }
      }
      $charts += [ordered]@{ name = $e.FullName; kind = $kind; title = $title; series = $series }
    }
    return [ordered]@{ cells = $cells; charts = $charts; sharedCount = $shared.Count }
  } finally {
    $zip.Dispose()
  }
}
