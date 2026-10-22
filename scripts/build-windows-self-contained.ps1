$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "==> 1/6 Build native Python/Faster-Whisper sidecar"
& .\scripts\build-windows-sidecar.ps1

Write-Host "==> 2/6 Prepare bundled FFmpeg"
& .\scripts\prepare-windows-ffmpeg.ps1

Write-Host "==> 3/6 Generate icons"
npm run tauri icon src-tauri\icons\icon.png

Write-Host "==> 4/6 Clean old bundle"
if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force }
if (Test-Path "src-tauri\target\release\bundle") {
  Remove-Item "src-tauri\target\release\bundle" -Recurse -Force
}

Write-Host "==> 5/6 Build frontend"
npm run build

Write-Host "==> 6/6 Build Windows MSI + NSIS"
npm run tauri build -- --bundles msi,nsis
