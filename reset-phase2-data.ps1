$ErrorActionPreference = "Stop"
Write-Host "Resetting Aura Phase 2 lead data..." -ForegroundColor Cyan
node ".\reset-phase2-data.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Done. Run npm test, npm run test:phase2, then start Aura." -ForegroundColor Green
