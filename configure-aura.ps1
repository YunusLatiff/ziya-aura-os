$ErrorActionPreference = "Stop"
Write-Host "============================================" -ForegroundColor DarkYellow
Write-Host " AURA OS v0.2.2 - RESEARCH CONFIGURATION" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor DarkYellow
$tavily = Read-Host "Tavily API key (press Enter to leave blank)"
$geoapify = Read-Host "Geoapify API key (optional but recommended; press Enter to leave blank)"
$regions = Read-Host "Research regions separated by | [Johannesburg Gauteng South Africa|Pretoria Gauteng South Africa|Midrand Gauteng South Africa|Ekurhuleni Gauteng South Africa]"
if ([string]::IsNullOrWhiteSpace($regions)) { $regions = "Johannesburg Gauteng South Africa|Pretoria Gauteng South Africa|Midrand Gauteng South Africa|Ekurhuleni Gauteng South Africa" }
@"
AURA_PORT=4310
TAVILY_API_KEY=$tavily
GEOAPIFY_API_KEY=$geoapify
RESEARCH_REGIONS=$regions
RESEARCH_TICK_SECONDS=30
"@ | Set-Content -Path ".env" -Encoding UTF8
Write-Host "Aura research configuration saved locally to .env" -ForegroundColor Green
Write-Host "The .env file is excluded from Git." -ForegroundColor DarkGray
