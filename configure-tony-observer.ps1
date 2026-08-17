$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "============================================" -ForegroundColor DarkYellow
Write-Host " AURA OS v0.7.0 - TONY READ-ONLY OBSERVER" -ForegroundColor White
Write-Host "============================================" -ForegroundColor DarkYellow
Write-Host ""
Write-Host "This configures Aura only. Tony is not read, edited, started, stopped or reconfigured by this script." -ForegroundColor Yellow
Write-Host "Aura's observer never reads Tony's .env or credentials." -ForegroundColor Yellow
Write-Host ""

$envPath = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $envPath)) {
    if (Test-Path (Join-Path $PSScriptRoot ".env.example")) {
        Copy-Item (Join-Path $PSScriptRoot ".env.example") $envPath
    } else {
        New-Item -ItemType File -Path $envPath | Out-Null
    }
}

$defaultTonyRoot = "C:\Users\yunus\OneDrive\Ziya Energy\Design Software\Agents\Tony-Ziya-Assessment-Agent-v0.4-Direct-Mail"
$defaultCompletedRoot = "C:\Users\yunus\OneDrive\Ziya Energy\Automated Assessment"

$tonyRoot = Read-Host "Tony folder [$defaultTonyRoot]"
if ([string]::IsNullOrWhiteSpace($tonyRoot)) { $tonyRoot = $defaultTonyRoot }
$completedRoot = Read-Host "Tony completed-assessment folder [$defaultCompletedRoot]"
if ([string]::IsNullOrWhiteSpace($completedRoot)) { $completedRoot = $defaultCompletedRoot }
$interval = Read-Host "Read-only observation interval in seconds [20]"
if ([string]::IsNullOrWhiteSpace($interval)) { $interval = "20" }

function Set-DotEnvValue([string]$Name, [string]$Value) {
    $escaped = $Value.Replace('"','\"')
    $line = "$Name=`"$escaped`""
    $content = @(Get-Content $envPath -ErrorAction SilentlyContinue)
    $found = $false
    for ($i = 0; $i -lt $content.Count; $i++) {
        if ($content[$i] -match "^\s*$([regex]::Escape($Name))\s*=") {
            $content[$i] = $line
            $found = $true
        }
    }
    if (-not $found) { $content += $line }
    Set-Content -Path $envPath -Value $content -Encoding UTF8
}

Set-DotEnvValue "TONY_MONITOR_ENABLED" "true"
Set-DotEnvValue "TONY_MONITOR_ROOT" $tonyRoot
Set-DotEnvValue "TONY_COMPLETED_ROOT" $completedRoot
Set-DotEnvValue "TONY_MONITOR_INTERVAL_SECONDS" $interval

Write-Host ""
Write-Host "Tony observer configuration saved to Aura .env." -ForegroundColor Green
Write-Host "No Tony file was modified." -ForegroundColor Green
Write-Host "Restart Aura to load the observer settings." -ForegroundColor White
