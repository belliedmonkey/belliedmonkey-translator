# scripts/win-matrix/setup.ps1 -- one-time base for a REAL Windows machine on the LAN (not the VM).
# Run ONCE in an ELEVATED PowerShell on that machine, fetched from the Mac:
#     $u='http://<mac-lan-ip>:8765'; irm $u/setup.ps1 | iex
# (`desktop.sh serve` on the Mac serves this folder plus mac.pub, the Mac's SSH public key.)
# After this the Mac does everything over SSH: push the build, start browsers inside YOUR desktop
# session (through the scheduled task below -- a GUI app started straight from an SSH session lands
# in the invisible session 0), run the tests. ASCII-only output on purpose: `irm | iex` decodes the
# body as Latin-1 and Chinese text arrives as mojibake (2026-09-18).
$ErrorActionPreference = 'Continue'
if (-not $u) { Write-Host 'Set $u to the Mac URL first, e.g. $u=''http://192.168.50.231:8765'''; return }
Write-Host "[1/6] firewall + portproxy 9223 -> 127.0.0.1:9222 (desktop browsers only listen on loopback)"
netsh advfirewall firewall add rule name="cdp9223" dir=in action=allow protocol=TCP localport=9223 | Out-Null
netsh interface portproxy add v4tov4 listenport=9223 listenaddress=0.0.0.0 connectport=9222 connectaddress=127.0.0.1 2>$null | Out-Null
Write-Host "[2/6] OpenSSH Server"
# Add-WindowsCapability pulls from Windows Update and can sit for minutes; skip it when sshd is already there.
if (-not (Get-Service sshd -ErrorAction SilentlyContinue)) { Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null }
Start-Service sshd -ErrorAction SilentlyContinue; Set-Service sshd -StartupType Automatic
if (-not (Get-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name "OpenSSH-Server-In-TCP" -DisplayName "OpenSSH Server (sshd)" -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
}
if (-not (Test-Path "HKLM:\SOFTWARE\OpenSSH")) { New-Item -Path "HKLM:\SOFTWARE\OpenSSH" -Force | Out-Null }
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force | Out-Null
Write-Host "[3/6] the Mac's public key"
$key = (Invoke-RestMethod "$u/mac.pub").Trim()
if ($key -notmatch '^ssh-') { Write-Host "mac.pub did not look like a public key: $key"; return }
$adm = "$env:ProgramData\ssh\administrators_authorized_keys"   # what sshd reads for members of Administrators
if (-not (Test-Path $adm) -or -not (Select-String -Path $adm -SimpleMatch $key -Quiet)) { Add-Content -Path $adm -Value $key -Encoding ASCII }
icacls $adm /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null
$ud = "$env:USERPROFILE\.ssh"; New-Item -ItemType Directory -Force $ud | Out-Null
if (-not (Test-Path "$ud\authorized_keys") -or -not (Select-String -Path "$ud\authorized_keys" -SimpleMatch $key -Quiet)) { Add-Content "$ud\authorized_keys" $key -Encoding ASCII }
Write-Host "[4/6] C:\mt + launcher"
New-Item -ItemType Directory -Force C:\mt | Out-Null
@'
@echo off
rem Started by the scheduled task mt-launch inside the interactive desktop session.
for /f "usebackq delims=" %%a in ("C:\mt\launch.args") do start "" %%a
'@ | Set-Content -Path C:\mt\launch.cmd -Encoding ASCII
Write-Host "[5/6] scheduled task mt-launch (interactive session only, never on a timer)"
schtasks /create /tn mt-launch /tr "C:\mt\launch.cmd" /sc once /st 00:00 /it /f | Out-Null
Write-Host "[6/6] restart sshd"
Restart-Service sshd
Write-Host ""; Write-Host "READBACK:"
Get-Service sshd | Select-Object Status, StartType | Format-Table -AutoSize
netsh interface portproxy show v4tov4
Write-Host ("ssh user name to use from the Mac: " + (whoami))
Write-Host "  (a Microsoft account signs in over SSH with its E-MAIL address, not the short name above)"
Write-Host "DONE"
