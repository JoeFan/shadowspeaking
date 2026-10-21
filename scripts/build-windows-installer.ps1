$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "Shadowing Player v2.9 — Windows installer build"

if (-not (Test-Path ".venv")) {
    py -3.12 -m venv .venv
}

& .\.venv\Scripts\python.exe -m pip install -U pip
& .\.venv\Scripts\python.exe -m pip install -r python\requirements.txt

npm install
npm run tauri icon src-tauri\icons\icon.png

$env:SHADOWING_PYTHON = "$PWD\.venv\Scripts\python.exe"
npm run tauri build -- --bundles msi,nsis

Write-Host ""
Write-Host "Created:"
Get-ChildItem src-tauri\target\release\bundle -Recurse -Include *.msi,*.exe |
  Select-Object -ExpandProperty FullName
