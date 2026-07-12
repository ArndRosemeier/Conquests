# Convenience launcher for the Colonial Conquest dev server.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File .\start.ps1
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies (first run)..." -ForegroundColor Cyan
    npm install
}

Write-Host "Starting Colonial Conquest dev server..." -ForegroundColor Green
Write-Host "A browser tab will open automatically. Press Ctrl+C to stop." -ForegroundColor DarkGray
npm start
