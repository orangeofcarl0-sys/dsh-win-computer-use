# S4 image helpers (PowerShell 5.1, ASCII-only).
# Pixel masks are computed in C# for speed; no external image libraries.
if (-not ('S4ImageMask' -as [type])) {
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class S4MaskResult {
  public int Width;
  public int Height;
  public int RefCount;
  public int OutCount;
  public int InterCount;
  public int DilInterCount;
  public int RefMinX = Int32.MaxValue;
  public int RefMinY = Int32.MaxValue;
  public int RefMaxX = -1;
  public int RefMaxY = -1;
  public int OutMinX = Int32.MaxValue;
  public int OutMinY = Int32.MaxValue;
  public int OutMaxX = -1;
  public int OutMaxY = -1;
}

public class S4ImageMask {
  static byte[] Bytes(Bitmap bmp, out int stride) {
    Rectangle rect = new Rectangle(0, 0, bmp.Width, bmp.Height);
    BitmapData data = bmp.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
    byte[] buf = new byte[Math.Abs(data.Stride) * data.Height];
    Marshal.Copy(data.Scan0, buf, 0, buf.Length);
    stride = data.Stride;
    bmp.UnlockBits(data);
    return buf;
  }

  public static S4MaskResult Compare(string refPath, string outPath,
    int rMin, int rMax, int gMin, int gMax, int bMin, int bMax,
    int dilate, int step) {
    if (step < 1) step = 1;
    if (dilate < 0) dilate = 0;
    S4MaskResult res = new S4MaskResult();
    using (Bitmap rb = new Bitmap(refPath))
    using (Bitmap ob = new Bitmap(outPath)) {
      int w = Math.Min(rb.Width, ob.Width);
      int h = Math.Min(rb.Height, ob.Height);
      res.Width = w; res.Height = h;
      int rs, os;
      byte[] rbuf = Bytes(rb, out rs);
      byte[] obuf = Bytes(ob, out os);
      int gw = (w + step - 1) / step;
      int gh = (h + step - 1) / step;
      bool[] rm = new bool[gw * gh];
      bool[] om = new bool[gw * gh];
      for (int gy = 0; gy < gh; gy++) {
        int y = Math.Min(h - 1, gy * step);
        for (int gx = 0; gx < gw; gx++) {
          int x = Math.Min(w - 1, gx * step);
          int ri = y * rs + x * 4;
          int oi = y * os + x * 4;
          int r = rbuf[ri + 2], g = rbuf[ri + 1], b = rbuf[ri];
          int ro = obuf[oi + 2], go = obuf[oi + 1], bo = obuf[oi];
          bool rHit = r >= rMin && r <= rMax && g >= gMin && g <= gMax && b >= bMin && b <= bMax;
          bool oHit = ro >= rMin && ro <= rMax && go >= gMin && go <= gMax && bo >= bMin && bo <= bMax;
          rm[gy * gw + gx] = rHit;
          om[gy * gw + gx] = oHit;
          int px = gx * step, py = gy * step;
          if (rHit) {
            res.RefCount++;
            if (px < res.RefMinX) res.RefMinX = px;
            if (py < res.RefMinY) res.RefMinY = py;
            if (px > res.RefMaxX) res.RefMaxX = px;
            if (py > res.RefMaxY) res.RefMaxY = py;
          }
          if (oHit) {
            res.OutCount++;
            if (px < res.OutMinX) res.OutMinX = px;
            if (py < res.OutMinY) res.OutMinY = py;
            if (px > res.OutMaxX) res.OutMaxX = px;
            if (py > res.OutMaxY) res.OutMaxY = py;
          }
          if (rHit && oHit) res.InterCount++;
        }
      }
      int rad = Math.Max(1, dilate / step);
      for (int gy = 0; gy < gh; gy++) {
        for (int gx = 0; gx < gw; gx++) {
          if (!om[gy * gw + gx]) continue;
          bool near = false;
          for (int dy = -rad; dy <= rad && !near; dy++) {
            int yy = gy + dy;
            if (yy < 0 || yy >= gh) continue;
            for (int dx = -rad; dx <= rad; dx++) {
              int xx = gx + dx;
              if (xx < 0 || xx >= gw) continue;
              if (rm[yy * gw + xx]) { near = true; break; }
            }
          }
          if (near) res.DilInterCount++;
        }
      }
    }
    return res;
  }

  public static double WhiteRatio(string path, int minRgb, int step) {
    if (step < 1) step = 1;
    using (Bitmap b = new Bitmap(path)) {
      int s;
      byte[] buf = Bytes(b, out s);
      int total = 0, white = 0;
      for (int y = 0; y < b.Height; y += step) {
        for (int x = 0; x < b.Width; x += step) {
          int i = y * s + x * 4;
          if (buf[i] >= minRgb && buf[i + 1] >= minRgb && buf[i + 2] >= minRgb) white++;
          total++;
        }
      }
      return total == 0 ? 0 : ((double)white / total);
    }
  }
}
"@
}

function New-TestBlankPng([string]$Path, [int]$Width, [int]$Height, [string]$Color = 'White') {
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap $Width, $Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::FromName($Color))
  $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function New-PaintReferencePng([string]$Path) {
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap 800, 600
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $red = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(192, 0, 0))
  $blue = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(0, 112, 192))
  $g.FillRectangle($red, 80, 90, 200, 140)
  $g.FillEllipse($blue, 420, 90, 180, 120)
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::Black), 10
  $g.DrawLine($pen, 110, 480, 690, 480)
  $pen.Dispose(); $red.Dispose(); $blue.Dispose(); $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function New-PptReferencePng([string]$Path, [string]$Seed) {
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap 1280, 720
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $titleFont = New-Object System.Drawing.Font 'Segoe UI', 40, ([System.Drawing.FontStyle]::Bold)
  $subFont = New-Object System.Drawing.Font 'Segoe UI', 24
  $labelFont = New-Object System.Drawing.Font 'Segoe UI', 30, ([System.Drawing.FontStyle]::Bold)
  $footFont = New-Object System.Drawing.Font 'Segoe UI', 16
  $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(31, 56, 100))
  $gray = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(89, 89, 89))
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $g.DrawString('S4 PPT REPLICA', $titleFont, $dark, 80, 36)
  $g.DrawString('Dirty Desktop Test', $subFont, $gray, 80, 110)
  $bars = @(
    @(80, 260, 320, 300, 192, 0, 0, 'Q1'),
    @(480, 260, 320, 300, 0, 112, 192, 'Q2'),
    @(880, 260, 320, 300, 112, 173, 71, 'Q3')
  )
  foreach ($b in $bars) {
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb([int]$b[4], [int]$b[5], [int]$b[6]))
    $g.FillRectangle($brush, [int]$b[0], [int]$b[1], [int]$b[2], [int]$b[3])
    $g.DrawString([string]$b[7], $labelFont, $white, [float]([int]$b[0] + 130), [float]([int]$b[1] + 120))
    $brush.Dispose()
  }
  $g.DrawString(('seed:' + $Seed), $footFont, $gray, 80, 660)
  $titleFont.Dispose(); $subFont.Dispose(); $labelFont.Dispose(); $footFont.Dispose()
  $dark.Dispose(); $gray.Dispose(); $white.Dispose(); $g.Dispose()
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}

function Get-PngSize([string]$Path) {
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap $Path
  $r = [ordered]@{ width = $bmp.Width; height = $bmp.Height }
  $bmp.Dispose()
  return $r
}

function Compare-ColorMask([string]$Ref, [string]$Out, [string]$Name) {
  $spec = @{
    red = @(150, 255, 0, 90, 0, 90)
    blue = @(0, 90, 60, 160, 140, 255)
    green = @(0, 120, 130, 220, 30, 120)
    black = @(0, 70, 0, 70, 0, 70)
  }[$Name]
  if (-not $spec) { throw "unknown mask: $Name" }
  return [S4ImageMask]::Compare($Ref, $Out, $spec[0], $spec[1], $spec[2], $spec[3], $spec[4], $spec[5], 5, 2)
}
