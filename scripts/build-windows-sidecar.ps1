$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "==> Building native Shadow worker sidecar for Windows"

$python = "py"
& $python -3.12 --version

if (Test-Path ".sidecar-venv") { Remove-Item ".sidecar-venv" -Recurse -Force }
if (Test-Path "python\build") { Remove-Item "python\build" -Recurse -Force }
if (Test-Path "python\dist") { Remove-Item "python\dist" -Recurse -Force }

& $python -3.12 -m venv .sidecar-venv
& .\.sidecar-venv\Scripts\python.exe -m pip install --upgrade pip wheel setuptools
& .\.sidecar-venv\Scripts\python.exe -m pip install -r python\requirements.txt

Push-Location python
& ..\.sidecar-venv\Scripts\pyinstaller.exe --clean --noconfirm shadow-worker.spec
Pop-Location

New-Item -ItemType Directory -Force -Path src-tauri\sidecars | Out-Null
Copy-Item python\dist\shadow-worker.exe src-tauri\sidecars\shadow-worker.exe -Force

& src-tauri\sidecars\shadow-worker.exe --help | Out-Null

& .\.sidecar-venv\Scripts\python.exe scripts\configure-native-sidecar.py

Write-Host "Native Windows sidecar ready:"
Get-Item src-tauri\sidecars\shadow-worker.exe
