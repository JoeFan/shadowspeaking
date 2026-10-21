
$ErrorActionPreference = "Stop"

Write-Host "Run this on Windows with Node, Rust, Python 3.12, and FFmpeg installed."
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -U pip
python -m pip install -r python\requirements.txt
$env:SHADOWING_PYTHON = "$PWD\.venv\Scripts\python.exe"

npm install
npm run tauri build

Write-Host "NOTE: a redistributable standalone MSI/EXE still needs the Python worker bundled as a sidecar."
