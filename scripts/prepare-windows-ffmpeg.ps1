$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

$ffmpeg = (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue).Source
$ffprobe = (Get-Command ffprobe.exe -ErrorAction SilentlyContinue).Source

if (-not $ffmpeg -or -not $ffprobe) {
    Write-Host "Install FFmpeg first, e.g.: choco install ffmpeg -y"
    exit 1
}

New-Item -ItemType Directory -Force -Path bin | Out-Null
Copy-Item $ffmpeg bin\ffmpeg.exe -Force
Copy-Item $ffprobe bin\ffprobe.exe -Force
python scripts\configure-ffmpeg-resources.py
