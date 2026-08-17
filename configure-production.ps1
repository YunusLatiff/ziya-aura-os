$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host ''
Write-Host '============================================' -ForegroundColor DarkYellow
Write-Host ' AURA OS v0.8.0 - PRODUCTION HARDENING' -ForegroundColor White
Write-Host '============================================' -ForegroundColor DarkYellow
Write-Host ''
Write-Host "This configures Aura's external production supervisor." -ForegroundColor Yellow
Write-Host 'Tony is started/restarted externally when needed, but no Tony file or configuration is edited.' -ForegroundColor Yellow
Write-Host ''

$envPath = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $envPath)) {
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.env.example')) { Copy-Item (Join-Path $PSScriptRoot '.env.example') $envPath }
    else { New-Item -ItemType File -Path $envPath | Out-Null }
}

function Set-DotEnvValue([string]$Name,[string]$Value) {
    $escaped = $Value.Replace('"','\"')
    $line = "$Name=`"$escaped`""
    $content = @(Get-Content -LiteralPath $envPath -ErrorAction SilentlyContinue)
    $found = $false
    for ($i=0; $i -lt $content.Count; $i++) {
        if ($content[$i] -match "^\s*$([regex]::Escape($Name))\s*=") { $content[$i]=$line; $found=$true }
    }
    if (-not $found) { $content += $line }
    Set-Content -LiteralPath $envPath -Value $content -Encoding UTF8
}

$watch = Read-Host 'Enable production watchdog [Y]'
$watchEnabled = -not ($watch -match '^(n|no)$')
$tony = Read-Host 'Start Tony automatically whenever Aura starts [Y]'
$tonyEnabled = -not ($tony -match '^(n|no)$')
$interval = Read-Host 'Watchdog health-check interval in seconds [30]'
if ([string]::IsNullOrWhiteSpace($interval)) { $interval='30' }
$backup = Read-Host 'Aura state backup interval in hours [6]'
if ([string]::IsNullOrWhiteSpace($backup)) { $backup='6' }
$retention = Read-Host 'Number of Aura state backups to retain [30]'
if ([string]::IsNullOrWhiteSpace($retention)) { $retention='30' }
$restore = Read-Host 'Automatically restore the latest valid Aura state if aura.json becomes corrupt [Y]'
$restoreEnabled = -not ($restore -match '^(n|no)$')

Set-DotEnvValue 'PRODUCTION_WATCHDOG_ENABLED' ($(if($watchEnabled){'true'}else{'false'}))
Set-DotEnvValue 'PRODUCTION_TONY_AUTOSTART' ($(if($tonyEnabled){'true'}else{'false'}))
Set-DotEnvValue 'PRODUCTION_WATCHDOG_INTERVAL_SECONDS' $interval
Set-DotEnvValue 'PRODUCTION_BACKUP_INTERVAL_HOURS' $backup
Set-DotEnvValue 'PRODUCTION_BACKUP_RETENTION' $retention
Set-DotEnvValue 'PRODUCTION_AUTO_RESTORE_CORRUPT_DB' ($(if($restoreEnabled){'true'}else{'false'}))
Set-DotEnvValue 'OUTBOUND_INTERRUPTED_MINUTES' '10'

Write-Host ''
Write-Host 'Production settings saved.' -ForegroundColor Green
Write-Host 'Recommended next command:' -ForegroundColor White
Write-Host '  .\install-ziya-autostart.ps1' -ForegroundColor Cyan
