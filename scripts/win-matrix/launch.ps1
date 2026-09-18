# scripts/win-matrix/launch.ps1 -- runs ON the Windows machine (over SSH, from desktop.sh).
#   powershell -NoProfile -ExecutionPolicy Bypass -File C:\mt\launch.ps1 -Browser chrome|edge [-FreshProfile]
# Stops that browser, makes sure C:\mt\<browser>-profile is a COPY of the everyday profile (Chrome 136+
# refuses --remote-debugging-port on the default user-data-dir; a copy keeps the sign-ins because
# "Local State" carries the DPAPI-wrapped cookie key for the same Windows user), writes the command
# line to C:\mt\launch.args and starts it through the scheduled task so the window is on the desktop.
param([ValidateSet('chrome','edge')][string]$Browser = 'chrome', [switch]$FreshProfile)
$ErrorActionPreference = 'Continue'
$cfg = @{
  chrome = @{ proc = 'chrome'; exe = 'C:\Program Files\Google\Chrome\Application\chrome.exe'; src = "$env:LOCALAPPDATA\Google\Chrome\User Data"; extra = '' }
  edge   = @{ proc = 'msedge'; exe = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'; src = "$env:LOCALAPPDATA\Microsoft\Edge\User Data"
              # Edge has no CDP Extensions.loadUnpacked ("Method not available", Edge 145): preload the build instead.
              extra = '--enable-unsafe-extension-debugging --load-extension=C:\mt\dist' }
}[$Browser]
Get-Process chrome, msedge, firefox -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2
$dst = "C:\mt\$Browser-profile"
if ($FreshProfile -or -not (Test-Path "$dst\Default")) {
  New-Item -ItemType Directory -Force $dst | Out-Null
  robocopy "$($cfg.src)\Default" "$dst\Default" /E /R:0 /W:0 /NFL /NDL /NJH /NJS /XD "Cache" "Code Cache" "GPUCache" "Service Worker" "DawnCache" "DawnGraphiteCache" "DawnWebGPUCache" | Out-Null
  Copy-Item "$($cfg.src)\Local State" "$dst\Local State" -Force
}
('"' + $cfg.exe + '" --user-data-dir=' + $dst + ' --no-first-run --no-default-browser-check --remote-debugging-port=9222 --remote-allow-origins=* ' + $cfg.extra + ' about:blank') | Set-Content C:\mt\launch.args -Encoding ASCII
schtasks /run /tn mt-launch | Out-Null
for ($i = 0; $i -lt 20; $i++) { Start-Sleep 1; if (netstat -an | Select-String '127\.0\.0\.1:9222\s.*LISTENING') { break } }
$listening = [bool](netstat -an | Select-String '127\.0\.0\.1:9222\s.*LISTENING')
$session = (Get-Process $cfg.proc -ErrorAction SilentlyContinue | Select-Object -First 1).SessionId
Write-Output ("browser=$Browser listening9222=$listening session=$session")   # session must NOT be 0
if (-not $listening) { exit 1 }
