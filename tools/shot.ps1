# Screenshot of Caret IDE's OWN window (PrintWindow on its window handle), never the whole screen.
# Usage:  powershell -File tools\shot.ps1 [-Folder D:\some\folder] [-Out shot.png] [-Wait 20] [-Fresh] [-Fake]
#   -Fresh  start with an empty profile (default keeps the profile in %TEMP%\caret-shot-profile)
#   -Fake   sets CARET_FAKE=1 (only meaningful if you add that hook to extension.js temporarily; see HANDOVER.md)
# Kills only the process it started (taskkill /PID <own pid>), never by image name.
param([string]$Folder = '', [string]$Out = "$env:TEMP\caret-shot.png", [int]$Wait = 20, [switch]$Fresh, [switch]$Fake, [string]$Keys = "")
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class W { [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
 public struct R { public int L,T,Rt,B; } }
"@
$exe = Join-Path (Split-Path $PSScriptRoot) 'dist\Caret-IDE\Caret IDE.exe'
$ud = "$env:TEMP\caret-shot-profile"; $ed = "$env:TEMP\caret-shot-ext"
if ($Fresh) { foreach ($d in $ud, $ed) { if (Test-Path $d) { Remove-Item $d -Recurse -Force } } }
if ($Fake) { $env:CARET_FAKE = '1' }
$args = @("--user-data-dir `"$ud`"", "--extensions-dir `"$ed`"")
if ($Folder) { $args += "`"$Folder`"" }
$p = Start-Process $exe -ArgumentList $args -PassThru
Start-Sleep $Wait
if ($Keys) { Add-Type -AssemblyName System.Windows.Forms; Add-Type -Namespace U -Name F -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);'; $p.Refresh(); [U.F]::SetForegroundWindow($p.MainWindowHandle) | Out-Null; Start-Sleep 1; [System.Windows.Forms.SendKeys]::SendWait($Keys); Start-Sleep 5 }
$p.Refresh()
$h = $p.MainWindowHandle
$r = New-Object W+R; [W]::GetWindowRect($h, [ref]$r) | Out-Null
$w = $r.Rt - $r.L; $ht = $r.B - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
[W]::PrintWindow($h, $dc, 2) | Out-Null
$g.ReleaseHdc($dc); $bmp.Save($Out); $g.Dispose(); $bmp.Dispose()
taskkill /T /F /PID $p.Id | Out-Null
"$w x $ht -> $Out"
