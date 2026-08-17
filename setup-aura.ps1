$ErrorActionPreference = "Stop"
Write-Host "============================================" -ForegroundColor DarkYellow
Write-Host " AURA OS v0.2.2 - SETUP" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor DarkYellow
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "Node.js 20+ is required." }
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) { throw "Node.js 20+ is required." }
Write-Host "Node.js $(node -p 'process.versions.node') detected." -ForegroundColor Green
New-Item -ItemType Directory -Force -Path ".\data" | Out-Null
New-Item -ItemType Directory -Force -Path ".\logs" | Out-Null
npm test
if (-not (Test-Path ".env")) { Copy-Item ".env.example" ".env"; Write-Host "Created .env from template. Run .\configure-aura.ps1 to add research API keys." -ForegroundColor Yellow }
Write-Host "Aura OS v0.2.2 setup complete. No npm packages are required." -ForegroundColor Green
Write-Host "Next: .\configure-aura.ps1 then .\start-aura.ps1" -ForegroundColor Cyan
