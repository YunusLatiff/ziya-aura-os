param(
    [switch]$NoBrowser,
    [switch]$NoWatchdog,
    [switch]$NoTony,
    [switch]$Supervised
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
. (Join-Path $PSScriptRoot 'production\ziya-production-lib.ps1')

Write-Host '============================================' -ForegroundColor DarkYellow
Write-Host ' AURA OS - ZIYA ENERGY COMMAND CENTER' -ForegroundColor Yellow
Write-Host '============================================' -ForegroundColor DarkYellow

$envPath = Join-Path $PSScriptRoot '.env'
$cfg = Get-DotEnvMap -EnvPath $envPath
$auraPort = Get-EnvIntValue -Map $cfg -Name 'AURA_PORT' -Default 4310 -Minimum 1
$crmPort = Get-EnvIntValue -Map $cfg -Name 'CRM_PORT' -Default 4311 -Minimum 1
$tonyAutostart = Get-EnvBoolValue -Map $cfg -Name 'PRODUCTION_TONY_AUTOSTART' -Default $true
$watchdogEnabled = Get-EnvBoolValue -Map $cfg -Name 'PRODUCTION_WATCHDOG_ENABLED' -Default $true

if ($crmPort -eq $auraPort) { throw "AURA_PORT and CRM_PORT must be different. Current value: $auraPort" }

# Tony is started externally. No Tony file, rule, config or workflow is changed.
if (-not $NoTony -and $tonyAutostart) {
    $tonyRoot = Find-TonyProjectRoot -AuraRoot $PSScriptRoot -EnvMap $cfg
    if ($tonyRoot) {
        try {
            $t = Start-TonyExternal -TonyRoot $tonyRoot -Minimized:$Supervised
            if ($t.AlreadyRunning) { Write-Host '[TONY] Already running.' -ForegroundColor DarkGreen }
            else { Write-Host "[TONY] Started externally from $tonyRoot" -ForegroundColor Green }
        } catch {
            Write-Host "[TONY] Could not start: $($_.Exception.Message)" -ForegroundColor Red
            Write-ProductionLog -AuraRoot $PSScriptRoot -Level ERROR -Message "Tony startup failed: $($_.Exception.Message)"
        }
    } else {
        Write-Host '[TONY] Project not found. Aura will still start.' -ForegroundColor Yellow
        Write-ProductionLog -AuraRoot $PSScriptRoot -Level WARN -Message 'Tony autostart requested but project could not be located.'
    }
}

$a = Start-AuraServerExternal -AuraRoot $PSScriptRoot -Port $auraPort -Minimized:$Supervised
if ($a.AlreadyRunning) { Write-Host "[AURA] Dashboard already listening on port $auraPort." -ForegroundColor Yellow }
else { Write-Host "[AURA] Dashboard started on port $auraPort." -ForegroundColor Green }

$c = Start-CrmUiExternal -AuraRoot $PSScriptRoot -Port $crmPort -Minimized:$Supervised
if ($c.AlreadyRunning) { Write-Host "[CRM] Already listening on port $crmPort." -ForegroundColor Yellow }
else { Write-Host "[CRM] Started on port $crmPort." -ForegroundColor Green }

if (-not $NoWatchdog -and $watchdogEnabled) {
    try {
        $w = Start-WatchdogExternal -AuraRoot $PSScriptRoot -StartupDelaySeconds 0 -Hidden:$Supervised
        if ($w.AlreadyRunning) { Write-Host '[SUPERVISOR] Watchdog already running.' -ForegroundColor DarkGreen }
        else { Write-Host '[SUPERVISOR] Production watchdog started.' -ForegroundColor Green }
    } catch {
        Write-Host "[SUPERVISOR] Watchdog could not start: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-ProductionLog -AuraRoot $PSScriptRoot -Level WARN -Message "Watchdog startup failed: $($_.Exception.Message)"
    }
}

Start-Sleep -Seconds 2
if (-not $NoBrowser) {
    Start-Process "http://localhost:$auraPort"
    Start-Process "http://localhost:$crmPort"
}
Write-Host "Aura Operations Dashboard: http://localhost:$auraPort" -ForegroundColor Green
Write-Host "Ziya CRM                : http://localhost:$crmPort" -ForegroundColor Green
