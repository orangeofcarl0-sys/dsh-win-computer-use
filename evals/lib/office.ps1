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
      $notesTexts = @()
      $num = [regex]::Match($e.FullName, 'slide([0-9]+)\.xml$').Groups[1].Value
      if ($num) {
        $notes = Read-S4Xml $zip ("ppt/notesSlides/notesSlide" + $num + ".xml")
        if ($notes) {
          foreach ($t in @($notes.SelectNodes("//*[local-name()='t']"))) { $notesTexts += [string]$t.InnerText }
        }
      }
      $slides += [ordered]@{ name = $e.FullName; texts = $texts; notes = $notesTexts; shapes = $shapes }
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
        # Excel may store categories as literal/cached labels instead of a
        # formula. Read both so "Sales by Month" can be verified from the chart
        # cache even when catFormula is empty.
        $cats = @()
        foreach ($cv in @($ser.SelectNodes(".//*[local-name()='cat']//*[local-name()='pt']/*[local-name()='v']"))) {
          $cats += [string]$cv.InnerText
        }
        $valf = ''
        $valfNode = $ser.SelectSingleNode(".//*[local-name()='val']//*[local-name()='f']")
        if ($valfNode) { $valf = [string]$valfNode.InnerText }
        $series += [ordered]@{ name = $name; catFormula = $cat; cats = $cats; valFormula = $valf }
      }
      $charts += [ordered]@{ name = $e.FullName; kind = $kind; title = $title; series = $series }
    }
    return [ordered]@{ cells = $cells; charts = $charts; sharedCount = $shared.Count }
  } finally {
    $zip.Dispose()
  }
}

function Read-DocxManifest([string]$Path) {
  $zip = Open-S4Zip $Path
  try {
    $doc = Read-S4Xml $zip 'word/document.xml'
    if (-not $doc) { throw 'word/document.xml missing' }
    $paras = @()
    foreach ($p in @($doc.SelectNodes("//*[local-name()='body']/*[local-name()='p']"))) {
      $runs = @()
      foreach ($r in @($p.SelectNodes(".//*[local-name()='r']"))) {
        $txt = @()
        foreach ($t in @($r.SelectNodes(".//*[local-name()='t']"))) { $txt += [string]$t.InnerText }
        $runs += [ordered]@{
          text = ($txt -join '')
          bold = [bool]$r.SelectSingleNode(".//*[local-name()='rPr']/*[local-name()='b']")
          italic = [bool]$r.SelectSingleNode(".//*[local-name()='rPr']/*[local-name()='i']")
        }
      }
      $styleNode = $p.SelectSingleNode(".//*[local-name()='pPr']/*[local-name()='pStyle']")
      $paras += [ordered]@{
        style = Get-S4Attr $styleNode 'val'
        text = (($runs | ForEach-Object { $_.text }) -join '')
        runs = $runs
      }
    }
    $tables = @()
    foreach ($tbl in @($doc.SelectNodes("//*[local-name()='tbl']"))) {
      $rows = @()
      foreach ($tr in @($tbl.SelectNodes("./*[local-name()='tr']"))) {
        $cells = @()
        foreach ($tc in @($tr.SelectNodes("./*[local-name()='tc']"))) {
          $txt = @()
          foreach ($t in @($tc.SelectNodes(".//*[local-name()='t']"))) { $txt += [string]$t.InnerText }
          $cells += ($txt -join '')
        }
        $rows += ,@($cells)
      }
      $tables += ,@($rows)
    }
    $headers = @()
    foreach ($e in @($zip.Entries | Where-Object { $_.FullName -match '^word/header[0-9]+\.xml$' } | Sort-Object FullName)) {
      $h = Read-S4Xml $zip $e.FullName
      if (-not $h) { continue }
      $txt = @()
      foreach ($t in @($h.SelectNodes("//*[local-name()='t']"))) { $txt += [string]$t.InnerText }
      $headers += ($txt -join '')
    }
    $footers = @()
    foreach ($e in @($zip.Entries | Where-Object { $_.FullName -match '^word/footer[0-9]+\.xml$' } | Sort-Object FullName)) {
      $f = Read-S4Xml $zip $e.FullName
      if (-not $f) { continue }
      $txt = @()
      foreach ($t in @($f.SelectNodes("//*[local-name()='t']"))) { $txt += [string]$t.InnerText }
      $footers += ($txt -join '')
    }
    return [ordered]@{
      paragraphs = $paras
      tables = $tables
      headers = $headers
      footers = $footers
      text = (($paras | ForEach-Object { $_.text }) -join "`n")
    }
  } finally {
    $zip.Dispose()
  }
}

function Set-S4ZipText($Zip, [string]$Name, [string]$Text) {
  $entry = $Zip.GetEntry($Name)
  if (-not $entry) { throw "zip entry missing: $Name" }
  $stream = $entry.Open()
  $stream.SetLength(0)
  $stream.Position = 0
  $enc = New-Object Text.UTF8Encoding($false)
  $writer = New-Object IO.StreamWriter($stream, $enc)
  $writer.Write($Text)
  $writer.Dispose()
}

function Remove-S4ZipEntry($Zip, [string]$Name) {
  $entry = $Zip.GetEntry($Name)
  if ($entry) { $entry.Delete() }
}

function Get-S4BarPlaceholderXml([string]$Prefix = 'S4 Bar') {
  # Three visible gray rectangles at the exact target geometry. The model only
  # needs to recolor/label them; this avoids a 20-minute Insert>Shapes hunt.
  $template = @'
<p:sp><p:nvSpPr><p:cNvPr id="__ID__" name="__NAME__"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="__X__" y="__Y__"/><a:ext cx="__W__" cy="__H__"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="7F7F7F"/></a:solidFill></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>
'@
  $bars = @(
    @(101, "$Prefix Q1", 571500, 1857375),
    @(102, "$Prefix Q2", 3429000, 1857375),
    @(103, "$Prefix Q3", 6286500, 1857375)
  )
  $parts = @()
  foreach ($b in $bars) {
    $parts += $template.Replace('__ID__', [string]$b[0]).Replace('__NAME__', [string]$b[1]).Replace('__X__', [string]$b[2]).Replace('__Y__', [string]$b[3]).Replace('__W__', '2286000').Replace('__H__', '2143125')
  }
  return ($parts -join '')
}

function New-S4WidescreenPptxSeed {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [string]$Title = 'S4 PPT REPLICA',
    [string]$Subtitle = 'Dirty Desktop Test',
    [string]$BarPrefix = 'S4 Bar'
  )
  # PowerPoint's built-in WidescreenPresentation.potx is a 16:9 template, but it
  # contains 8 sample slides. Copy it, switch the package content type from
  # template to presentation, and prune everything except slide 1 so the task
  # starts from exactly one 16:9 slide at the final output path. No COM: never
  # attach to the user's PowerPoint instance.
  $roots = @(
    (Join-Path $env:ProgramFiles 'Microsoft Office\root\Templates'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Office\root\Templates')
  )
  $tpl = $null
  foreach ($root in $roots) {
    if (-not $root -or -not (Test-Path $root)) { continue }
    $tpl = Get-ChildItem -Path $root -Recurse -Filter 'WidescreenPresentation.potx' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($tpl) { break }
  }
  if (-not $tpl) {
    return [ordered]@{ ok = $false; reason = 'WidescreenPresentation.potx not found under Office Templates' }
  }
  try {
    Copy-Item $tpl.FullName $Path -Force
    $zip = [IO.Compression.ZipFile]::Open($Path, [IO.Compression.ZipArchiveMode]::Update)
    try {
      $ct = Read-S4ZipText $zip '[Content_Types].xml'
      $oldType = 'application/vnd.openxmlformats-officedocument.presentationml.template.main+xml'
      $newType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'
      if ($ct.IndexOf($oldType, [StringComparison]::Ordinal) -lt 0) {
        throw 'template content type not found in seed'
      }
      $ct = $ct.Replace($oldType, $newType)

      $presText = Read-S4ZipText $zip 'ppt/presentation.xml'
      $pres = New-Object System.Xml.XmlDocument
      $pres.LoadXml($presText)
      $lst = $pres.SelectSingleNode("//*[local-name()='sldIdLst']")
      if (-not $lst) { throw 'presentation.xml missing sldIdLst' }
      $ids = @($lst.ChildNodes | Where-Object { $_.NodeType -eq 'Element' })
      for ($i = $ids.Count - 1; $i -ge 1; $i--) { [void]$lst.RemoveChild($ids[$i]) }
      $sw = New-Object IO.StringWriter
      $settings = New-Object System.Xml.XmlWriterSettings
      $settings.Encoding = New-Object Text.UTF8Encoding($false)
      $settings.OmitXmlDeclaration = $false
      $xw = [System.Xml.XmlWriter]::Create($sw, $settings)
      $pres.Save($xw)
      $xw.Dispose()
      $presText = $sw.ToString()
      $presText = $presText.Replace('encoding="utf-16"', 'encoding="UTF-8"')
      $sw.Dispose()

      $relsText = Read-S4ZipText $zip 'ppt/_rels/presentation.xml.rels'
      $rels = New-Object System.Xml.XmlDocument
      $rels.LoadXml($relsText)
      foreach ($rel in @($rels.SelectNodes("//*[local-name()='Relationship']"))) {
        $target = [string]$rel.Target
        if ($target -match '^slides/slide([2-9]|[1-9][0-9])\.xml$') {
          [void]$rel.ParentNode.RemoveChild($rel)
        }
      }
      $sw2 = New-Object IO.StringWriter
      $xw2 = [System.Xml.XmlWriter]::Create($sw2, $settings)
      $rels.Save($xw2)
      $xw2.Dispose()
      $relsText = $sw2.ToString()
      $relsText = $relsText.Replace('encoding="utf-16"', 'encoding="UTF-8"')
      $sw2.Dispose()

      # Remove slide 2..N and their notes/relationship parts, plus their
      # content-type overrides. Slide 1 and its layout/master/theme stay.
      for ($n = 2; $n -le 40; $n++) {
        $slide = "ppt/slides/slide$n.xml"
        $slideRels = "ppt/slides/_rels/slide$n.xml.rels"
        $notes = "ppt/notesSlides/notesSlide$n.xml"
        $notesRels = "ppt/notesSlides/_rels/notesSlide$n.xml.rels"
        $any = $false
        foreach ($name in @($slide, $slideRels, $notes, $notesRels)) {
          if ($zip.GetEntry($name)) { $any = $true }
        }
        if (-not $any) { continue }
        Remove-S4ZipEntry $zip $slide
        Remove-S4ZipEntry $zip $slideRels
        Remove-S4ZipEntry $zip $notes
        Remove-S4ZipEntry $zip $notesRels
        $ct = $ct.Replace("<Override PartName=`"/ppt/slides/slide$n.xml`"", "<Override PartName=`"/ppt/slides/slide$n.xml-removed`"")
        $ct = $ct.Replace("<Override PartName=`"/ppt/notesSlides/notesSlide$n.xml`"", "<Override PartName=`"/ppt/notesSlides/notesSlide$n.xml-removed`"")
      }
      # Drop the renamed (now dangling) overrides entirely.
      $ct = [regex]::Replace($ct, '<Override PartName="/ppt/(slides/slide|notesSlides/notesSlide)[0-9]+\.xml-removed"[^>]*/>', '')

      # Make slide 1 visually blank: keep only the title/subtitle placeholders,
      # remove template decorations, and paint a white background. This keeps
      # the reference (white canvas + three bars) unambiguous.
      $slide1 = Read-S4ZipText $zip 'ppt/slides/slide1.xml'
      if (-not $slide1 -or $slide1.IndexOf('</p:spTree>') -lt 0) { throw 'slide1 missing spTree' }
      $slideDoc = New-Object System.Xml.XmlDocument
      $slideDoc.LoadXml($slide1)
      $spTree = $slideDoc.SelectSingleNode("//*[local-name()='spTree']")
      if (-not $spTree) { throw 'slide1 missing spTree node' }
      $keepTypes = @('title', 'ctrTitle', 'subTitle')
      $kept = 0
      foreach ($child in @($spTree.ChildNodes)) {
        if ($child.NodeType -ne 'Element') { continue }
        $ln = [string]$child.LocalName
        if ($ln -eq 'nvGrpSpPr' -or $ln -eq 'grpSpPr') { continue }
        $keepShape = $false
        if ($ln -eq 'sp') {
          $ph = $child.SelectSingleNode(".//*[local-name()='ph']")
          if ($ph) {
            $phType = [string]$ph.GetAttribute('type')
            if ($keepTypes -contains $phType) { $keepShape = $true; $kept++ }
          }
        }
        if (-not $keepShape) { [void]$spTree.RemoveChild($child) }
      }
      if ($kept -lt 2) { throw "slide1 title/subtitle placeholders missing (kept=$kept)" }
      $texts = @($slideDoc.SelectNodes("//*[local-name()='t']"))
      if ($texts.Count -lt 2) { throw 'slide1 title/subtitle text nodes missing' }
      $texts[0].InnerText = $Title
      $texts[1].InnerText = $Subtitle
      $slideSw = New-Object IO.StringWriter
      $slideSettings = New-Object System.Xml.XmlWriterSettings
      $slideSettings.Encoding = New-Object Text.UTF8Encoding($false)
      $slideSettings.OmitXmlDeclaration = $false
      $slideXw = [System.Xml.XmlWriter]::Create($slideSw, $slideSettings)
      $slideDoc.Save($slideXw)
      $slideXw.Dispose()
      $slide1 = $slideSw.ToString().Replace('encoding="utf-16"', 'encoding="UTF-8"')
      $slideSw.Dispose()
      # Remove any inherited/template background, then add a flat white slide bg.
      $slide1 = [regex]::Replace($slide1, '<p:bg>[\s\S]*?</p:bg>', '')
      $whiteBg = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'
      $slide1 = $slide1.Replace('<p:spTree>', $whiteBg + '<p:spTree>')
      $slide1 = $slide1.Replace('</p:spTree>', ((Get-S4BarPlaceholderXml $BarPrefix) + '</p:spTree>'))
      Set-S4ZipText $zip 'ppt/slides/slide1.xml' $slide1

      Set-S4ZipText $zip '[Content_Types].xml' $ct
      Set-S4ZipText $zip 'ppt/presentation.xml' $presText
      Set-S4ZipText $zip 'ppt/_rels/presentation.xml.rels' $relsText
    } finally {
      $zip.Dispose()
    }
    $m = Read-PptxManifest $Path
    $ratio = 0
    if ($m.slideHeightIn -gt 0) { $ratio = $m.slideWidthIn / $m.slideHeightIn }
    if ($m.slideCount -ne 1) {
      return [ordered]@{ ok = $false; reason = "seed slide count=$($m.slideCount) (expected 1)" }
    }
    if ([math]::Abs($ratio - 1.7778) -gt 0.04) {
      return [ordered]@{ ok = $false; reason = "seed not 16:9: $($m.slideWidthIn)x$($m.slideHeightIn)" }
    }
    $barNames = @($m.slides[0].shapes | Where-Object { [string]$_.name -match ('^' + [regex]::Escape($BarPrefix) + ' Q[123]$') })
    if ($barNames.Count -ne 3) {
      return [ordered]@{ ok = $false; reason = "seed bars missing: found $($barNames.Count)/3" }
    }
    $seedText = (($m.slides[0].texts -join ' ') -replace '\s+', ' ').Trim()
    foreach ($needle in @($Title, $Subtitle)) {
      if ($seedText.IndexOf($needle, [StringComparison]::Ordinal) -lt 0) {
        return [ordered]@{ ok = $false; reason = "seed text missing: $needle" }
      }
    }
    return [ordered]@{
      ok = $true; path = $Path; template = $tpl.FullName
      slideCount = $m.slideCount; widthIn = $m.slideWidthIn; heightIn = $m.slideHeightIn
      bars = $barNames.Count; texts = $seedText
    }
  } catch {
    return [ordered]@{ ok = $false; reason = $_.Exception.Message }
  }
}
